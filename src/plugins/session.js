import * as openidClient from 'openid-client'
import * as crypto from 'crypto'
import { storeSession } from '../modules/oauth2.js'

// https://medium.com/google-cloud/understanding-oauth2-and-building-a-basic-authorization-server-of-your-own-a-beginners-guide-cf7451a16f66
// https://skycloak.io/blog/keycloak-how-to-create-a-pkce-authorization-flow-client/
// https://github.com/panva/openid-client
// https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderConfig
// https://www.rfc-editor.org/rfc/rfc8414
// https://www.rfc-editor.org/rfc/rfc6749
// https://www.iana.org/assignments/oauth-parameters/oauth-parameters.xhtml#authorization-server-metadata

export const SESSION_INDEX_NAME = 'idx:sessions'
export const SESSION_PREFIX = 'sessions:'

export default async function (server, opts) {

    server.get('/login', async (request, reply) => {

        /*
        The client initiates the flow by directing the resource owner's
        user-agent to the authorization endpoint.  The client includes
        its client identifier, requested scope, local state, and a
        redirection URI to which the authorization server will send the
        user-agent back once access is granted (or denied).
        */
        const parameters = {
            ...opts.authorizationRequest,
        }

        if (opts.pkceEnabled) {
            // PKCE works by having the client create a secret string,
            // nown as the Code Verifier, before it starts the authorization process.
            const codeVerifier = openidClient.randomPKCECodeVerifier()
            // This verifier is transformed into a Code Challenge by using a hashing function (SHA256).
            parameters.code_challenge_method = 'S256'
            parameters.code_challenge = await openidClient.calculatePKCECodeChallenge(codeVerifier)
            parameters.state = 'cv:' + crypto.randomUUID()
            try {
                server.redisBreaker
                    ? await server.redisBreaker.fire('set', [parameters.state, codeVerifier, { EX: opts.authorizationCodeTtl }])
                    : await server.redis.set(parameters.state, codeVerifier, { EX: opts.authorizationCodeTtl })
            } catch (error) {
                server.log.error(error
                    `Error while storing the code verifier. Origin: ${opts.id}.`)
                throw error
            }
        }

        try {
            const url = openidClient.buildAuthorizationUrl(server.authServerConfiguration, parameters)
            return reply.redirect(url)
        } catch (error) {
            server.log.error(error
                `Error while building authorization url. Origin: ${opts.id}.`)
            throw error
        }

    })

    server.get('/callback', async (request, reply) => {

        const checks = {}

        if (opts.pkceEnabled) {
            let code_verifier
            try {
                code_verifier = server.redisBreaker
                    ? await server.redisBreaker.fire('get', [request.query['state']])
                    : await server.redis.get(request.query['state'])
            } catch (error) {
                server.log.error(error,
                    `Error while retrieving the code verifier. Origin: ${opts.id}.`)
                code_verifier = 'it will fail'
            }
            checks.expectedState = request.query['state']
            checks.pkceCodeVerifier = code_verifier
        }

        let tokens = null
        try {
            const index = request.raw.url.indexOf(opts.prefix)
            const path = index !== -1 ? request.raw.url.slice(index) : request.raw.url
            const currentUrl = new URL(path, opts.baseUrl)
            tokens = await openidClient.authorizationCodeGrant(
                server.authServerConfiguration,
                currentUrl,
                checks
            )
        } catch (error) {
            server.log.error(error,
                `Error while executing the authorization code grant. Origin: ${opts.id}.`)
            throw error
        }

        const id_session = await storeSession(server, tokens)
        if (opts.pkceEnabled) {
            server.redisBreaker
                ? await server.redisBreaker.fire('unlink', [request.query['state']])
                : await server.redis.unlink(request.query['state'])
        }

        // We set the tokenId in a cookie
        // https://github.com/fastify/fastify-cookie?tab=readme-ov-file#sending
        reply.header('set-cookie', `${opts.sessionIdCookieName}=${id_session}; Path=/; Secure; HttpOnly`)
        return reply.redirect(opts.postAuthRedirectUri)
    })

    server.get('/logout', async (request, reply) => {
        let postLogoutRedirectUri = opts.logoutRequest.post_logout_redirect_uri
        if (request.session?.id_token) {
            const parameters = {
                ...opts.logoutRequest,
                id_token_hint: request.session.id_token,
            }
            try {
                postLogoutRedirectUri = openidClient.buildEndSessionUrl(
                    server.authServerConfiguration,
                    parameters
                )
            } catch (error) {
                server.log.error(error,
                    `Error while building end session url. Origin: ${opts.id}.`)
                throw error
            }
        }
        if (request.id_session) {
            const sessionKey = SESSION_PREFIX + request.id_session
            try {
                server.redisBreaker
                    ? await server.redisBreaker.fire('unlink', [sessionKey])
                    : await server.redis.unlink(sessionKey)            
            } catch (error) {
                server.log.error(error,
                    `Error while unlinking the session ${sessionKey}. Origin: ${opts.id}.`)
                throw error
            }
        }
        return reply
            .header('set-cookie', `${opts.sessionIdCookieName}=; Path=/; Secure; HttpOnly; Max-Age=0`)
            .redirect(postLogoutRedirectUri)
    })

    server.post('/sessions/:id_session/invalidate', async (request, reply) => {

        const { id_session } = request.params
        const sessionKey = SESSION_PREFIX + id_session
        const now = new Date().toUTCString()

        try {
            if (await invalidateSession(sessionKey)) {
                return reply.code(204).headers({ date: now }).send()
            } else {
                return reply.code(404).headers({ date: now }).send()
            }
        } catch (error) {
            const msg = "Error invalidating the session. " +
                `Origin: ${opts.id}. Session ID: ${id_session}. RID: ${request.id}.`
            server.log.error(error, msg)
            if (opts.exposeErrors) {
                return reply.code(500).headers({ date: now }).send(msg)
            } else {
                return reply.code(500).headers({ date: now }).send()
            }
        }
    })

    server.post('/users/:sub/sessions/invalidate', async (request, reply) => {
        const { sub } = request.params
        const now = new Date().toUTCString()
        try {
            const sessions = server.redisBreaker
                ? await server.redisBreaker.fire('ft.search', [
                    SESSION_INDEX_NAME,
                    `@sub:{${sub}}`,
                    {
                        SORTBY: {
                            BY: 'iat',
                            DIRECTION: 'DESC' // or 'ASC (default if DIRECTION is not present)
                        }
                    }
                ])
                : await server.redis.ft.search(
                    SESSION_INDEX_NAME,
                    `@sub:{\"${sub}\"}`,
                    {
                        SORTBY: {
                            BY: 'iat',
                            DIRECTION: 'DESC' // or 'ASC (default if DIRECTION is not present)
                        },
                        DIALECT: 2
                    }
                )
            if (sessions.total > 0) {
                const sessionsToInvalidate = []
                for (const session of sessions.documents) {
                    sessionsToInvalidate.push(
                        invalidateSession(session.id, session.value)
                    )
                }
                const invalidations = await Promise.allSettled(sessionsToInvalidate)
                invalidations.forEach((invalidation, i) => {
                    if (invalidation.status === 'rejected') {
                        server.log.warn(`Failed to invalidate session ${sessions.documents[i].id.replace(SESSION_PREFIX, '')}:`, invalidation.reason)
                    }
                })
                reply.code(204).headers({ date: now }).send()
            } else {
                return reply.code(404).headers({ date: now }).send()
            }
        } catch (error) {
            const msg = "Error invalidating the user’s sessions. " +
                `Origin: ${opts.id}. User ID: ${sub}. RID: ${request.id}.`
            server.log.error(error, msg)
            if (opts.exposeErrors) {
                return reply.code(500).headers({ date: now }).send(msg)
            } else {
                return reply.code(500).headers({ date: now }).send()
            }
        }
    })

    async function invalidateSession(sessionKey, tokens) {

        if (!tokens) {
            tokens = server.redisBreaker
                ? await server.redisBreaker.fire('hGetAll', [sessionKey])
                : await server.redis.hGetAll(sessionKey)
        }
        if (Object.keys(tokens).length > 0) {
            await openidClient.tokenRevocation(
                server.authServerConfiguration,
                tokens.access_token,
                { token_type_hint: 'access_token' }
            )
            await openidClient.tokenRevocation(
                server.authServerConfiguration,
                tokens.refresh_token,
                { token_type_hint: 'refresh_token' }
            )
        }
        return server.redisBreaker
            ? await server.redisBreaker.fire('unlink', [sessionKey])
            : await server.redis.unlink(sessionKey)
    }

}
