import http from 'http'
import https from 'https'
import path from 'path'
import os from 'os'
import { createClient } from 'redis'
import CircuitBreaker from 'opossum'
import sessionPlugin from './session.js'
import { jwtVerify, createRemoteJWKSet } from 'jose'
import * as openIdClient from 'openid-client'
import { storeSession } from './helpers.js'
import * as utils from '../utils/utils.js'
import * as crypto from 'crypto'

export default async function (server, opts) {

  // This parameter determines whether descriptive error 
  // messages are included in the response body
  server.decorate('exposeErrors', opts.exposeErrors)

  const remoteBaseUrl = `${opts.origin.httpxOptions.protocol}//${opts.origin.httpxOptions.host}:${opts.origin.httpxOptions.port}`

  /*
   * We ensure that header names are in lowercase for the following
   * comparisons, which are case-sensitive.
   * Node HTTP library sets all headers to lower case automatically.
   */
  let aux = null
  for (const header in opts.origin.httpxOptions.headers) {
    aux = opts.origin.httpxOptions.headers[header]
    delete opts.origin.httpxOptions.headers[header]
    opts.origin.httpxOptions.headers[header.toLowerCase()] = aux
  }

  // Agents are responsible for managing connections.
  let agent = null
  if (opts.origin.agentOptions) {
    // The default protocol is 'http:'
    agent = ('https:' === opts.origin.httpxOptions.protocol ? https : http)
      .Agent(opts.origin.agentOptions)
  }

  let originBreaker = null
  if (opts.origin.originBreaker) {

    // Name of the Circuit Breaker
    opts.origin.originBreakerOptions['name'] = `fetch-${opts.id}`
    // Speedis implements its own coalescing mechanism so we disable the one from the circuit breaker.
    opts.origin.originBreakerOptions['coalesce'] = false
    // Speedis itself implements a cache mechanism so we disable the one from the circuit breaker.
    opts.origin.originBreakerOptions['cache'] = false
    // Timeout for the Circuit Breaker
    if (opts.origin.originTimeout) {
      opts.origin.originBreakerOptions['timeout'] = opts.origin.originTimeout
    }

    // Origin Breaker instance
    originBreaker = new CircuitBreaker(_fetch, opts.origin.originBreakerOptions)
    server.breakersMetrics.add([originBreaker])

    originBreaker.on('open', () => {
      // We will use this value to set the Retry-After header
      let retryAfter = new Date()
      retryAfter.setSeconds(retryAfter.getSeconds() + originBreaker.options.resetTimeout / 1000)
      originBreaker['retryAfter'] = retryAfter.toUTCString()
      server.log.error(`Origin Breaker OPEN: No requests will be made. Origin ${opts.id}.`)
    })
    originBreaker.on('halfOpen', () => {
      server.log.warn(`Origin Breaker HALF OPEN: Requests are being tested. Origin ${opts.id}.`)
    })
    originBreaker.on('close', () => {
      server.log.info(`Origin Breaker CLOSED: Requests are being made normally. Origin ${opts.id}.`)
    })

  }
  // This plugin will add the request.rawBody.
  // It will get the data using the preParsing hook.
  await server.register(import('fastify-raw-body'), {
    encoding: false
  })

  let ongoing = null
  let purgeUrlPrefix = null
  
  if (opts.cache) {
    ongoing = opts.cache.localRequestsCoalescing
      ? new Map()
      : null
    purgeUrlPrefix = path.join(opts.prefix, opts.cache.purgePath)
    const cacheableUrls = []
    opts.cache.cacheableUrlPatterns.forEach(cacheableUrlPattern => {
      try {
        cacheableUrls.push(new RegExp(cacheableUrlPattern))
      } catch (error) {
        server.log.error(`cacheableUrlPattern ${cacheableUrlPattern} is not a valid regular expresion. Origin: ${opts.id}`)
        throw new Error(`The cache configuration is invalid. Origin: ${opts.id}`)
      }
    })
    server.decorateRequest('cacheable', false)
    server.addHook('onRequest', async (request, reply) => {
      request.cacheable = false
      if ('GET' === request.method) {
        for (const cacheableUrl of cacheableUrls) {
          if (cacheableUrl.test(request.raw.url)) {
            request.cacheable = true
            break
          }
        }
      }
    })
  }

  // Backend-For-Frontend
  // Load actions libraries
  let actionsRepository = {}
  if (opts.bff) {
    // Init the catalog of available actions.
    if (!opts.bff.actionsLibraries) { opts.bff.actionsLibraries = {} }
    opts.bff.actionsLibraries['headers'] = path.resolve(process.cwd(), './src/actions/headers.js')
    opts.bff.actionsLibraries['json'] = path.resolve(process.cwd(), './src/actions/json.js')
    for (let actionsLibraryKey in opts.bff.actionsLibraries) {
      if (!path.isAbsolute(opts.bff.actionsLibraries[actionsLibraryKey])) {
        opts.bff.actionsLibraries[actionsLibraryKey] = path.resolve(
          process.cwd(),
          opts.bff.actionsLibraries[actionsLibraryKey]
        )
      }
      if (opts.bff.actionsLibraries[actionsLibraryKey].endsWith(".js")) {
        try {
          const library = await import(`file://${opts.bff.actionsLibraries[actionsLibraryKey]}`)
          Object.entries(library).forEach(([key, value]) => {
            if (typeof value === 'function') {
              if (!actionsRepository[actionsLibraryKey]) {
                actionsRepository[actionsLibraryKey] = {}
              }
              actionsRepository[actionsLibraryKey][key] = value
            }
          })
        } catch (error) {
          server.log.error(`Error importing the action library ${opts.bff.actionsLibraries[actionsLibraryKey]}. Origin: ${opts.id}`)
          throw new Error(`The transformation configuration is invalid. Origin: ${opts.id}`)
        }
      } else {
        server.log.error(`The file ${opts.bff.actionsLibraries[actionsLibraryKey]} containing the action library must have a .js extension. Origin: ${opts.id}`)
        throw new Error(`The transformation configuration is invalid. Origin: ${opts.id}`)
      }
    }

    // Init the transformations
    // If BFF is true, then at least one transformation is enforced.
    opts.bff.transformations.forEach(transformation => {
      try {
        transformation.re = new RegExp(transformation.urlPattern)
      } catch (error) {
        server.log.error(`urlPattern ${transformation.urlPattern} is not a valid regular expresion. Origin: ${opts.id}`)
        throw new Error(`The transformation configuration is invalid. Origin: ${opts.id}`)
      }
      transformation.actions.forEach(action => {
        const tokens = action.uses.split(':')
        let library = null
        let func = null
        if (tokens.length === 1) {
          library = 'speedis'
          func = tokens[0]
        } else if (tokens.length === 2) {
          library = tokens[0]
          func = tokens[1]
        } else {
          server.log.error(`The name of the action ${action.uses} is not valid. The correct format is library:action. Origin: ${opts.id}`)
          throw new Error(`The transformation configuration is invalid. Origin: ${opts.id}`)
        }
        if (!actionsRepository[library] || !actionsRepository[library][func]) {
          server.log.error(`Function ${action.uses} was not found among the available actions. Origin: ${opts.id}`)
          throw new Error(`The transformation configuration is invalid. Origin: ${opts.id}`)
        }
      })
    })
  }

  const CLIENT_REQUEST = "ClientRequest"
  const CLIENT_RESPONSE = "ClientResponse"
  const ORIGIN_REQUEST = "OriginRequest"
  const ORIGIN_RESPONSE = "OriginResponse"
  const CACHE_REQUEST = "CacheRequest"
  const CACHE_RESPONSE = "CacheResponse"

  function _transform(type, target) {
    opts.bff.transformations.forEach(transformation => {
      if (transformation.re.test(target.path)) {
        transformation.actions.forEach(action => {
          if (action.phase === type) {
            const tokens = action.uses.split(':')
            let library = null
            let func = null
            if (tokens.length === 1) {
              library = 'speedis'
              func = tokens[0]
            } else if (tokens.length === 2) {
              library = tokens[0]
              func = tokens[1]
            }
            actionsRepository[library][func](target, action.with ? action.with : null)
          }
        })
      }
    })
  }

  if (opts.oauth2) {
    // Configuration is an abstraction over the OAuth 2.0
    // Authorization Server metadata and OAuth 2.0 Client metadata
    let authServerConfiguration = null
    // Configuration instances are obtained either through:
    if (opts.oauth2.discoverySupported) {
      // (RECOMMENDED) the discovery function that discovers the OAuth 2.0
      // Authorization Server metadata using the Authorization Server's Issuer Identifier
      authServerConfiguration = await openIdClient.discovery(
        new URL(opts.oauth2.authorizationServerMetadataLocation),
        opts.oauth2.clientId, opts.oauth2.clientSecret)
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

    server.decorateRequest('access_token', null)
    server.addHook('preValidation', async (request, reply) => {
      request.access_token = null
      // Checks if the cookie header is present
      if (request.headers?.cookie) {
        // Parse the Cookie header
        const cookies = request.headers?.cookie
          .split(';')
          .map(cookie => cookie.trim().split('='))
          .reduce((acc, [key, value]) => {
            acc[key] = decodeURIComponent(value)
            return acc
          }, {})
        // Checks if the session cookie is present
        if (cookies[opts.oauth2.sessionIdCookieName]) {
          const id_session = cookies[opts.oauth2.sessionIdCookieName]
          // Retrieve session information from Redis
          const tokens = server.redisBreaker
            ? await server.redisBreaker.fire('hGetAll', [id_session])
            : await server.redis.json.get(id_session)
          // Checks whether the information was stored in Redis
          if (Object.keys(tokens).length > 0) {
            // https://openid.net/specs/openid-connect-core-1_0.html#IDToken
            try {
              // Checks the validity of the access token
              await jwtVerify(
                tokens.access_token,
                jwks,
                {
                  issuer: authServerConfiguration.serverMetadata().issuer,
                }
              )
              // If valid, decorate the request with the access token
              request.access_token = tokens.access_token
            } catch (error) {
              if (error.code === 'ERR_JWT_EXPIRED') {
                // If the access token has expired, attempt to renew it
                try {
                  const freshTokens = await openIdClient.refreshTokenGrant(
                    authServerConfiguration,
                    tokens.refresh_token
                  )
                  // If valid, decorate the request with the access token
                  await storeSession(server, freshTokens)
                  request.access_token = freshTokens.access_token
                } catch (error) {
                  const msg = `Error while refreshing the access token. Origin: ${opts.id}.`
                  server.log.error(msg, { cause: error })
                  espera
                  return reply.code(500).send(opts.exposeErrors ? msg : "")
                }
              } else {
                const msg = `Invalid access token: ${tokens.access_token}. Origin: ${opts.id}.`
                server.log.error(msg, { cause: error })
                return reply.code(400).send(opts.exposeErrors ? msg : "")
              }
            }
          }
        }
      }
    })

    await server.register(sessionPlugin, opts.oauth2)

  }

  if (opts.redis) {

    // Connecting to Redis
    // See: https://redis.io/docs/latest/develop/clients/nodejs/produsage/#handling-reconnections
    const client = createClient(opts.redis.redisOptions)
    client.on('error', error => {
      server.log.error(`Redis connection lost. Origin: ${opts.id}.`, { cause: error })
    })
    try {
      await client.connect()
      server.log.info(`Redis connection established. Origin: ${opts.id}.`)
    } catch (error) {
      throw new Error(`Unable to connect to Redis during startup. Origin: ${opts.id}.`, { cause: error })
    }

    /**
     * Wraps a Redis client so that any command you call on it will automatically have a timeout.
     * If the Redis command takes too long it will reject with a timeout error.
     *
     * @param {object} client - The original Redis client object.
     * @param {number} timeout - Optional. The maximum time (in milliseconds) to wait for a Redis command to complete before timing out. Defaults to 1000ms
     * @returns {object} - Proxy object that behaves just like the original Redis client, but with a timeout behavior added to each command.
     */
    function wrapRedisWithTimeout(client, timeout) {
      const handler = {
        get(target, prop, receiver) {
          const original = target[prop]
          // Module JSON is a special case, we need to wrap its methods
          if ('object' === typeof original && 'json' === prop) {
            return wrapRedisWithTimeout(original, timeout)
          }
          if (typeof original !== 'function') return original
          return (...args) => {
            const command = Promise.race([
              original.apply(target, args),
              new Promise((_, reject) =>
                setTimeout(() => reject(
                  new Error(`Redis command "${prop}" timed out after ${timeout} ms`)
                ), timeout)
              )
            ])
            return command
          }
        }
      }
      return new Proxy(client, handler)
    }

    /**
     * Executes a Redis command with support for both standard and RedisJSON operations.
     * This function serves as an abstraction layer to integrate with a Circuit Breaker
     * implemented using Opossum, in order to monitor and manage Redis availability.
     *
     * @function _sendCommandToRedis
     * @param {string} command - The Redis command to execute (e.g., 'json.get', 'json.set', 'set', 'get', etc.).
     * @param {Array<string|number>} args - The list of arguments for the Redis command.
     * @returns {Promise<any>} The result of the Redis command execution.
     */
    function _sendCommandToRedis(command, args, options) {
      let cmd = null
      switch (command.toLowerCase()) {
        case 'evalsha':
          cmd = client.evalSha(...args, options)
          break
        case 'expire':
          cmd = client.expire(...args, options)
          break
        case 'expireat':
          cmd = client.expireAt(...args, options)
          break
        case 'get':
          cmd = client.get(...args, options)
          break
        case 'hset':
          cmd = client.hSet(...args, options)
          break
        case 'hgetall':
          cmd = client.hGetAll(...args, options)
          break
        case 'json.get':
          cmd = client.json.get(...args, options)
          break
        case 'json.merge':
          cmd = client.json.merge(...args, options)
          break
        case 'json.set':
          cmd = client.json.set(...args, options)
          break
        case 'script exists':
          cmd = client.scriptExists(...args, options)
          break
        case 'script load':
          cmd = client.scriptLoad(...args, options)
          break
        case 'set':
          cmd = client.set(...args, options)
          break
        case 'unlink':
          cmd = client.unlink(...args, options)
          break
        default:
          throw new Error(`Command ${command} not supported.`)
      }
      return cmd
    }

    if (opts.redis.redisBreaker) {

      let redisBreakerOptions = opts.redis.redisBreakerOptions
      // Name of the Circuit Breaker
      redisBreakerOptions['name'] = `redis-${opts.id}`
      // Speedis implements its own coalescing mechanism so we disable the one from the circuit breaker.
      redisBreakerOptions['coalesce'] = false
      // Speedis itself implements a cache mechanism so we disable the one from the circuit breaker.
      redisBreakerOptions['cache'] = false
      // Timeout for the Circuit Breaker
      if (opts.redis.redisTimeout) {
        redisBreakerOptions['timeout'] = opts.redis.redisTimeout
      }

      // Redis Breaker instance
      const redisBreaker = new CircuitBreaker(_sendCommandToRedis, redisBreakerOptions)
      server.breakersMetrics.add([redisBreaker])

      redisBreaker.on('open', () => {
        // We will use this value to set the Retry-After header
        let retryAfter = new Date()
        retryAfter.setSeconds(retryAfter.getSeconds() + redisBreaker.options.resetTimeout / 1000)
        redisBreaker['retryAfter'] = retryAfter.toUTCString()
        server.log.error(`Redis Breaker OPEN: No commands will be execute. Origin ${opts.id}.`)
      })
      redisBreaker.on('halfOpen', () => {
        server.log.warn(`Redis Breaker HALF OPEN: Commands are being tested. Origin ${opts.id}.`)
      })
      redisBreaker.on('close', () => {
        server.log.info(`Redis Breaker CLOSED: Commands are being executed normally. Origin ${opts.id}.`)
      })

      server.decorate('redis', client)
      server.decorate('redisBreaker', redisBreaker)

    } else if (opts.redis.redisTimeout) {
      server.decorate('redis', wrapRedisWithTimeout(client, opts.redis.redisTimeout))
    } else {
      server.decorate('redis', client)
    }

  }

  server.addHook('onClose', (server) => {
    if (agent) agent.destroy()
    if (ongoing) ongoing.clear()
    if (server.redis) server.redis.quit()
  })

  server.all('/*', async (request, reply) => {

    // Lógica de los BFF al Hook
    //       if (opts.bff) _transform(CLIENT_REQUEST, request)

    // Métricas
    /*
    server.httpRequestsTotal
        .labels({ origin: opts.id, method: 'GET' })
        .inc()
    */

    try {

      if (request.method === "DELETE"
        && opts.cache 
        && request.raw.url.startsWith(purgeUrlPrefix)
      ) {
        return purge(request, reply)
      }

      let response = null;
      if (!request.cacheable) {

        const options = { ...opts.origin.httpxOptions }
        options.method = request.method
        options.path = generatePath(request)
        options.headers = request.headers

        const fetch = originBreaker
          ? originBreaker.fire(options, request.rawBody)
          : _fetch(options, request.rawBody)

        // The current value of the clock at the host at the time the
        // request resulting in the stored response was made.
        let requestTime = Date.now() / 1000 | 0

        // Fecth
        response = await fetch

        // The current value of the clock at the host at the time the
        // response was received.
        let responseTime = Date.now()

        // Unsure that we have a valid Date Header
        utils.ensureValidDateHeader(response, responseTime)
        response.headers['x-speedis-cache-status'] = 'CACHE_NOT_ENABLED from ' + os.hostname()
        // We reduce precision once it’s no longer needed to ensure the Date header.
        responseTime = responseTime / 1000 | 0

        // We set the attributes involved in calculating the
        // age of the content.
        response.requestTime = requestTime
        response.responseTime = responseTime

      } else {
        response = await _getCacheable(request)
      }

      // _transform(CLIENT_RESPONSE, remoteResponse, server)

      if (!response.headers['date']) {
        response.headers['date'] = new Date().toUTCString()
      }
      if (!response.headers['x-speedis-cache-status']) {
        response.headers['x-speedis-cache-status'] = 'CACHE_UNDEFINED_STATUS from ' + os.hostname()
      }
      return reply
        .code(response.statusCode)
        .headers(response.headers)
        .send(response.body)
    } catch (error) {
      server.log.error(error,
        "Error requesting to the origin. " +
        `Origin: ${opts.id}. RID: ${request.id}. Method: ${request.method}. URL: ${request.raw.url}`
      )
      // TODO: En caso de error
    }
  })

  async function purge (request, reply) {
    const fieldNames = utils.parseVaryHeader(request)
    let cacheKey = generateCacheKey(request, fieldNames)
    let toTrash = opts.cache.purgePath.slice(1) + ':'
    cacheKey = cacheKey.replace(toTrash,"")
    const now = new Date().toUTCString()
    try {
      let result = 0
      // See: https://antirez.com/news/93
      if (cacheKey.indexOf('*') > -1) {
        // See: https://github.com/redis/node-redis/blob/master/docs/scan-iterators.md
        // See: https://github.com/redis/node-redis/blob/master/docs/v4-to-v5.md#scan-iterators
        for await (const toTrash of server.redis.scanIterator({
          MATCH: cacheKey,
          COUNT: 100
        })) {
          result += await server.redis.unlink((toTrash))
        }
      } else {
        result = await server.redis.unlink(cacheKey)
      }
      if (result) {
        return reply.code(204).headers({ date: now }).send()
      } else {
        return reply.code(404).headers({ date: now }).send()
      }
    } catch (error) {
      reply.code(500)
      const msg =
        "Error purgin the cache in Redis. " +
        `Origin: ${opts.id}. Key: ${cacheKey}. RID: ${request.id}.`
      server.log.error(msg, msg, { cause: error })
      if (opts.exposeErrors) { 
        return reply.code(500).headers({ date: now }).send(msg)
      } else {
        return reply.code(500).headers({ date: now }).send()
      }
    }
  }

  function generatePath(request) {
    const prefix = request.routeOptions.url.replace("/*", "")

    return request.url.replace(prefix, "")
  }

  function _fetch(options, body) {

    return new Promise((resolve, reject) => {

      // If we are using the Circuit Breaker the timeout is managed by it.
      // In other cases, we has to manage the timeout in the request.
      let signal, timeoutId = null
      if (opts.origin.originTimeout && !options.signal) {
        const abortController = new AbortController()
        timeoutId = setTimeout(() => {
          abortController.abort()
        }, opts.origin.originTimeout)
        signal = abortController.signal
        options.signal = signal
      }

      if (body && !options.headers['Content-Length']) {
        const bodyLength = Buffer.isBuffer(body)
          ? body.length
          : Buffer.byteLength(body)
        options.headers['Content-Length'] = bodyLength
      }

      const request = (options.protocol === 'https:' ? https : http)
        .request(options, (res) => {
          let rawData = ''
          res.on('data', chunk => { rawData += chunk })
          res.on('end', () => {
            if (timeoutId) clearTimeout(timeoutId)
            resolve({ statusCode: res.statusCode, headers: res.headers, body: rawData })
          })
        })

      request.on('error', (err) => {
        if (signal && signal.aborted) {
          const error = new Error(`Timed out after ${opts.origin.originTimeout} ms`, { cause: err })
          error.code = 'ETIMEDOUT'
          reject(error)
        } else {
          reject(err)
        }
      })

      // Enviar body si existe
      if (body) {
        request.write(body)
      }
      request.end()

    })

  }

  // See: https://developer.mozilla.org/en-US/docs/Web/HTTP/Resources_and_specifications
  async function _getCacheable(request) {

    let response = {}

    // If Redis is unavailable and we can’t reach the origin when the 
    // cache is down, we return a 503.
    if (server.redisBreaker &&
      server.redisBreaker.opened &&
      opts.redis.disableOriginOnRedisOutage) {
      response.statusCode = 503
      response.headers = {
        date: new Date().toUTCString(),
        'x-speedis-cache-status': 'CACHE_REDIS_OUTAGE from ' + os.hostname()
      }
      if (opts.exposeErrors) {
        response.body = 'Redis is temporarily unavailable. Please try again later.'
      }
      return response
    }

    let remoteResponse = null;
    try {
      let tries = 1
      remoteResponse = await _get(request)
      // If the previous _get execution returned -1, it means
      // that it couldn't acquire the lock to make a request to the
      // origin. Therefore, the origin has a lock mechanism enabled,
      // and the opts.cache.distributedRequestsCoalescingOptions
      // should exist, with all its attributes being mandatory.   
      while (remoteResponse === -1
        && tries < opts.cache.distributedRequestsCoalescingOptions?.retryCount
        && !server.redisBreaker.opened) {
        let delay = opts.cache.distributedRequestsCoalescingOptions?.retryDelay +
          Math.round(Math.random() * opts.cache.distributedRequestsCoalescingOptions?.retryJitter)
        await new Promise(resolve => setTimeout(resolve, delay))
        remoteResponse = await _get(request)
        tries++
      }
      if (remoteResponse === -1) {
        response.statusCode = 503
        response.headers = {
          date: new Date().toUTCString(),
          'x-speedis-cache-status': 'CACHE_NO_LOCK from ' + os.hostname()
        }
        if (opts.exposeErrors) {
          response.body = 'Cache is temporarily unavailable due to lock acquisition failure. Please try again later.'
        }
        return response
      }
    } catch (error) {
      response.statusCode = 500
      response.headers = {
        date: new Date().toUTCString(),
        'x-speedis-cache-status': 'CACHE_ERROR_500 from ' + os.hostname()
      }
      if (opts.exposeErrors) {
        response.body =
          "Error requesting to the origin. " +
          `Origin: ${opts.id}. Url: ${request.url}. RID: ${request.id}.`
      }
      return response
    }

    // We have a response from the cache or the origin.
    // Check if we have received a conditional request.
    /*
    https://www.rfc-editor.org/rfc/rfc9110#name-etag
    ETag       = entity-tag
    entity-tag = [ weak ] opaque-tag
    weak       = %s"W/"
    opaque-tag = DQUOTE *etagc DQUOTE
    etagc      = %x21 / %x23-7E / obs-text
      ; VCHAR except double quotes, plus obs-text
    entity-tag = (W/)*\x22([\x21\x23-\x7E\x80-\xFF])*\x22
    weak       = W/
    opaque-tag = \x22([\x21\x23-\x7E\x80-\xFF])*\x22
    etag       = [\x21\x23-\x7E\x80-\xFF]
    */
    const eTagRE = /(?:W\/)*\x22(?:[\x21\x23-\x7E\x80-\xFF])*\x22/g
    let etags = []
    let lastModified = null
    for (let header in request.headers) {
      switch (header) {
        case 'if-none-match':
          etags = request.headers[header].match(eTagRE)
          etags = etags !== null ? etags : []
          break
        case 'if-modified-since':
          lastModified = request.headers[header]
          break
      }
    }

    // See: https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.2
    let ifNoneMatchCondition = true
    if (etags.length > 0) {
      if (etags.length === 1 && etags[0] === '"*"') {
        if (response && 200 === response.statusCode) {
          ifNoneMatchCondition = false
        }
      } else {
        if (Object.prototype.hasOwnProperty.call(response.headers, 'etag')) {
          let weakCacheEtag = response.headers["etag"].startsWith('W/')
            ? response.headers["etag"].substring(2) : response.headers["etag"]
          for (let index = 0; index < etags.length; index++) {
            // A recipient MUST use the weak comparison function when
            // comparing entity tags for If-None-Match
            // https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.3.2
            let weakRequestETag = etags[index].startsWith('W/')
              ? etags[index].substring(2) : etags[index]
            if (weakRequestETag === weakCacheEtag) {
              ifNoneMatchCondition = false
              break
            }
          }
        }
      }
    }

    response.headers = {
      date: new Date().toUTCString(),
      'x-speedis-cache-status': remoteResponse.headers['x-speedis-cache-status']
    }
    if (!ifNoneMatchCondition) {
      response.statusCode = 304
      return response
    } else {
      // See: https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.3
      let ifModifiedSinceCondition = true
      if (!Object.prototype.hasOwnProperty.call(request.headers, 'if-none-match')) {
        let requestlmd = lastModified
          ? Date.parse(lastModified)
          : NaN
        let cachelmd = remoteResponse.headers['last-modified']
          ? Date.parse(remoteResponse.headers['last-modified'])
          : NaN
        if (!Number.isNaN(requestlmd) && !Number.isNaN(cachelmd) && cachelmd <= requestlmd) {
          ifModifiedSinceCondition = false
        }
      }
      if (!ifModifiedSinceCondition) {
        response.statusCode = 304
        return response
      } else {
        remoteResponse.headers['date'] = response.headers['date']
        return remoteResponse
      }
    }
  }

  function generateCacheKey(request, fieldNames = utils.parseVaryHeader(request)) {
    let path = generatePath(request)
    const [base, queryString] = path.split("?")
    if (queryString) {
      const params = new URLSearchParams(queryString)
      if (opts.cache.ignoredQueryParams) {
        opts.cache.ignoredQueryParams.forEach(param => params.delete(param))
      }
      if (params.size > 0) {
        if (opts.cache.sortQueryParams) {
          const sortedParams = [...params.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => `${key}=${value}`)
            .join("&")
          path = `${base}?${sortedParams.toString()}`
        } else {
          path = `${base}?${params.toString()}`
        }
      } else {
        path = base
      }
    }

    let cacheKey = opts.cache.includeOriginIdInCacheKey ? opts.id : ''
    cacheKey += path.replaceAll('/', ':')
    if (cacheKey.startsWith(':')) cacheKey = cacheKey.slice(1)

    // See: https://www.rfc-editor.org/rfc/rfc9111.html#name-calculating-cache-keys-with
    fieldNames.forEach(fieldName => {
      if (fieldName === '*') cacheKey += ':*'
      else if (Object.prototype.hasOwnProperty.call(request.headers, fieldName)) {
        cacheKey += ':' + fieldName
          + ':' + ((request.headers[fieldName]) ? request.headers[fieldName] : '')
      }
    })
    return cacheKey
  }

  async function _get(request) {

    const path = generatePath(request)

    // We create options for an HTTP/S request to the required path
    // based on the default ones that must not be modified.
    const options = { ...opts.origin.httpxOptions }
    if (agent) options.agent = agent
    options.path = path

    const clientCacheDirectives = utils.parseCacheControlHeader(request)
    const fieldNames = utils.parseVaryHeader(request)
    let cacheKey = generateCacheKey(request, fieldNames)

    let cachedResponse = null
    try {
      cachedResponse = server.redisBreaker
        ? await server.redisBreaker.fire('json.get', [cacheKey])
        : await server.redis.json.get(cacheKey)
    } catch (error) {
      server.log.warn(error,
        "Error querying the cache entry in Redis. " +
        `Origin: ${opts.id}. Key: ${cacheKey}. RID: ${request.id}.`)
    }

    let cachedCacheDirectives = null

    if (cachedResponse) {

      // Apply transformations to the entry fetched from the cache
      cachedResponse.path = path
      if (opts.bff) _transform(CACHE_RESPONSE, cachedResponse)

      // See: https://www.rfc-editor.org/rfc/rfc9111.html#name-calculating-freshness-lifet
      const freshnessLifetime = utils.calculateFreshnessLifetime(cachedResponse)

      // See: https://www.rfc-editor.org/rfc/rfc9111.html#name-calculating-age
      const currentAge = utils.calculateAge(cachedResponse)

      // We calculate whether the cache entry is fresh or stale.
      let responseIsFresh = (currentAge <= freshnessLifetime)

      // See: https://www.rfc-editor.org/rfc/rfc9111.html#cache-request-directive.max-age
      if (Object.prototype.hasOwnProperty.call(clientCacheDirectives, 'max-age')) {
        const maxAge = parseInt(clientCacheDirectives['max-age'])
        if (!Number.isNaN(maxAge) && currentAge > maxAge) {
          responseIsFresh = false
        }
      }
      // See: https://www.rfc-editor.org/rfc/rfc9111.html#cache-request-directive.min-fresh
      if (Object.prototype.hasOwnProperty.call(clientCacheDirectives, 'min-fresh')) {
        const minFresh = parseInt(clientCacheDirectives['min-fresh'])
        const fresh = freshnessLifetime - currentAge
        if (!Number.isNaN(minFresh) && fresh < minFresh) {
          responseIsFresh = false
        }
      }
      // See: https://www.rfc-editor.org/rfc/rfc9111.html#cache-request-directive.max-stale
      if (Object.prototype.hasOwnProperty.call(clientCacheDirectives, 'max-stale')) {
        const maxStale = parseInt(clientCacheDirectives['max-stale'])
        const fresh = freshnessLifetime - currentAge
        if (!Number.isNaN(maxStale) && -maxStale <= fresh) {
          responseIsFresh = true
        }
      }

      /*
      * See: https://www.rfc-editor.org/rfc/rfc9111.html#name-no-cache
      * See: https://www.rfc-editor.org/rfc/rfc9111.html#name-no-cache-2
      * See: https://www.rfc-editor.org/rfc/rfc9111.html#cache-request-directive.no-store
      * Note that if a request containing the no-store directive is
      * satisfied from a cache, the no-store request directive does
      * not apply to the already stored response.
      */
      cachedCacheDirectives = utils.parseCacheControlHeader(cachedResponse)

      if (responseIsFresh
        &&  !Object.prototype.hasOwnProperty.call(clientCacheDirectives, 'no-cache')
        && (!Object.prototype.hasOwnProperty.call(cachedCacheDirectives, 'no-cache')
          // The qualified form of the no-cache response directive
          || cachedCacheDirectives['no-cache'] !== null)
        // https://www.rfc-editor.org/rfc/rfc9111.html#name-calculating-cache-keys-with
        // A stored response with a Vary header field value containing a member "*" always fails to match
        && !fieldNames.includes('*')) {
        utils.setCacheStatus('CACHE_HIT', cachedResponse)
        cachedResponse.headers['age'] = utils.calculateAge(cachedResponse)
        return cachedResponse
      } else {
        // We need to revalidate the response.
        if (Object.prototype.hasOwnProperty.call(cachedResponse.headers, 'etag')) {
          options.headers['if-none-match'] = cachedResponse.headers['etag']
        }
        if (Object.prototype.hasOwnProperty.call(cachedResponse.headers, 'last-modified')) {
          options.headers['if-modified-since'] = cachedResponse.headers['last-modified']
        }
      }

    }

    // Apply transformations to the request before sending it to the origin
    if (opts.bff) _transform(ORIGIN_REQUEST, options)

    // If localRequestsCoalescing is enabled, only the first request
    // will contact the origin to prevent overloading it.
    let amITheFetcher = false

    // Make the request to the origin
    let originResponse = null
    let requestTime = null
    let responseTime = null
    let lockKey, lockValue
    let locked = false

    try {

      // Verify if there is an ongoing fetch operation
      let fetch = null
      if (opts.cache.localRequestsCoalescing) {
        fetch = ongoing.get(cacheKey)
      }

      if (!fetch) {
        // https://redis.io/docs/latest/develop/use/patterns/distributed-locks/#correct-implementation-with-a-single-instance
        if (opts.cache.distributedRequestsCoalescing) {
          lockKey = `${cacheKey}.lock`
          lockValue = `${process.pid}:${opts.id}:${request.id}:` + crypto.randomBytes(4).toString("hex")
          locked = await _adquireLock(lockKey, lockValue)
        }

        if (opts.cache.distributedRequestsCoalescing && !locked) {
          // At this point, we should have acquired a lock to make a request to
          // the origin, but we haven’t. So, we return -1 to indicate that the
          // entire function should be retried, as another thread could have
          // modified the cache entry in the meantime.
          return -1
        }

        if (originBreaker) {
          fetch = originBreaker.fire(options, request.body)
        } else {
          fetch = _fetch(options, request.body)
        }
        if (opts.cache.localRequestsCoalescing) ongoing.set(cacheKey, fetch)
        amITheFetcher = true

      }

      // The current value of the clock at the host at the time the
      // request resulting in the stored response was made.
      requestTime = Date.now() / 1000 | 0

      // Fecth
      originResponse = await fetch

      // The current value of the clock at the host at the time the
      // response was received.
      responseTime = Date.now()

      // Unsure that we have a valid Date Header
      utils.ensureValidDateHeader(originResponse, responseTime)

      // We reduce precision once it’s no longer needed to ensure the Date header.
      responseTime = responseTime / 1000 | 0

      // We set the attributes involved in calculating the
      // age of the content.
      originResponse.requestTime = requestTime
      originResponse.responseTime = responseTime

    } catch (error) {

      if (opts.cache.distributedRequestsCoalescing && locked) await _releaseLock(lockKey, lockValue)
      if (amITheFetcher && opts.cache.localRequestsCoalescing) ongoing.delete(cacheKey)
      delete options.agent

      server.log.error(error,
        "Error requesting to the origin. " +
        `Origin: ${opts.id}. RID: ${request.id}. Method: ${request.method}. URL: ${request.raw.url}`
      )

      /*
      * If I was trying to refresh a cache entry,
      * I may consider serving the stale content.
      */
      // https://www.rfc-editor.org/rfc/rfc9111.html#cache-response-directive.must-revalidate
      if (cachedResponse
        && !Object.prototype.hasOwnProperty.call(cachedCacheDirectives, 'must-revalidate')
        && !Object.prototype.hasOwnProperty.call(cachedCacheDirectives, 'proxy-revalidate')) {
        server.log.warn(error,
          "Serving stale content from cache. " +
          `Origin: ${opts.id}. Key: ${cacheKey}. RID: ${request.id}.`)
        utils.setCacheStatus('CACHE_HIT_NOT_REVALIDATED_STALE', cachedResponse)
        cachedResponse.headers['age'] = utils.calculateAge(cachedResponse)
        return cachedResponse
      } else {
        const generatedResponse = {
          headers: {
            date: new Date().toUTCString()
          }
        }
        utils.setCacheStatus(
          cachedResponse ? 'CACHE_HIT_NOT_REVALIDATED' : 'CACHE_FAILED_MISS',
          generatedResponse
        )
        switch (error.code) {
          case 'ETIMEDOUT':
            generatedResponse.statusCode = 504
            break
          case 'EOPENBREAKER':
            generatedResponse.statusCode = 503
            if (originBreaker.options.resetTimeout) {
              generatedResponse.headers['retry-after'] = originBreaker.retryAfter
            }
            break
          default:
            generatedResponse.statusCode = 500
            break
        }
        return generatedResponse
      }
    }

    if (amITheFetcher && opts.cache.localRequestsCoalescing) {
      ongoing.delete(cacheKey)
    }

    // Apply transformations to the response received from the origin
    originResponse.path = path
    if (opts.bff) _transform(ORIGIN_RESPONSE, originResponse)

    // We parse the Cache-Control header to extract cache directives.
    const originCacheDirectives = utils.parseCacheControlHeader(originResponse)

    let writeCache = amITheFetcher
      && !Object.prototype.hasOwnProperty.call(clientCacheDirectives, 'no-store')
      && isCacheable(originResponse, originCacheDirectives)
    // See: https://www.rfc-editor.org/rfc/rfc9111.html#name-no-store
    // See: https://www.rfc-editor.org/rfc/rfc9111.html#name-storing-responses-in-caches

    // We generate a cache entry from the response.
    const cacheEntry = utils.cloneAndTrimResponse(originResponse)
    utils.cleanUpHeader(cacheEntry, originCacheDirectives)

    // The HTTP 304 status code, “Not Modified,” tells the client that the
    // requested resource hasn't changed since the last access
    // See: https://www.rfc-editor.org/rfc/rfc9111.html#freshening.responses
    // See: https://www.rfc-editor.org/rfc/rfc9111.html#name-freshening-responses-with-h
    if (originResponse.statusCode === 304) {

      // We set the attributes involved in calculating the age of the content.
      cachedResponse.requestTime = cacheEntry.requestTime
      cachedResponse.responseTime = cacheEntry.responseTime
      // See: https://www.rfc-editor.org/rfc/rfc9111#name-updating-stored-header-fiel
      for (let header in cacheEntry.headers) {
        if ('content-length' !== header) {
          cachedResponse.headers[header] = cacheEntry.headers[header]
        }
      }

      if (writeCache) {
        try {
          // Apply transformations to the cache entry before storing it in the cache.
          if (opts.bff) _transform(CACHE_REQUEST, cachedResponse)

          // Update the cache
          const ttl = parseInt(cachedResponse.ttl)
          const payload = {
            requestTime: cachedResponse.requestTime,
            responseTime: cachedResponse.responseTime,
            headers: cachedResponse.headers
          }
          server.redisBreaker
            ? await server.redisBreaker.fire('json.merge', [cacheKey, '$', payload])
            : await server.redis.json.merge(cacheKey, '$', payload)
          // Set the TTL for the cache entry           
          if (!Number.isNaN(ttl) && ttl > 0) {
            server.redisBreaker
              ? await server.redisBreaker.fire('expire', [cacheKey, ttl])
              : await server.redis.expire(cacheKey, ttl)
          }
        } catch (error) {
          server.log.warn(error,
            "Error while updating the cache. " +
            `Origin: ${opts.id}. Key: ${cacheKey}. RID: ${request.id}.`
          )
        }
      }
    } else {

      if (writeCache) {
        // Apply transformations to the cache entry before storing it in the cache.
        if (opts.bff) _transform(CACHE_REQUEST, cacheEntry)
        const ttl = parseInt(cacheEntry.ttl)
        try {
          server.redisBreaker
            ? await server.redisBreaker.fire('json.set', [cacheKey, '$', cacheEntry])
            : await server.redis.json.set(cacheKey, '$', cacheEntry)
          // Set the TTL for the cache entry           
          if (!Number.isNaN(ttl) && ttl > 0) {
            server.redisBreaker
              ? await server.redisBreaker.fire('expire', [cacheKey, ttl])
              : await server.redis.expire(cacheKey, ttl)
          }
        } catch (error) {
          server.log.warn(error,
            "Error while storing in the cache. " +
            `Origin: ${opts.id}. Key: ${cacheKey}. RID: ${request.id}.`
          )
        }
      }

    }

    /*
    * If the origin server response included Cache-Control: no-store,
    * it should not have been stored in the cache at all.
    * If, by mistake, it was stored, you must delete it immediately.
    *
    * If the origin server response included Cache-Control: private,
    * a shared caches should not store it in the cache at all.
    * If a shared cache has already stored the response by mistake,
    * it is recommended to delete it to comply with the directive.
    */
    if (Object.prototype.hasOwnProperty.call(originCacheDirectives, 'no-store')
      // The unqualified form of the private response directive
      || (Object.prototype.hasOwnProperty.call(originCacheDirectives, 'private')
        && originCacheDirectives['private'] === null)) {
      try {
        server.redisBreaker
          ? await server.redisBreaker.fire('unlink', [cacheKey])
          : await server.redis.unlink(cacheKey)
      } catch (error) {
        server.log.warn(error,
          "Error while removing private/no-store entry in the cache. " +
          `Origin: ${opts.id}. Key: ${cacheKey}. RID: ${request.id}.`
        )
      }
    }

    // In this point the Cache Entry has been updated or deleted in Redis.
    if (opts.cache.distributedRequestsCoalescing && locked) await _releaseLock(lockKey, lockValue)

    // See: https://www.rfc-editor.org/rfc/rfc9111.html#cache-request-directive.only-if-cached
    if (Object.prototype.hasOwnProperty.call(clientCacheDirectives, 'only-if-cached')
      && cachedResponse == null) {
      const generatedResponse = {
        statusCode: 504,
        headers: {
          'date': new Date().toUTCString()
        }
      }
      utils.setCacheStatus('CACHE_MISS', generatedResponse)
      return generatedResponse
    }

    if (originResponse.statusCode === 304) {
      utils.setCacheStatus('CACHE_HIT_REVALIDATED_304', cachedResponse)
      return utils.cloneAndTrimResponse(cachedResponse)
    } else {
      utils.setCacheStatus(
        cachedResponse ? 'CACHE_HIT_REVALIDATED' : 'CACHE_MISS', originResponse
      )
      return utils.cloneAndTrimResponse(originResponse)
    }

  }

  async function _adquireLock(lockKey, lockValue) {
    let lockTTL
    if (opts.origin.lockOptions
      && opts.cache.distributedRequestsCoalescingOptions?.lockTTL
      && opts.cache.distributedRequestsCoalescingOptions?.lockTTL > 0) {
      lockTTL = opts.cache.distributedRequestsCoalescingOptions?.lockTTL
    } else if (opts.origin.originTimeout && opts.origin.originTimeout > 0) {
      lockTTL = Math.round(opts.origin.originTimeout * 1.2)
    } else {
      lockTTL = Math.round(Math.random() * 10000)
    }

    let locked = false
    try {
      let lockResponse = server.redisBreaker
        ? await server.redisBreaker.fire('set', [lockKey, lockValue, { NX: true, PX: lockTTL }])
        : await server.redis.set(lockKey, lockValue, { NX: true, PX: lockTTL })
      locked = ('OK' === lockResponse)
    } catch (error) {
      server.log.warn(error,
        "Error acquiring the lock. " +
        `Origin: ${opts.id}. Key: ${lockKey}. Value: ${lockValue}. LockTTL: ${lockTTL}.`
      )
    } finally {
      return locked
    }
  }

  // Remove the key only if it exists and the value stored at the  key
  // is exactly the one I expect to be
  const releaseLockScript = `
    if redis.call("get",KEYS[1]) == ARGV[1] then
      return redis.call("unlink",KEYS[1])
    else
      return 0
    end
  `
  const releaseLockScriptSHA1 = crypto.createHash('sha1').update(releaseLockScript).digest('hex')
  async function _releaseLock(lockKey, lockValue) {
    try {
      const exists = server.redisBreaker
        ? await server.redisBreaker.fire('script exists', [releaseLockScriptSHA1])
        : await server.redis.scriptExists(releaseLockScriptSHA1)
      if (!exists[0]) {
        server.redisBreaker
          ? await server.redisBreaker.fire('script load', [releaseLockScript])
          : await server.redis.scriptLoad(releaseLockScript)
      }
      server.redisBreaker
        ? await server.redisBreaker.fire('evalsha', [
          releaseLockScriptSHA1,
          {
            keys: [lockKey],
            arguments: [lockValue]
          }
        ])
        : await server.redis.evalSha(
          releaseLockScriptSHA1,
          {
            keys: [lockKey],
            arguments: [lockValue]
          }
        )
    } catch (error) {
      server.log.warn(error,
        "Error releasing the lock. " +
        `Origin: ${opts.id}. Key: ${lockKey}. Value: ${lockValue}.`
      )
    }
  }

  // See: https://www.rfc-editor.org/rfc/rfc9111.html#name-storing-responses-in-caches
  function isCacheable(originResponse, originCacheDirectives) {
    let isTheResponseCacheable =
      // The request method is always GET
      // The response status code is final
      originResponse.statusCode >= 200
      // This cache doesn't understands Partial Content
      && originResponse.statusCode !== 206
      // This cache understands 304 Not Modified
      // && originResponse.statusCode !== 304

      // TODOD: Implements support for the must-understand cache directive
      // In this context, a cache has "understood" a request method or a
      // response status code if it recognizes it and implements all
      // specified caching-related behavior.
      // https://www.rfc-editor.org/rfc/rfc9111.html#cache-response-directive.must-understand

      // See: https://www.rfc-editor.org/rfc/rfc9111.html#name-no-store-2
      && !Object.prototype.hasOwnProperty.call(originCacheDirectives, 'no-store')
      // See: https://www.rfc-editor.org/rfc/rfc9111.html#name-private
      && (!Object.prototype.hasOwnProperty.call(originCacheDirectives, 'private')
        // // The qualified form of the private response directive
        || originCacheDirectives['private'] !== null
      )
      && (!Object.prototype.hasOwnProperty.call(originResponse.headers, 'authorization')
        || Object.prototype.hasOwnProperty.call(originCacheDirectives, 'must-revalidate')
        || Object.prototype.hasOwnProperty.call(originCacheDirectives, 'public')
        || Object.prototype.hasOwnProperty.call(originCacheDirectives, 's-maxage')
      )
      && (Object.prototype.hasOwnProperty.call(originCacheDirectives, 'public')
        || Object.prototype.hasOwnProperty.call(originResponse.headers, 'expires')
        || Object.prototype.hasOwnProperty.call(originCacheDirectives, 'max-age')
        || Object.prototype.hasOwnProperty.call(originCacheDirectives, 's-maxage')
        //  || a cache extension that allows it to be cached
        //  || a status code that is defined as heuristically cacheable
      )
    return isTheResponseCacheable
  }

}
