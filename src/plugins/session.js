import * as openidClient from 'openid-client'
import * as crypto from 'crypto'
import { jwtDecode } from "jwt-decode"


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
          : await server.redis.SET(parameters.state, codeVerifier, { EX: opts.authorizationCodeTtl })
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
          : await server.redis.GET(request.query['state'])
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
      tokens = await openidClient.authorizationCodeGrant(
        server.authServerConfiguration,
        new URL(request.raw.url, opts.baseUrl),
        checks
      )
    } catch (error) {
      server.log.error(
        `Error while executing the authorization code grant. Origin: ${opts.id}.`, { cause: error }
      )
      throw error
    }
    
    let token = jwtDecode(tokens.refresh_token?tokens.refresh_token:tokens.access_token)
    const id_session = crypto.randomUUID()
    try {
      server.redisBreaker
        ? await server.redisBreaker.fire('hSet', [id_session, tokens])
        : await server.redis.hSet(id_session, tokens)
      server.redisBreaker
        ? await server.redisBreaker.fire('expireAt', [id_session, token.exp])
        : await server.redis.expireAt(id_session, token.exp)
      if (opts.pkceEnabled) { 
        server.redisBreaker
          ? await server.redisBreaker.fire('unlink', [request.query['state']])
          : await server.redis.unlink(request.query['state'])
      }
    } catch (error) {
      server.log.error(
        `Error while storing the session.`, { cause: error }
      )
      throw error
    }
    // We set the tokenId in a cookie
    // https://github.com/fastify/fastify-cookie?tab=readme-ov-file#sending
    reply.header('set-cookie', `${opts.sessionIdCookieName}=${id_session}; Path=/; Secure; HttpOnly`)
    return reply.send(tokens)
    // return reply.redirect(opts.postAuthRedirectUrl)
  })

}
