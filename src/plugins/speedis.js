import os from 'os'
import http from 'http'
import https from 'https'
// import http2 from 'http2'
import { createClient } from 'redis'
import * as utils from '../util/utils.js'
import * as actionsLib from '../actions/actions.js'
import Ajv from "ajv"

export default async function (server, opts) {

  const { id, exposeErrors, origin, redisOptions } = opts

  server.decorate('id', id)
  server.decorate('exposeErrors', exposeErrors)

  // TODO: Completar validaciones.
  const ajv = new Ajv()

  const ORIGIN_REQUEST = "OriginRequest"
  const ORIGIN_RESPONSE = "OriginResponse"
  const CACHE_REQUEST = "CacheRequest"
  const CACHE_RESPONSE = "CacheResponse"

  if (origin) {

    const validateOrigin = ajv.compile(
      {
        type: "object",
        additionalProperties: false,
        required: ["httpxOptions"],
        properties: {
          http2: { type: "boolean" },
          localRequestCoalescing: { type: "boolean" },
          remoteRequestCoalescing: { type: "boolean" },
          fetchTimeout: { type: "integer" },
          // https://nodejs.org/api/http.html#httprequestoptions-callback
          httpxOptions: {
            type: "object",
            properties: {
              auth: { type: "string" },
              defaultPort: { type: "integer" },
              family: { enum: [4, 6] },
              headers: { type: "object" },
              hints: { type: "integer" },
              host: { type: "string" },
              hostname: { type: "string" },
              insecureHTTPParser: { type: "boolean" },
              joinDuplicateHeaders: { type: "boolean" },
              localAddress: { type: "string" },
              localPort: { type: "integer" },
              maxHeaderSize: { type: "integer" },
              method: { type: "string" },
              path: { type: "string" },
              port: { type: "integer" },
              protocol: { type: "string" },
              setHost: { type: "boolean" },
              socketPath: { type: "string" },
              timeout: { type: "integer" },
              uniqueHeaders: { type: "array" }
            }
          },
          // https://nodejs.org/api/http.html#new-agentoptions
          agentOptions:
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
          },
          transformations:
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
                    required: ["phase", "uses"],
                    properties: {
                      phase: { enum: [ORIGIN_REQUEST, ORIGIN_RESPONSE, CACHE_REQUEST, CACHE_RESPONSE] },
                      uses: { type: "string" },
                      with: { type: "object" }
                    }
                  }
                }
              }
            }
          }
        }
      }
    )

    const validOrigin = validateOrigin(origin)

    if (validOrigin) {

      /*
     * Initially, we are only going to support GET requests.
     * The default method is GET
     */
      if (Object.prototype.hasOwnProperty.call(origin.httpxOptions, 'method') &&
        origin.httpxOptions.method !== 'GET') {
        throw new Error(`Unsupported HTTP method: ${origin.httpxOptions.method}. Only GET is supported. Origin: ${id}`)
      }

      // Ensuring the header array exists
      if (!Object.prototype.hasOwnProperty.call(origin.httpxOptions, 'headers')) {
        origin.httpxOptions.headers = {}
      } else {
        /*
         * We ensure that header names are in lowercase for the following
         * comparisons, which are case-sensitive.
         * Node HTTP library sets all headers to lower case automatically.
         */
        let aux = null
        for (const header in origin.httpxOptions.headers) {
          aux = origin.httpxOptions.headers[header]
          delete origin.httpxOptions.headers[header]
          origin.httpxOptions.headers[header.toLowerCase()] = aux
        }
      }

      // Agents are responsible for managing connections.
      // For HTTP/2, you don’t need an agent per se, but you can maintain reusable
      // connections by configuring the HTTP/2 client instance.
      if (!origin.http2 && Object.prototype.hasOwnProperty.call(origin, 'agentOptions')) {
        // The default protocol is 'http:'
        const agent = ('https:' === origin.httpxOptions.protocol ? https : http).Agent(origin.agentOptions)
        origin.httpxOptions.agent = agent
      }

      if (Object.prototype.hasOwnProperty.call(origin, 'transformations')) {
        origin.transformations.forEach(transformation => {
          try {
            transformation.re = new RegExp(transformation.urlPattern)
          } catch (error) {
            server.log.error(`urlPattern ${transformation.urlPattern} is not a valid regular expresion. Origin: ${id}`)
            throw new Error(`The transformation configuration is invalid. Origin: ${id}`)
          }
          transformation.actions.forEach(action => {
            if (!Object.prototype.hasOwnProperty.call(actionsLib, action.uses)) {
              server.log.error(`Function ${action.uses} was not found among the available actions. Origin: ${id}`)
              throw new Error(`The transformation configuration is invalid. Origin: ${id}`)
            }
          })
        })
      }

    } else {
      server.log.error(validateOrigin.errors)
      throw new Error(`Origin configuration is invalid. Origin: ${id}`)
    }
  } else {
    throw new Error(`Origin configuration not found. Origin: ${id}`)
  }
  server.decorate('origin', origin)

  // This Map storages the ongoing Fecth Operations
  if (origin.localRequestCoalescing) server.decorate('ongoing', new Map())

  // Connecting to Redis
  // TODO: Handling reconnections
  // See: https://redis.io/docs/latest/develop/clients/nodejs/produsage/#handling-reconnections 
  const client = await createClient(redisOptions)
    .on('error', error => {
      throw new Error(`Error connecting to Redis. Origin: ${id}.`, { cause: error })
    })
    .connect()
  server.decorate('redis', client)

  server.addHook('onClose', (server) => {
    if (server.origin.httpxOptions.agent) server.origin.httpxOptions.agent.destroy()
    if (origin.localRequestCoalescing) server.ongoing.clear()
    if (server.redis) server.redis.quit()
  })

  // See: https://developer.mozilla.org/en-US/docs/Web/HTTP/Resources_and_specifications
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

        // Check if we have received a conditional request.
        var etags = [];
        var lastModified = null;
        for (var header in request.headers) {
          switch (header) {
            case 'if-none-match':
              etags = request.headers[header]
                .replace(/ /g, '')
                .split(',')
              break;
            case 'if-modified-since':
              lastModified = request.headers[header];
              break;
          }
        }

        // See: https://datatracker.ietf.org/doc/html/rfc9110#section-13.1.2
        let ifNoneMatchCondition = true;
        if (etags.length > 0) {
          if (etags.length === 1 && etags[0] === '"*"') {
            if (response && 200 === response.statusCode) {
              ifNoneMatchCondition = false
            }
          } else {
            if (Object.prototype.hasOwnProperty.call(response.headers, 'etag')) {
              for (let index = 0; index < etags.length; index++) {
                // A recipient MUST use the weak comparison function when 
                // comparing entity tags for If-None-Match
                // https://datatracker.ietf.org/doc/html/rfc9110#section-8.8.3.2
                let weakRequestETag = etags[index].startsWith('W/')
                  ? etags[index].substring(2) : etags[index];
                let weakCacheEtag = response.headers["etag"].startsWith('W/')
                  ? response.headers["etag"].substring(2) : response.headers["etag"];
                if (weakRequestETag === weakCacheEtag) {
                  ifNoneMatchCondition = false
                  break
                }
              }
            }
          }
        }

        if (!ifNoneMatchCondition) {
          reply.code(304)
        } else {
          // See: https://datatracker.ietf.org/doc/html/rfc9110#section-13.1.3
          let ifModifiedSinceCondition = true
          if (!Object.prototype.hasOwnProperty.call(request.headers, 'if-none-match')) {
            let requestlmd = lastModified
              ? Date.parse(lastModified) : NaN
            let cachelmd = Object.prototype.hasOwnProperty.call(response.headers, 'last-modified')
              ? Date.parse(response.headers['last-modified']) : NaN
            if (!Number.isNaN(requestlmd) && !Number.isNaN(cachelmd) && cachelmd <= requestlmd) {
              ifModifiedSinceCondition = false
            }
          }
          if (!ifModifiedSinceCondition) {
            reply.code(304)
          } else {
            reply.code(response.statusCode)
            response.headers['date'] = new Date().toUTCString()
            reply.headers(response.headers)
            reply.send(response.body)
          }
        }

      } catch (error) {
        const msg =
          "Error requesting to the origin and there is no entry in the cache. " +
          `Origin: ${server.id}. Url: ${request.url}. RID: ${request.id}.`
        if (server.exposeErrors) { throw new Error(msg, { cause: error }) }
        else throw new Error(msg);
      }
    }
  })

  server.route({
    method: 'DELETE',
    url: '/*',
    handler: async function (request, reply) {
      let prefix = request.routeOptions.url.replace("/*", "")
      let path = request.url.replace(prefix, "")

      // We try to look for the entry in the cache.
      const cacheKey = generateCacheKey(server, path)
      try {
        // See: https://antirez.com/news/93
        let result = await server.redis.unlink(cacheKey)
        if (result) {
          reply.code(204)
        } else {
          reply.code(404)
        }
      } catch (error) {
        const msg =
          "Error deleting the cache entry in Redis. " +
          `Origin: ${server.id}. Key: ${cacheKey}. RID: ${rid}.`
        if (server.exposeErrors) { throw new Error(msg, { cause: error }) }
        else throw new Error(msg);
      }
    }
  })

  function generateCacheKey(server, path) {
    return server.id + path.replaceAll('/', ':')
  }

  async function _get(server, path, forceFetch, preview, rid) {

    // We create options for an HTTP/S request to the required path
    // based on the default ones that must not be modified.
    const options = { ...server.origin.httpxOptions, path }

    // TODO: Pensar en recuperar sólo los campos que necesitamos: requestTime, responseTime, headers

    // We try to look for the entry in the cache.
    let cacheKey = null;
    let cachedResponse = null

    // Preview mode forces fetching from the origin without interacting with Redis.
    // Warning: We should limit the use of preview mode as it could overload the 
    // origin by bypassing the cache layer.
    if (!preview) {
      cacheKey = generateCacheKey(server, path)
      try {
        cachedResponse = await server.redis.json.get(cacheKey)
      } catch (error) {
        server.log.warn(error,
          "Error querying the cache entry in Redis. " +
          `Origin: ${server.id}. Key: ${cacheKey}. RID: ${rid}.`)
      }
    }

    let conditionalFetch = false

    if (cachedResponse) {

      // Apply transformations to the entry fetched from the cache
      _transform(CACHE_RESPONSE, cachedResponse, server)

      // We calculate whether the cache entry is fresh or stale.

      // See: https://tools.ietf.org/html/rfc7234#section-4.2.1
      const freshnessLifetime = utils.calculateFreshnessLifetime(cachedResponse)
      // See: https://tools.ietf.org/html/rfc7234#section-4.2.3
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
        // https://www.npmjs.com/package/etag
        if ('etag' in cachedResponse.headers) {
          options.headers['if-none-match'] = cachedResponse.headers.etag
          conditionalFetch = true
        }
        if ('last-modified' in cachedResponse.headers) {
          options.headers['if-modified-since'] = cachedResponse.headers['last-modified']
          conditionalFetch = true
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

    // Apply transformations to the request before sending it to the origin
    _transform(ORIGIN_REQUEST, options, server);

    // If localRequestCoalescing is enabled, only the first request 
    // will contact the origin to prevent overloading it.
    let amITheFetcher = false;

    try {
      // Verify if there is an ongoing fetch operation
      let fetch = null;
      if (origin.localRequestCoalescing) {
        fetch = server.ongoing.get(cacheKey);
      }
      if (!fetch) {
        fetch = _fetch(server, options)
        if (origin.localRequestCoalescing) server.ongoing.set(cacheKey, fetch)
        amITheFetcher = true;
      }
      originResponse = await fetch;

      // The current value of the clock at the host at the time the
      // response was received.
      responseTime = Date.now()

      // Unsure that we have a valid Date Header
      utils.ensureValidDateHeader(originResponse, responseTime)

      // We reduce precision once it’s no longer needed to ensure the Date header.
      responseTime = responseTime / 1000 | 0

    } catch (error) {

      delete options.agent
      server.log.error(error,
        "Error requesting to the origin. " +
        `Origin: ${server.id}. Options: ` + JSON.stringify(options) + `. RID: ${rid}.`
      )

      /*
      * If I was trying to refresh a cache entry,
      * I may consider serving the stale content.
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
        utils.memHeader('REFRESH_FAIL_HIT', forceFetch, preview, cachedResponse)
        return cachedResponse
      } else {
        // It could not be retrieved from the source and
        // there is no entry in the cache or preview mode is enabled
        throw error
      }

    } finally {
      if (origin.localRequestCoalescing) server.ongoing.delete(cacheKey)
    }

    // Apply transformations to the response received from the origin
    _transform(ORIGIN_RESPONSE, originResponse, server);

    // The HTTP 304 status code, “Not Modified,” tells the client that the
    // requested resource hasn't changed since the last access
    if (originResponse.statusCode === 304) {

      // We set the attributes involved in calculating the
      // age of the content.
      cachedResponse.requestTime = requestTime
      cachedResponse.responseTime = responseTime
      if (Object.prototype.hasOwnProperty.call(originResponse.headers, 'date')) {
        cachedResponse.headers['date'] = originResponse.headers.date
      }
      if (amITheFetcher) {
        try {
          // Update the cache
          await server.redis.json.merge(cacheKey, '$',
            {
              requestTime: cachedResponse.requestTime,
              responseTime: cachedResponse.responseTime,
              headers: { date: cachedResponse.headers.date }
            }
          )
        } catch (error) {
          server.log.warn(error,
            "Error while storing in the cache. " +
            `Origin: ${server.id}. Key: ${cacheKey}. RID: ${rid}.`
          )
          server.log.debug('Failed cache entry: ' + JSON.stringify(cachedResponse))
        }
      }

      // Las siguientes modificaciones no queremos que persistan en caché.
      // Por ello clonamos la respuesta.
      outputResponse = utils.cloneAndTrimResponse(path, cachedResponse)
      utils.memHeader('REFRESH_HIT', forceFetch, preview, outputResponse)

    } else {

      // We set the attributes involved in calculating the
      // age of the content.
      originResponse.requestTime = requestTime
      originResponse.responseTime = responseTime

      // If we are not in preview mode then we should store in Redis the response.
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

          // Apply transformations to the cache entry before storing it in the cache.
          _transform(CACHE_REQUEST, cacheEntry, server)

          // Storing in the cache
          if (amITheFetcher) {
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
      }

      // Se clona la respuesta del origen y se le aplican
      // transformaciones para su salida.
      outputResponse = utils.cloneAndTrimResponse(path, originResponse)
      utils.memHeader(conditionalFetch?'REFRESH_MISS':'MISS', forceFetch, preview, outputResponse)
    }
    return outputResponse
  }

  function _transform(type, target, server) {
    if (Object.prototype.hasOwnProperty.call(server.origin, 'transformations')) {
      server.origin.transformations.forEach(transformation => {
        if (transformation.re.test(target.path)) {
          transformation.actions.forEach(action => {
            if (action.phase === type) {
              actionsLib[action.uses](target, action.with ? action.with : null)
            }
          })
        }
      })
    }
  }

  function _fetch(server, options) {
    return new Promise((resolve, reject) => {
      if (server.origin.http2) {
        // TODO: Implement HTTP2 support
      } else {
        // The default protocol is 'http:'
        const request = (options.protocol === 'https:' ? https : http)
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
