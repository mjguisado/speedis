import os from 'os'
import http from 'http'
import https from 'https'
// import http2 from 'http2'
import { createClient } from 'redis'
import * as utils from '../util/utils.js'
import * as actionsLib from '../actions/actions.js'
import Ajv from "ajv"

export default async function (server, opts) {

  const { id, origin, agentOpts, redisOpts, mutations } = opts

  server.decorate('id', id)

  const ajv = new Ajv()

  // TODO: Completar validaciones.
  // https://nodejs.org/api/http.html#httprequestoptions-callback
  // https://github.com/redis/node-redis/blob/master/docs/client-configuration.md

  // https://nodejs.org/api/http.html#new-agentoptions
  const validateAgentOptions = ajv.compile(
    {
      type: "object",
      additionalProperties: false,
      properties: {
        keepAlive: { type: "boolean" },
        keepAliveMsecs: { type: "integer" },
        maxSockets: { type: "integer" },
        maxTotalSockets: { type: "integer" },
        maxFreeSockets: { type: "integer" },
        scheduling: { type: "string" },
        timeout: { type: "integer" }
      }
    }
  )

  const ORIGIN_REQUEST  = "OriginRequest"
  const ORIGIN_RESPONSE = "OriginResponse"
  const CACHE_REQUEST   = "CacheRequest"
  const CACHE_RESPONSE  = "CacheResponse"

  const validateMutations = ajv.compile(
    {
      type: "array",
      items: {
        type: "object",
        minProperties: 2,
        maxProperties: 2,
        additionalProperties: false,
        required: ["urlPattern", "actions"],
        properties: {
          urlPattern: { type: "string" },
          actions: {
            type: "array",
            items: {
              type: "object",
              minProperties: 2,
              maxProperties: 3,
              required: ["phase", "func"],
              properties: {
                phase:  { enum: [ORIGIN_REQUEST, ORIGIN_RESPONSE, CACHE_REQUEST, CACHE_RESPONSE] },
                func:   { type: "string" },
                params: { type: "object" }
              }
            }
          }
        }
      }
    }
  )

  /*
   * Initially, we are only going to support GET requests.
   * The default method is GET
   */
  if (origin.httpxoptions.method &&
    origin.httpxoptions.method !== 'GET') {
    throw new Error(`Unsupported HTTP method: ${origin.httpxoptions.method}. Only GET is supported. Origin: ${id}`)
  }
  
  // Ensuring the header array exists inside the origin
  if (!Object.prototype.hasOwnProperty.call(origin.httpxoptions, 'headers')) {
    origin.httpxoptions.headers = []
  } else {
    /*
     * We ensure that header names are in lowercase for the following
     * comparisons, which are case-sensitive.
     * Node HTTP sets all headers to lower case automatically.
     */
    let aux = null
    for (const header in origin.httpxoptions.headers) {
      aux = origin.httpxoptions.headers[header]
      delete origin.httpxoptions.headers[header]
      origin.httpxoptions.headers[header.toLowerCase()] = aux
    };
  }
  server.decorate('origin', origin)

  // Agents are responsible for managing connections.
  // For HTTP/2, you don’t need an agent per se, but you can maintain reusable
  // connections by configuring the HTTP/2 client instance.
  if (!origin.http2 && agentOpts) {
    const valid = validateAgentOptions(agentOpts);
    if (valid) {
      // The default protocol is 'http:'
      const agent = (origin.httpxoptions.protocol === 'https:' ? https : http).Agent(agentOpts)
      origin.httpxoptions.agent = agent
      server.decorate('agent', agent)
    } else {
      server.log.error(validateAgentOptions.errors)
      throw new Error(`The agent configuration is invalid. Origin: ${id}`)
    }
  }

  // Connecting to Redis
  const client = await createClient(redisOpts)
    .on('error', error => {
      throw new Error(`Error connecting to Redis. Origin: ${id}.`, { cause: error })
    })
    .connect()
  server.decorate('redis', client)

  if (mutations) {
    const valid = validateMutations(mutations)
    if (valid) {
      mutations.forEach(mutation => {
        try {
          mutation.re = new RegExp(mutation.urlPattern)
        } catch (error) {
          server.log.error(`urlPattern ${mutation.urlPattern} is not a valid regular expresion. Origin: ${id}`)
          throw new Error(`The mutation configuration is invalid. Origin: ${id}`)
        }
        mutation.actions.forEach(action => {
          if (!Object.prototype.hasOwnProperty.call(actionsLib, action.func)) {
            server.log.error(`Function ${action.func} was not found among the available actions. Origin: ${id}`)
            throw new Error(`The mutation configuration is invalid. Origin: ${id}`)
          }
        })
      })
    } else {
      server.log.error(validateMutations.errors)
      throw new Error(`The mutation configuration is invalid. Origin: ${id}`)
    }
  }

  server.decorate('mutations', mutations ? mutations : [])

  server.addHook('onClose', (server) => {
    if (server.agent) server.agent.destroy()
    if (server.redis) server.redis.quit()
  })

  server.route({
    method: 'GET',
    url: '/*',
    handler: async function (request, reply) {
      let prefix = request.routeOptions.url.replace("/*", "")
      let path = request.url.replace(prefix, "")
      let forceFetch = (Object.prototype.hasOwnProperty.call(request.headers, 'x-speedis-force-fetch'))
      let preview = (Object.prototype.hasOwnProperty.call(request.headers, 'x-speedis-preview'))
      try {
        let response = await _get(server, path, forceFetch, preview, request.id)
        reply.code(response.statusCode)
        reply.headers(response.headers)
        reply.send(response.body)
      } catch (error) {
        const msg =
          "Error requesting to the origin and there is no entry in the cache. " +
          `Origin: ${server.id}. Url: ${request.url}. RID: ${request.id}.`
        if (server.exposeErrors) { throw new Error(msg, { cause: error }) }
        else throw new Error(msg);
      }
    }
  })

  function generateCacheKey(server, path) {
    return server.id + path.replace('/', ':')
  }

  async function _get(server, path, forceFetch, preview, rid) {
    // We create options for an HTTP/S request to the required path
    // based on the default ones that must not be modified.
    const options = { ...server.origin.httpxoptions, path }

    // We try to look for the entry in the cache.
    // TODO: ¿Consultamos Redis incluso si nos fuerzan el fetch?
    // TODO: Pensar en recuperar sólo los campos que necesitamos: requestTime, responseTime, headers
    const cacheKey = generateCacheKey(server, path)
    let cachedResponse = null
    
    try {
      cachedResponse = await server.redis.json.get(cacheKey)
    } catch (error) {
      server.log.warn(error,
        "Error querying the cache entry in Redis. " +
        `Origin: ${server.id}. Key: ${cacheKey}. RID: ${rid}.`)
    }

    if (cachedResponse) {
      // Apply mutations to the entry fetched from the cache
      _mutate(CACHE_RESPONSE, cachedResponse, server)

      // We calculate whether the cache entry is fresh or stale.
      // See: https://tools.ietf.org/html/rfc7234#section-4.2
      const freshnessLifetime = utils.calculateFreshnessLifetime(cachedResponse)
      const currentAge = utils.calculateAge(cachedResponse)
      const responseIsFresh = (freshnessLifetime > currentAge)

      /*
      * TODO: Evaluate whether to handle cache directives that force a request
      * to the origin. It should be analyzed whether to treat differently the
      * headers coming from the client request, which can be used to overload
      * the origin by attacking it, from those generated by the origin itself.
      * The latter, if considered a problem, can always be modified by a
      * transformer.
      * https://tools.ietf.org/html/rfc7234#section-4.2.4
      * https://developer.mozilla.org/es/docs/Web/HTTP/Headers/Cache-Control
      * no-store, no-cache, must-revalidate, proxy-revalidate, immutable
      */

      /*
      * If the response is fresh, we serve it immediately from the cache.
      */
     
     /*
      * @ Deprecated
      * It can be fresh for a specific period or indefinitely if it contains
      * the x-speedis-freshness-lifetime-infinity header.
      */
      if (!forceFetch && (utils.isFreshnessLifeTime(cachedResponse) || responseIsFresh)) {
        cachedResponse.headers['age'] = utils.calculateAge(cachedResponse)
        utils.memHeader('HIT', forceFetch, preview, cachedResponse)
        return cachedResponse
      } else {
        // We need to revalidate the response through a conditional request.
        if ('etag' in cachedResponse.headers) {
          options.headers['if-none-match'] = cachedResponse.headers.etag
        }
        if ('last-modified' in cachedResponse.headers) {
          options.headers['if-modified-since'] = cachedResponse.headers['last-modified']
        }
      }
    }

    // If we reach this point, it is because we need to make a request to
    // the origin to retrieve or revalidate the response.
    let outputResponse = null

    // The current value of the clock at the host at the time the
    // request resulting in the stored response was made.
    const requestTime = Date.now() / 1000 | 0

    // Make the request to the origin
    let originResponse = null
    let responseTime = null

    // Apply mutations to the request before sending it to the origin
    _mutate(ORIGIN_REQUEST, options, server);
    try {
      originResponse = await _fetch(options)
      // The current value of the clock at the host at the time the
      // response was received.
      responseTime = Date.now() / 1000 | 0
    } catch (error) {
      delete options.agent
      server.log.error(error,
        "Error requesting to the origin. " +
        `Origin: ${server.id}. Options: ` + JSON.stringify(options) + `. RID: ${rid}.`
      )
      /*
      * If I was trying to refresh a cache entry, I may consider serving the
      * stale content.
      * TODO: Evaluate whether to handle cache directives related to this.
      * https://tools.ietf.org/html/rfc7234#section-4.2.4
      * https://developer.mozilla.org/es/docs/Web/HTTP/Headers/Cache-Control
      */
      if (cachedResponse != null) {
        server.log.warn(error,
          "Serving stale content from cache. " +
          `Origin: ${server.id}. Key: ${cacheKey}. RID: ${rid}.`)
        server.log.debug('Failed cache entry: ' + JSON.stringify(cachedResponse))
        cachedResponse.headers['warning'] =
          '111 ' + os.hostname() + ' "Revalidation Failed" "' + (new Date()).toUTCString() + '"'
        cachedResponse.headers['age'] = utils.calculateAge(cachedResponse)
        utils.memHeader('STALE', forceFetch, preview, cachedResponse)
        return cachedResponse
      } else {
        // There is no entry in the cache, and it could not be retrieved from the source. 
        throw error
      }
    }

    // Apply mutations to the response received from the origin
    _mutate(ORIGIN_RESPONSE, originResponse, server);

    // The HTTP 304 status code, “Not Modified,” tells the client that the
    // requested resource hasn't changed since the last access
    if (originResponse.statusCode === 304) {
      // We set the attributes involved in calculating the
      // age of the content.
      const multi = server.redis.multi()
      cachedResponse.requestTime = requestTime
      multi.json.set(cacheKey, '$.requestTime', requestTime)
      cachedResponse.responseTime = responseTime
      multi.json.set(cacheKey, '$.responseTime', responseTime)
      if ('date' in originResponse.headers) {
        cachedResponse.headers['date'] = originResponse.headers.date
        multi.json.set(cacheKey, '$.headers.date', cachedResponse.headers.date)
      }

      // Update the cache
      try {
        await multi.exec()
      } catch (error) {
        server.log.warn(error,
          "Error while storing in the cache. " +
          `Origin: ${server.id}. Key: ${cacheKey}. RID: ${rid}.`
        )
        server.log.debug('Failed cache entry: ' + JSON.stringify(cachedResponse))
      }

      // Las siguientes modificaciones no queremos que persistan en caché.
      // Por ello clonamos la respuesta.
      outputResponse = utils.cloneAndTrimResponse(path, cachedResponse)
      outputResponse.headers['age'] = utils.calculateAge(outputResponse)
      utils.memHeader('HIT', forceFetch, preview, outputResponse)
    } else {
      // We set the attributes involved in calculating the
      // age of the content.
      originResponse.requestTime = requestTime
      originResponse.responseTime = responseTime

      // If we are not in preview mode, it is cached.
      if (!preview) {
        // We parse the Cache-Control header to extract cache directives.
        const cacheDirectives = utils.parseCacheControlHeader(originResponse)

        // Private indicates that the response is intended for a single user and must
        // not be stored by a shared cache. A private cache may store the response.
        // No-store indicates that the cache should not store anything about the 
        // client request or server response.
        if (!Object.prototype.hasOwnProperty.call(cacheDirectives, 'private') &&
          !Object.prototype.hasOwnProperty.call(cacheDirectives, 'no-store')) {

          // We generate a cache entry from the response.
          const cacheEntry = utils.cloneAndTrimResponse(path, originResponse)

          // Apply mutations to the cache entry before storing it in the cache.
          _mutate(CACHE_REQUEST, cacheEntry, server)

          // Storing in the cache
          const multi = server.redis.multi()
          multi.json.set(cacheKey, '$', cacheEntry)
          const ttl = _ttl(cacheEntry.ttl)
          if (ttl) multi.expire(cacheKey, ttl)
          try {
            await multi.exec()
          } catch (error) {
            server.log.warn(error,
              "Error while storing in the cache. " +
              `Origin: ${server.id}. Key: ${cacheKey}. RID: ${rid}.`
            )
            server.log.debug('Failed cache entry: ' + JSON.stringify(cachedResponse))
          }
        }
      }

      // Se clona la respuesta del origen y se le aplican
      // transformaciones para su salida.
      outputResponse = utils.cloneAndTrimResponse(path, originResponse)
      outputResponse.headers['age'] = utils.calculateAge(outputResponse)
      utils.memHeader('MISS', forceFetch, preview, outputResponse)
    }   
    return outputResponse
  }

  function _mutate(type, target, server) {
    server.mutations.forEach(mutation => {
      if (mutation.re.test(target.path)) {
        mutation.actions.forEach(action => {
          if (action.phase === type) {
            actionsLib[action.func](target, action.params ? action.params : null)
          }
        })
      }
    })
  }

  function _fetch(options) {
    return new Promise((resolve, reject) => {
      if (server.origin.http2) {
        // TODO: Implement HTTP2 support
      } else {
        // The default protocol is 'http:'
        const request = (server.origin.httpxoptions.protocol === 'https:' ? https : http)
          .get(options, (res) => {
            let rawData = ''
            res.on('data', chunk => { rawData += chunk })
            res.on('end', () => {
              resolve({ statusCode: res.statusCode, headers: res.headers, body: rawData })
            })
          })
        request.on('error', reject)
      }
    })
  }

  /**
   * If the response does not have a TTL, it is assigned Infinity by default
   * which results in a TTL of 0 being returned.
   * This subsequently causes the cache entry not to expire.
   */
  function _ttl(ttl = 'Infinity') {
    if ('Infinity' === ttl || Infinity === ttl) return 0
    return parseInt(ttl)
  }

}
