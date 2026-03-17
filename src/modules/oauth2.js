import { createRemoteJWKSet } from 'jose'
import { jwtDecode } from "jwt-decode"
import * as openIdClient from 'openid-client'
import { SESSION_PREFIX, getSessionIdFromCookie } from '../plugins/oauth2.js'
import { errorHandler } from './error.js'

export async function initOAuth2(server, opts) {

    // Configuration is an abstraction over the OAuth 2.0

    // Authorization Server metadata and OAuth 2.0 Client metadata
    let authServerConfiguration = null

    // Configuration instances are obtained either through:
    if (opts.oauth2.discoverySupported) {
        // (RECOMMENDED) the discovery function that discovers the OAuth 2.0
        // Authorization Server metadata using the Authorization Server's Issuer Identifier
        try {
            authServerConfiguration = await openIdClient.discovery(
                new URL(opts.oauth2.authorizationServerMetadataLocation),
                opts.oauth2.clientId, opts.oauth2.clientSecret)
        } catch (error) {
            server.log.fatal(error, `Origin: ${opts.id}. Unable to get the Authorization Server metadata.`)
            throw new Error(`Origin: ${opts.id}. Unable to get the Authorization Server metadata.`, { cause: error })
        }
    } else {
        // The Configuration constructor if the OAuth 2.0 Authorization
        // Server metadata is known upfront
        authServerConfiguration = new openIdClient.Configuration(
            opts.oauth2.authorizationServerMetadata, opts.oauth2.clientId, opts.oauth2.clientSecret
        )
    }

    server.decorate("authServerConfiguration", authServerConfiguration)

    // The JSON Web Key Set (JWKS) is a set of keys containing the public keys
    // used to verify any JSON Web Token (JWT) issued by the Authorization Server
    // and signed using the RS256 signing algorithm.
    const jwksUri = new URL(authServerConfiguration.serverMetadata().jwks_uri)
    const jwks = createRemoteJWKSet(jwksUri)
    server.decorate('jwks', jwks)

    // Precompile the regular expressions of the authentication strategies
    let clientCredentialsGrantTypeFound = false
    let authorizationCodeGrantTypeFound = false
    opts.oauth2.authStrategies.forEach(strategy => {
        strategy.compiledPatterns = []
        strategy.urlPatterns.forEach(pattern => {
            try {
                strategy.compiledPatterns.push(new RegExp(pattern))
                if ('client_credentials' === strategy.grantType) {
                    clientCredentialsGrantTypeFound = true
                } else if ('authorization_code' === strategy.grantType) {
                    authorizationCodeGrantTypeFound = true
                }
            } catch (error) {
                server.log.fatal(error,
                    `Origin: ${opts.id}. urlPattern ${pattern} in authStrategies is not a valid regular expression.`)
                throw new Error(`Origin: ${opts.id}. The OAuth2 authStrategies configuration is invalid.`, { cause: error })
            }
        })
    })

    // If client_credentials grant type is used, we need to store the token.
    if (clientCredentialsGrantTypeFound) {
        server.decorate('clientCredentials')
        server.decorate('clientCredentialsPromise')
    }
    // If authorization_code grant type is used, we need to add the session to the request.
    if (clientCredentialsGrantTypeFound ||
        authorizationCodeGrantTypeFound) {
        server.decorateRequest('tokens')
    }

    server.addHook('onRequest', async (request, reply) => {

        // Determine which authentication strategy applies to this URL
        let authStrategy = null
        for (const strategy of opts.oauth2.authStrategies) {
            for (const regex of strategy.compiledPatterns) {
                if (regex.test(request.path)) {
                    authStrategy = strategy
                    break
                }
            }
            if (authStrategy) break
        }

        // If there is no strategy defined, deny access
        let msg = null
        if (!authStrategy) {
            msg = `Origin: ${opts.id}. No authentication strategy defined for ${request.raw.url}. Assuming none as the default strategy.`
            server.log.warn(msg)
            authStrategy = { grantType: 'none' }
        }

        switch (authStrategy?.grantType) {
            case 'none':
                return
            case 'client_credentials':
                return await manageClientCredentialsGrant(request, reply, authStrategy)
            case 'authorization_code':
                return await manageAuthorizationCodeGrant(request, reply, authStrategy)
            default:
                msg = `Origin: ${opts.id}. Unsupported grant type ${authStrategy.grantType}.`
                server.log.error(msg)
                return errorHandler(reply, 500, msg, opts.exposeErrors)
        }

    })

    async function manageClientCredentialsGrant(request, reply, authStrategy) {

        let clientCredentials = null

        // If the token is still valid, use it
        if (server?.clientCredentials) {
            // expires_in is recommended but not required in the RFC 6749
            // https://www.rfc-editor.org/rfc/rfc6749.html
            let ttl = server.clientCredentials?.expires_in ?
                server.clientCredentials.expires_in
                : server.clientCredentials.decodedToken.exp - server.clientCredentials.decodedToken.iat
            const bufferTime = Math.floor(ttl * 0.1)
            const jitter = Math.floor(0.1 * Math.random() * bufferTime)
            const now = Math.floor(Date.now() / 1000)
            const minExp = now + bufferTime + jitter
            if (server.clientCredentials.decodedToken.exp > minExp) {
                clientCredentials = server.clientCredentials
            }
        }
        
        if (!clientCredentials) {
            // If the token is not valid, we need to get a new one.
            // Only one thread will get a new token.            
            let isTokenRefreshOwner = false
            if (!server.clientCredentialsPromise) {
                server.clientCredentialsPromise = openIdClient.clientCredentialsGrant(
                    authServerConfiguration,
                    authStrategy.parameters
                )
                isTokenRefreshOwner = true
            }
            // The other threads will wait for the token to be renewed.             
            try {
                clientCredentials = await server.clientCredentialsPromise
            } catch (error) {
                server.log.error(error, `Origin: ${opts.id}. Error getting a new client credentials token.`)
                return errorHandler(reply, 500, `Origin: ${opts.id}. Error getting a new client credentials token.`, opts.exposeErrors, error)
            } finally {
                if (isTokenRefreshOwner) {
                    server.clientCredentialsPromise = null
                    server.clientCredentials = clientCredentials
                    try {
                        clientCredentials.decodedToken =
                            jwtDecode(clientCredentials.access_token)
                    } catch (error) {
                        server.log.error(error, `Origin: ${opts.id}. Error decoding new client credentials token. ${clientCredentials.access_token}`)
                    }
                }
            }
        }

        await decorateRequestWithTokens(request, clientCredentials)

    }

    async function manageAuthorizationCodeGrant(request, reply, authStrategy) {

        let tokens = {}
        const id_session = getSessionIdFromCookie(request.headers, opts.oauth2.sessionIdCookieName)
        if (id_session) {
            const sessionKey = SESSION_PREFIX + id_session
            try {
                tokens = server.redisBreaker
                    ? await server.redisBreaker.fire('hGetAll', [sessionKey])
                    : await server.redis.hGetAll(sessionKey)
            } catch (error) {
                const msg = `Origin: ${opts.id}. An error occurred while retrieving the stored session ${id_session}.`
                server.log.error(error, msg)
                return errorHandler(reply, 500, msg, opts.exposeErrors, error)
            }
        }

        if (Object.keys(tokens).length > 0) {
            try {
                await decorateRequestWithTokens(request, tokens)
            } catch (error) {
                if (error.code === 'ERR_JWT_EXPIRED') {
                    // If the access token has expired, attempt to renew it
                    try {
                        const freshTokens = await openIdClient.refreshTokenGrant(
                            authServerConfiguration,
                            tokens.refresh_token,
                            authStrategy.parameters
                        )
                        await decorateRequestWithTokens(request, freshTokens)
                        try {
                            await storeSession(server, freshTokens)
                        } catch (error) {
                            const msg = `Origin: ${opts.id}. An error occurred while storing the session.`
                            server.log.error(error, msg)
                            return errorHandler(reply, 500, msg, opts.exposeErrors, error)
                        }
                    } catch (error) {
                        const msg = `Origin: ${opts.id}. Error while refreshing the access token.`
                        server.log.error(error, msg)
                        return errorHandler(reply, 500, msg, opts.exposeErrors, error)
                    }
                } else {
                    const msg = `Origin: ${opts.id}. Invalid stored session ${id_session}.`
                    server.log.error(error, msg)
                    return errorHandler(reply, 500, msg, opts.exposeErrors, error)
                }
            }
        }
    }

    async function decorateRequestWithTokens(request, tokens) {
        if ((tokens.token_type || '').toLowerCase() !== 'bearer') {
            throw new Error(`Origin: ${opts.id}. Unsupported token_type ${tokens.token_type}.`)
        }
        request.headers['authorization'] = `Bearer ${tokens.access_token}`
    }

}

export async function storeSession(server, tokens) {
    try {
        const accessToken = jwtDecode(tokens.access_token)
        const refreshToken = jwtDecode(tokens.refresh_token)
        tokens.sub = refreshToken.sub
        tokens.iat = refreshToken.iat
        const sessionKey = SESSION_PREFIX + refreshToken.sid
        server.redisBreaker
            ? await server.redisBreaker.fire('hSet', [sessionKey, tokens])
            : await server.redis.hSet(sessionKey, tokens)
        server.redisBreaker
            ? await server.redisBreaker.fire('expireAt', [sessionKey, refreshToken.exp])
            : await server.redis.expireAt(sessionKey, refreshToken.exp)
        return refreshToken.sid
    } catch (error) {
        server.log.error(error, `Error while storing the session.`)
        throw error
    }
}
