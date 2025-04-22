import * as openidClient from 'openid-client'
import * as crypto from 'crypto'
import { storeSession } from './helpers.js'
import { jwtVerify } from 'jose'

// https://medium.com/google-cloud/understanding-oauth2-and-building-a-basic-authorization-server-of-your-own-a-beginners-guide-cf7451a16f66
// https://skycloak.io/blog/keycloak-how-to-create-a-pkce-authorization-flow-client/
// https://github.com/panva/openid-client
// https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderConfig
// https://www.rfc-editor.org/rfc/rfc8414
// https://www.rfc-editor.org/rfc/rfc6749
// https://www.iana.org/assignments/oauth-parameters/oauth-parameters.xhtml#authorization-server-metadata

export default async function (server, opts) {

  server.get(opts.redirectPath, async (request, reply) => {
    /*
    The client initiates the flow by directing the resource owner's
    user-agent to the authorization endpoint.  The client includes
    its client identifier, requested scope, local state, and a
    redirection URI to which the authorization server will send the
    user-agent back once access is granted (or denied).
    */
    const parameters = {
      ... opts.authorizationRequest,
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
          ? await server.redisBreaker.fire('set', [parameters.state, codeVerifier, { EX: opts.authorizationCodeTtl } ])
          : await server.redis.set(parameters.state, codeVerifier, { EX: opts.authorizationCodeTtl })
      } catch (error) {
        server.log.error(
          `Error while storing the code verifier. Origin: ${opts.id}.`, { cause: error }
        )
        throw error
      }
    }

    try {
      const url = openidClient.buildAuthorizationUrl(server.authServerConfiguration, parameters)
      return reply.redirect(url)
    } catch (error) {
      server.log.error(
        `Error while building authorization url. Origin: ${opts.id}.`, { cause: error }
      )
      throw error
    }

  })

  server.get(opts.callbackPath, async (request, reply) => {
 
    const checks = {}

    if (opts.pkceEnabled) {
      let code_verifier
      try {
        code_verifier = server.redisBreaker
          ? await server.redisBreaker.fire('get', [request.query['state']])
          : await server.redis.get(request.query['state'])
      } catch (error) {
        server.log.error(
          `Error while retrieving the code verifier. Origin: ${opts.id}.`, { cause: error }
        )
        code_verifier = 'it will fail'
      }
      checks.expectedState = request.query['state']
      checks.pkceCodeVerifier = code_verifier
    }

    let tokens = null
    try {
      const index = request.raw.url.indexOf(opts.prefix);
      const path = index !== -1 ? request.raw.url.slice(index) : request.raw.url;
      const currentUrl = new URL(path, opts.baseUrl)
      tokens = await openidClient.authorizationCodeGrant(
        server.authServerConfiguration,
        currentUrl,
        checks
      )
    } catch (error) {
      server.log.error(
        `Error while executing the authorization code grant. Origin: ${opts.id}.`, { cause: error }
      )
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

  server.post(opts.logoutPath, async (request, reply) => {
    let id_session = null;
    try {
       const { payload } = await jwtVerify(
        request.body, 
        server.jwks,
        {
          issuer: server.authServerConfiguration.serverMetadata().issuer,
        }
      )
      id_session = payload.sid
    } catch (error) {
      const msg = `Invalid logout token: ${request.body}. Origin: ${opts.id}.`
      server.log.error(msg, { cause: error })
      return reply
        .code(400)
        .headers({date: new Date().toUTCString()})
        .send(server.exposeErrors?msg:"")
    }
    try {
      server.redisBreaker
          ? await server.redisBreaker.fire('unlink', [id_session])
          : await server.redis.unlink(id_session)
    } catch (error) {
      const msg = `Error while deleting the session ${id_session}. Origin: ${opts.id}.`
      server.log.error(msg,{ cause: error })
      return reply
        .code(500)
        .headers({date: new Date().toUTCString()})
        .send(server.exposeErrors?msg:"")
    } 
    return reply
      .code(204)
      .headers({date: new Date().toUTCString()})
      .send()
  })
}
