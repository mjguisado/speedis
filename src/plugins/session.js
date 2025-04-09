import * as openidClient from 'openid-client'
import { createClient } from 'redis'
import * as crypto from 'crypto'
import { jwtDecode } from "jwt-decode"

// https://medium.com/google-cloud/understanding-oauth2-and-building-a-basic-authorization-server-of-your-own-a-beginners-guide-cf7451a16f66
// https://skycloak.io/blog/keycloak-how-to-create-a-pkce-authorization-flow-client/
// https://github.com/panva/openid-client
// https://datatracker.ietf.org/doc/html/rfc6749

export default async function (server, opts) {

  const {id} = opts
  server.decorate('id', id)

  // Initializing the OpenID Client
  const authServerIssuerId = new URL('https://keycloak.local:8443/realms/speedis')
  const clientId = 'confiable'
  const clientSecret = '3ucOCEJzDiA1KXcl08CYMH6J2HBztgFh'
  const redirect_uri = 'https://fdc4-79-148-39-182.ngrok-free.app/mocks/sessions/callback'
  const baseUrl = 'https://fdc4-79-148-39-182.ngrok-free.app'
  const codeVerifierTTL = 300

  // Connecting to Redis
  // See: https://redis.io/docs/latest/develop/clients/nodejs/produsage/#handling-reconnections
  const redisClient = createClient({
    "url": "redis://redis:6379"
  })
  redisClient.on('error', error => {
    server.log.error(`Redis connection lost. Origin: ${server.id}.`, { cause: error })
  })
  try {
    await redisClient.connect()
    server.log.info(`Redis connection established. Origin: ${server.id}.`)
  } catch (error) {
    throw new Error(`Unable to connect to Redis during startup. Origin: ${server.id}.`, { cause: error })
  }

  // Performs Authorization Server Metadata discovery and returns a 
  // Configuration with the discovered Authorization Server metadata.
  const authServerConfig = 
    await openidClient.discovery(authServerIssuerId, clientId, clientSecret)

  server.get('/login', async (request, reply) => {
    // PKCE works by having the client create a secret string, 
    // nown as the Code Verifier, before it starts the authorization process.
    const codeVerifier = openidClient.randomPKCECodeVerifier()
    const codeVerifierId = 'cv:' + crypto.createHash('sha256').update(codeVerifier).digest('base64url')
    // This verifier is transformed into a Code Challenge by using a hashing function (SHA256).
    const code_challenge = await openidClient.calculatePKCECodeChallenge(codeVerifier)
    const parameters = {
      redirect_uri,
      scope: 'openid email profile',
      code_challenge,
      code_challenge_method: 'S256',
      state: codeVerifierId
    }
    if (!authServerConfig.serverMetadata().supportsPKCE()) {
      parameters.state = openidClient.randomState()
    }
    try {
      await redisClient.set(codeVerifierId, codeVerifier, { EX: codeVerifierTTL })
      // The Code Challenge is sent to the authorization server along 
      // with the authorization request.
      const redirectTo = openidClient.buildAuthorizationUrl(authServerConfig, parameters)
      return reply.redirect(redirectTo)
    } catch (error) {
      server.log.error(
        `Error while storing the code verifier. Origin: ${server.id}.`, { cause: error }
      )
      throw error
    }
  })

  server.get('/callback', async (request, reply) => {
    
    const state = await request.query['state']

    let code_verifier = null;
    try {
      code_verifier = await redisClient.get(state)
    } catch (error) {
      server.log.error(
        `Error while retrieving the code verifier. Origin: ${server.id}.`, { cause: error }
      )
      throw error
    }

    // Puede que haya expirado
    if (!code_verifier) {}

    let tokens = null;
    try {
      tokens = await openidClient.authorizationCodeGrant(
        authServerConfig, 
        new URL(request.raw.url, baseUrl),
        {
          pkceCodeVerifier: code_verifier,
          expectedState: state,
        }
      )
    } catch (error) {
      server.log.error(
        `Error while executing the authorization code grant. Origin: ${server.id}.`, { cause: error }
      )
      throw error
    }

    const id_token      = jwtDecode(tokens.id_token)
    // const access_token  = jwtDecode(tokens.access_token)
    // const refresh_token = jwtDecode(tokens.refresh_token)

    try {
      await redisClient
        .multi()
        .HSET(
          id_token.jti,
          {
            access_token: tokens.access_token, 
            expires_in: tokens.expires_in,
            refresh_expires_in: tokens.refresh_expires_in,
            refresh_token: tokens.refresh_token,
            token_type: tokens.token_type,
            id_token: tokens.id_token,
            'not-before-policy': tokens['not-before-policy'],
            session_state: tokens.session_state,	
            scope: tokens.scope
          }
        )
        .EXPIREAT(id_token.jti, id_token.exp)
        // .HEXPIREAT(id_token.jti, ['access_token'],  access_token.exp)
        // .HEXPIREAT(id_token.jti, ['refresh_token'], refresh_token.exp)
        .exec()
    } catch (error) {
      server.log.error(
        `Error while storing the session.`, { cause: error }
      )
      throw error
    }

    // We set the tokenId in a cookie
    /*
    reply.setCookie('token_id', tokenId, {
      path: '/',
      httpOnly: true,
      secure: false, // true en producción
    })
    */
    reply.send(tokens)
  })
}