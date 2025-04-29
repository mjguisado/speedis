import { jwtVerify, createRemoteJWKSet } from 'jose'
import { jwtDecode } from "jwt-decode"
import * as openIdClient from 'openid-client'
import { SESSION_PREFIX } from '../plugins/session.js'
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

    server.decorateRequest('session')
    async function decorateRequestWithSessionData(request, tokens) {

        if ((tokens.token_type || '').toLowerCase() !== 'bearer') {
            throw new Error(`Origin: ${opts.id}. Unsupported token_type ${tokens.token_type}.`)
        }

        const session = {}
        // Checks whether we have a id_token (OpenID).
        if (tokens.id_token) {
            const { payload } = await jwtVerify(
                tokens.id_token,
                jwks,
                {
                    issuer: authServerConfiguration.serverMetadata().issuer,
                }
            )
            session.id_token = tokens.id_token
            session.sub = payload.sub
        }
        // Checks the validity of the access token
        const { payload } = await jwtVerify(
            tokens.access_token,
            jwks,
            {
                issuer: authServerConfiguration.serverMetadata().issuer,
            }
        )
        // If valid, decorate the request with the access token
        session.access_token = tokens.access_token
        if (!session.sub) session.sub = payload.sub

        request.session = session

    }

    server.decorateRequest("id_session", null)
    server.addHook('onRequest', async (request, reply) => {
        let tokens = {}
        if (request.headers?.cookie) {
            // Parse the Cookie header
            const cookies = request.headers?.cookie
                .split(';')
                .map(cookie => cookie.trim().split('='))
                .reduce((acc, [key, value]) => {
                    acc[key] = decodeURIComponent(value)
                    return acc
                }, {})
            if (cookies[opts.oauth2.sessionIdCookieName]) {
                // Retrieve session information from Redis
                request.id_session = cookies[opts.oauth2.sessionIdCookieName]
                const sessionKey = SESSION_PREFIX + request.id_session
                try {
                    tokens = server.redisBreaker
                        ? await server.redisBreaker.fire('hGetAll', [sessionKey])
                        : await server.redis.hGetAll(sessionKey)
                } catch (error) {
                    const msg = `Origin: ${opts.id}. An error occurred while retrieving the stored session ${request.id_session}.`
                    server.log.error(error, msg)
                    return errorHandler(reply, 500, msg, opts.exposeErrors, error)
                }
            }
        }
        if (Object.keys(tokens).length > 0) {
            try {
                await decorateRequestWithSessionData(request, tokens)
            } catch (error) {
                if (error.code === 'ERR_JWT_EXPIRED') {
                    // If the access token has expired, attempt to renew it
                    try {
                        const freshTokens = await openIdClient.refreshTokenGrant(
                            authServerConfiguration,
                            tokens.refresh_token
                        )
                        await decorateRequestWithSessionData(request, freshTokens)
                        try {
                            await storeSession(server, freshTokens)
                        } catch (error) {
                            const msg = `Origin: ${opts.id}. An error occurred while storing the session.`
                            server.log.error(error, msg)
                            // return errorHandler(reply, 500, msg, opts.exposeErrors, error)
                        }
                    } catch (error) {
                        const msg = `Origin: ${opts.id}. Error while refreshing the access token.`
                        server.log.error(error, msg)
                        return errorHandler(reply, 500, msg, opts.exposeErrors, error)
                    }
                } else {
                    const msg = `Origin: ${opts.id}. Invalid stored session ${request.id_session}.`
                    server.log.error(error, msg)
                    return errorHandler(reply, 500, msg, opts.exposeErrors, error)
                }
            }
        }
    })

}

export async function storeSession(server, tokens) {
    try {
        const accessToken  = jwtDecode(tokens.access_token)
        const refreshToken = jwtDecode(tokens.refresh_token)
        tokens.sub = refreshToken.sub
        tokens.iat = refreshToken.iat
        const sessionKey = SESSION_PREFIX + refreshToken.sid
        server.redisBreaker
            ? await server.redisBreaker.fire('hSet', [sessionKey, tokens])
            : await server.redis.hSet(sessionKey, tokens)
        server.redisBreaker
            ? await server.redisBreaker.fire('expireAt', [sessionKey,refreshToken.exp])
            : await server.redis.expireAt(sessionKey, refreshToken.exp)
        return refreshToken.sid
    } catch (error) {
        server.log.error(error, `Error while storing the session.`)
        throw error
    }
}