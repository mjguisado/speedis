import * as openidClient from 'openid-client'
import { createClient } from 'redis'
import * as crypto from 'crypto'
import { jwtDecode } from "jwt-decode"

// https://medium.com/google-cloud/understanding-oauth2-and-building-a-basic-authorization-server-of-your-own-a-beginners-guide-cf7451a16f66
// https://skycloak.io/blog/keycloak-how-to-create-a-pkce-authorization-flow-client/
// https://github.com/panva/openid-client
// https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderConfig
// https://www.rfc-editor.org/rfc/rfc8414
// https://www.rfc-editor.org/rfc/rfc6749
// https://www.iana.org/assignments/oauth-parameters/oauth-parameters.xhtml#authorization-server-metadata

// TODO: Redis breaker
export default async function (server, opts) {

  const { id } = opts
  server.decorate('id', id)

  const discoverySupported = true
  const authorizationServerMetadataLocation =
    'https://keycloak.local:8443/realms/speedis/.well-known/openid-configuration'

  // https://www.iana.org/assignments/oauth-parameters/oauth-parameters.xhtml#authorization-server-metadata
  const authorizationServerMetadata = {
    // Authorization server's issuer identifier URL
    issuer: 'https://keycloak.local:8443/realms/speedis',
    // URL of the authorization server's authorization endpoint
    authorization_endpoint: 'https://keycloak.local:8443/realms/speedis/protocol/openid-connect/auth',
    // URL of the authorization server's token endpoint
    token_endpoint: 'https://keycloak.local:8443/realms/speedis/protocol/openid-connect/token',
    response_types_supported: ["code", "none", "id_token", "token", "id_token token", "code id_token", "code token", "code id_token token"]
  }
  
  // https://www.rfc-editor.org/rfc/rfc6749#section-4.1.1 
  const authorizationRequest = {
    scope: "openid email profile"
  }

  const tokenIdCookieName = 'JSESSION_ID'
  const clientId = 'confiable'
  const clientSecret = '3ucOCEJzDiA1KXcl08CYMH6J2HBztgFh'
  const pkceEnabled = true
  const baseUrl = 'https://3011-79-148-35-134.ngrok-free.app'
  const codeVerifierTtl = 300

  // Configuration is an abstraction over the OAuth 2.0 
  // Authorization Server metadata and OAuth 2.0 Client metadata
  let configuration = null
  // Configuration instances are obtained either through:
  if (discoverySupported) {
    // (RECOMMENDED) the discovery function that discovers the OAuth 2.0 
    // Authorization Server metadata using the Authorization Server's Issuer Identifier
    configuration = await openidClient.discovery(
      new URL(authorizationServerMetadataLocation),
      clientId, clientSecret)
  } else {
    // The Configuration constructor if the OAuth 2.0 Authorization 
    // Server metadata is known upfront
    configuration = new openidClient.Configuration(
      authorizationServerMetadata, clientId, clientSecret
    )
  }

  // Connecting to Redis
  let redisClient = createClient({
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


  server.get('/login', async (request, reply) => {
    /*
    The client initiates the flow by directing the resource owner's
    user-agent to the authorization endpoint.  The client includes
    its client identifier, requested scope, local state, and a
    redirection URI to which the authorization server will send the
    user-agent back once access is granted (or denied).
    */
    let redirect_uri = new URL(
      request.url.slice(0, request.url.lastIndexOf('/login')) + '/callback',
      baseUrl
    )
    const parameters = {
      redirect_uri,
      ...authorizationRequest,
    }

    if (pkceEnabled) {
      // PKCE works by having the client create a secret string, 
      // nown as the Code Verifier, before it starts the authorization process.
      const codeVerifier = openidClient.randomPKCECodeVerifier()
      // This verifier is transformed into a Code Challenge by using a hashing function (SHA256).
      parameters.code_challenge_method = 'S256'
      parameters.code_challenge = await openidClient.calculatePKCECodeChallenge(codeVerifier)
      parameters.state = 'cv:' + crypto.randomUUID()
      try {
        await redisClient.set(parameters.state, codeVerifier, { EX: codeVerifierTtl })
      } catch (error) {
        server.log.error(
          `Error while storing the code verifier. Origin: ${server.id}.`, { cause: error }
        )
        throw error
      }
    }

    return reply.redirect(openidClient.buildAuthorizationUrl(configuration, parameters))

  })

  server.get('/callback', async (request, reply) => {
    const checks = {}
    if (pkceEnabled) {
      let code_verifier
      try {
        code_verifier = await redisClient.get(request.query['state'])
      } catch (error) {
        server.log.error(
          `Error while retrieving the code verifier. Origin: ${server.id}.`, { cause: error }
        )
        code_verifier = 'it will fail'
      }
      checks.expectedState = request.query['state']
      checks.pkceCodeVerifier = code_verifier
    }

    let tokens = null;
    try {
      tokens = await openidClient.authorizationCodeGrant(
        configuration,
        new URL(request.raw.url, baseUrl),
        checks
      )
    } catch (error) {
      server.log.error(
        `Error while executing the authorization code grant. Origin: ${server.id}.`, { cause: error }
      )
      throw error
    }

    const id_token = jwtDecode(tokens.id_token)
    try {
      await redisClient.HSET(id_token.jti, tokens)
      await redisClient.EXPIREAT(id_token.jti, id_token.exp)
      await redisClient.UNLINK(request.query['state'])
    } catch (error) {
      server.log.error(
        `Error while storing the session.`, { cause: error }
      )
      throw error
    }

    // We set the tokenId in a cookie
    // https://github.com/fastify/fastify-cookie?tab=readme-ov-file#sending
    reply.header('set-cookie', `${tokenIdCookieName}=${id_token.jti}; Path=/; Secure; HttpOnly`)
    return reply.redirect("https://bankinter.com")
    // reply.send(tokens)
  })

}