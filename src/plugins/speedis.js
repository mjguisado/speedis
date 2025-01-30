import http from 'http'
import https from 'https'
// import http2 from 'http2'
import { createClient } from 'redis'
import * as utils from '../utils/utils.js'
import * as actionsLib from '../actions/actions.js'
import CircuitBreaker from 'opossum'
import Ajv from "ajv"

// TODO: https://www.rfc-editor.org/rfc/rfc9111.html#name-must-understand
// TODO: https://www.rfc-editor.org/rfc/rfc9111.html#name-no-transform
// TODO: https://www.rfc-editor.org/rfc/rfc9111.html#name-no-transform-2
// TODO: https://www.rfc-editor.org/rfc/rfc9111.html#name-public
// TODO: https://www.rfc-editor.org/rfc/rfc9111#name-storing-incomplete-response
// TODO: https://www.rfc-editor.org/rfc/rfc9111.html#name-constructing-responses-from
// https://tohidhaghighi.medium.com/add-prometheus-metrics-in-nodejs-ce0ff5a43b44
// TODO: Implementar logs (publicación en Kibana). Fluentd or Central Logging (K8s)
// TODO: Completar validaciones AJV.
// TODO: Handling Redis reconnections
// TODO: Dockerizar y Kubernetizar
// TODO: Gestión de configuraciones remotas.
// TODO: Gestionar Status Code poco habituales
// Incluir métricas en los delete (label method)

export default async function (server, opts) {

  const { id, exposeErrors, origin, redis } = opts

  server.decorate('id', id)
  server.decorate('exposeErrors', exposeErrors)

  const ajv = new Ajv()

  const CLIENT_REQUEST = "ClientRequest"
  const CLIENT_RESPONSE = "ClientResponse"
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
          requestCoalescing: { type: "boolean" },
          circuitBreaker: { type: "boolean" },
          fetchTimeout: { type: "integer" },
          ignoredQueryParams: {
            type: "array",
            items: {
              type: "string"
            }
          },
          sortQueryParams: { type: "boolean" },
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
          // See: https://github.com/nodeshift/opossum/blob/main/lib/circuit.js
          circuitBreakerOptions: {
            type: "object",
            additionalProperties: true,
            properties: {
              // status: { type: "Status" }, 
              // timeout: { type: "integer" }, 
              maxFailures: { type: "integer" },
              resetTimeout: { type: "integer" },
              rollingCountTimeout: { type: "integer" },
              rollingCountBuckets: { type: "integer" },
              name: { type: "string" },
              rollingPercentilesEnabled: { type: "boolean" },
              capacity: { type: "integer" },
              errorThresholdPercentage: { type: "integer" },
              enabled: { type: "boolean" },
              allowWarmUp: { type: "boolean" },
              volumeThreshold: { type: "integer" },
              // errorFilter: { type: "Function" }, 
              cache: { type: "boolean" },
              cacheTTL: { type: "integer" },
              cacheSize: { type: "integer" },
              // cacheGetKey: { type: "Function" }, 
              // cacheTransport: { type: "CacheTransport" }, 
              /*
              coalesce: { type: "boolean" }, 
              coalesceTTL: { type: "integer" }, 
              coalesceSize: { type: "integer" }, 
              coalesceResetOn: { 
                type: "array",
                items: { enum: ["error", "success", "timeout"] }
              },
              */
              // abortController: { type: "AbortController" }, 
              enableSnapshots: { type: "boolean" },
              // rotateBucketController: { type: "EventEmitter" }, 
              autoRenewAbortController: { type: "boolean" },
            }
          },
          // See: https://nodejs.org/api/http.html#new-agentoptions
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
                      phase: {
                        enum: [
                          CLIENT_REQUEST,
                          CLIENT_RESPONSE,
                          ORIGIN_REQUEST,
                          ORIGIN_RESPONSE,
                          CACHE_REQUEST,
                          CACHE_RESPONSE
                        ]
                      },
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
        server.decorate('agent', agent)
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

      if (origin.circuitBreaker) {

        // FIXME: REfinar la validación del objeto circuitBreakerOptions para quitar las 
        // propiedades que no son necesarias.

        let cbOptions = []
        if (Object.prototype.hasOwnProperty.call(origin, "circuitBreakerOptions")) {
          cbOptions = origin.circuitBreakerOptions
        }

        // Name of the Circuit Breaker
        cbOptions['name'] = id
        // Speedis implements its own coalescing mechanism so we disable the one from the circuit breaker.
        cbOptions['coalesce'] = false
        // Speedis itself implements a cache mechanism so we disable the one from the circuit breaker.
        cbOptions['cache'] = false

        if (Object.prototype.hasOwnProperty.call(origin, "fetchTimeout")) {
          cbOptions['timeout'] = origin.fetchTimeout
        }

        // Circuit Breaker instance
        const circuit = new CircuitBreaker(_fetch, cbOptions)

        circuit.on('open', () => {
          let retryAfter = new Date()
          retryAfter.setSeconds(retryAfter.getSeconds() + circuit.options.resetTimeout / 1000)
          circuit['retryAfter'] = retryAfter.toUTCString()
          server.log.warn(`Circuit Breaker Open: No requests will be made. Origin ${id}.`)
        })
        circuit.on('halfOpen', () => {
          server.log.info(`Circuit Breaker Half Open: Requests are being tested. Origin ${id}.`)
        })
        circuit.on('close', () => {
          server.log.info(`Circuit closed: Request are being made normally. Origin ${id}.`)
        })

        for (const eventName of circuit.eventNames()) {
          circuit.on(eventName, _ => {
            server.circuitBreakersEvents.labels({
              origin: id,
              event: eventName
            }).inc()
          })
          if (eventName === 'success' || eventName === 'failure') {
            // Not the timeout event because runtime == timeout
            circuit.on(eventName, (result, runTime) => {
              server.circuitBreakersPerformance.labels({
                origin: id,
                event: eventName
              }).observe(runTime)
            })
          }
        }

        server.decorate('circuit', circuit)

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
  if (origin.requestCoalescing) server.decorate('ongoing', new Map())

  // Connecting to Redis
  // See: https://redis.io/docs/latest/develop/clients/nodejs/produsage/#handling-reconnections 
  const client = await createClient(redis)
    .on('error', error => {
      throw new Error(`Error connecting to Redis. Origin: ${id}.`, { cause: error })
    })
    .connect()
  server.decorate('redis', client)

  server.addHook('onClose', (server) => {
    if (server.agent) server.agent.destroy()
    if (server.ongoing) server.ongoing.clear()
    if (server.redis) server.redis.quit()
  })

  // See: https://developer.mozilla.org/en-US/docs/Web/HTTP/Resources_and_specifications
  server.route({
    method: 'GET',
    url: '/*',
    handler: async function (request, reply) {

      server.httpRequestsTotal
        .labels({ origin: id })
        .inc()

      let response = null
      try {
        response = await _get(server, request, request.id)
      } catch (error) {
        // FIXME: Reaffirm that we want to use the default error handling.
        const msg =
          "Error requesting to the origin. " +
          `Origin: ${server.id}. Url: ${request.url}. RID: ${request.id}.`
        if (server.exposeErrors) { throw new Error(msg, { cause: error }) }
        else throw new Error(msg)
      }

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

      const headers = {
        date: new Date().toUTCString()
      }
      headers['x-speedis-cache-status'] = response.headers['x-speedis-cache-status']
      if (!ifNoneMatchCondition) {
        reply.code(304)
        reply.headers(headers)
      } else {
        // See: https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.3
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
          reply.headers(headers)
        } else {
          reply.code(response.statusCode)
          response.headers['date'] = headers['date']
          reply.headers(response.headers)
          reply.send(response.body)
        }
      }
    }
  })

  server.route({
    method: 'DELETE',
    url: '/*',
    handler: async function (request, reply) {
      const fieldNames = utils.parseVaryHeader(request)
      let cacheKey = generateCacheKey(server, request, fieldNames)      
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
        else throw new Error(msg)
      }
    }
  })

  function generatePath(request) {
    const prefix = request.routeOptions.url.replace("/*", "")
    return request.url.replace(prefix, "")
  }

  function generateCacheKey(server, request, fieldNames = utils.parseVaryHeader(request)) {
    let path = generatePath(request)
    const [base, queryString] = path.split("?");
    if (queryString) {
      const params = new URLSearchParams(queryString);
      if (Object.prototype.hasOwnProperty.call(server.origin, 'ignoredQueryParams')) {
        server.origin.ignoredQueryParams.forEach(param => params.delete(param));
      }
      if (params.size > 0) {
        if (server.origin.sortQueryParams) {
          const sortedParams = [...params.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => `${key}=${value}`)
            .join("&");
          path = `${base}?${sortedParams.toString()}`
        } else {
          path = `${base}?${params.toString()}`
        }
      } else {
        path = base
      }
    }
    
    let cacheKey = server.id + path.replaceAll('/', ':')

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

  async function _get(server, request, rid) {

    const path = generatePath(request)
    // We create options for an HTTP/S request to the required path
    // based on the default ones that must not be modified.
    const options = JSON.parse(JSON.stringify(server.origin.httpxOptions))
    if (server.agent) options.agent = server.agent
    options.path = path

    const clientCacheDirectives = utils.parseCacheControlHeader(request)
    const fieldNames = utils.parseVaryHeader(request)
    let cacheKey = generateCacheKey(server, request, fieldNames)

    let cachedResponse = null
    try {
      cachedResponse = await server.redis.json.get(cacheKey)
    } catch (error) {
      server.log.warn(error,
        "Error querying the cache entry in Redis. " +
        `Origin: ${server.id}. Key: ${cacheKey}. RID: ${rid}.`)
    }

    let conditionalFetch = false
    let cachedCacheDirectives = null

    if (cachedResponse) {

      // Apply transformations to the entry fetched from the cache
      _transform(CACHE_RESPONSE, cachedResponse, server)

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
        && !Object.prototype.hasOwnProperty.call(clientCacheDirectives, 'no-cache')
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
          conditionalFetch = true
        }
        if (Object.prototype.hasOwnProperty.call(cachedResponse.headers, 'last-modified')) {
          options.headers['if-modified-since'] = cachedResponse.headers['last-modified']
          conditionalFetch = true
        }
      }

    }

    // Apply transformations to the request before sending it to the origin
    _transform(ORIGIN_REQUEST, options, server)

    // If requestCoalescing is enabled, only the first request 
    // will contact the origin to prevent overloading it.
    let amITheFetcher = false

    // Make the request to the origin
    let originResponse = null
    let requestTime = null
    let responseTime = null

    try {

      // Verify if there is an ongoing fetch operation
      let fetch = null
      if (origin.requestCoalescing) {
        fetch = server.ongoing.get(cacheKey)
      }
      if (!fetch) {
        if (server.circuit) {
          fetch = server.circuit.fire(server, options)
        } else {
          fetch = _fetch(server, options)
        }
        if (origin.requestCoalescing) server.ongoing.set(cacheKey, fetch)
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
      delete options.agent
      server.log.error(error,
        "Error requesting to the origin. " +
        `Origin: ${server.id}. Options: ` + JSON.stringify(options) + `. RID: ${rid}.`
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
          `Origin: ${server.id}. Key: ${cacheKey}. RID: ${rid}.`)
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
          cachedResponse?'CACHE_HIT_NOT_REVALIDATED':'CACHE_FAILED_MISS',
          generatedResponse
        )
        switch (error.code) {
          case 'ETIMEDOUT':
            generatedResponse.statusCode = 504
            break
          case 'EOPENBREAKER':
            generatedResponse.statusCode = 503
            if (server.circuit.options.resetTimeout) {
              generatedResponse.headers['retry-after'] = server.circuit.retryAfter
            }
            break
          default:
            generatedResponse.statusCode = 500
            break
        }
        return generatedResponse
      }
    } finally {
      if (origin.requestCoalescing) server.ongoing.delete(cacheKey)
    }

    // Apply transformations to the response received from the origin
    _transform(ORIGIN_RESPONSE, originResponse, server)

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
          _transform(CACHE_REQUEST, cachedResponse, server)

          // Update the cache
          await server.redis.json.merge(cacheKey, '$',
            {
              requestTime: cachedResponse.requestTime,
              responseTime: cachedResponse.responseTime,
              headers: cachedResponse.headers
            }
          )
        } catch (error) {
          server.log.warn(error,
            "Error while updating the cache. " +
            `Origin: ${server.id}. Key: ${cacheKey}. RID: ${rid}.`
          )
        }
      }

    } else {

      if (writeCache) {
        // Apply transformations to the cache entry before storing it in the cache.
        _transform(CACHE_REQUEST, cacheEntry, server)

        const multi = server.redis.multi()
        multi.json.set(cacheKey, '$', cacheEntry)
        const ttl = parseInt(cacheEntry.ttl)
        if (!Number.isNaN(ttl) && ttl > 0) multi.expire(cacheKey, ttl)
        try {
          await multi.exec()
        } catch (error) {
          server.log.warn(error,
            "Error while storing in the cache. " +
            `Origin: ${server.id}. Key: ${cacheKey}. RID: ${rid}.`
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
        await server.redis.unlink(cacheKey)
      } catch (error) {
        server.log.warn(error,
          "Error while removing private/no-store entry in the cache. " +
          `Origin: ${server.id}. Key: ${cacheKey}. RID: ${rid}.`
        )
      }
    }

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
        cachedResponse?'CACHE_HIT_REVALIDATED':'CACHE_MISS', originResponse
      )
      return utils.cloneAndTrimResponse(originResponse)
    }

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

        // If we are using the Circuit Breaker the timeout is managed by it.
        // In other cases, we has to manage the timeout in the request.
        let signal, timeoutId = null
        if (Object.prototype.hasOwnProperty.call(origin, "fetchTimeout") &&
          !Object.prototype.hasOwnProperty.call(options, "signal")) {
          const abortController = new AbortController()
          timeoutId = setTimeout(() => {
            abortController.abort()
          }, origin.fetchTimeout)
          signal = abortController.signal
          options.signal = signal
        }

        const request = (options.protocol === 'https:' ? https : http)
          .get(options, (res) => {
            let rawData = ''
            res.on('data', chunk => { rawData += chunk })
            res.on('end', () => {
              if (timeoutId) clearTimeout(timeoutId)
              resolve({ statusCode: res.statusCode, headers: res.headers, body: rawData })
            })
          })

        request.on('error', (err) => {
          if (signal && signal.aborted) {
            const error = new Error(`Timed out after ${origin.fetchTimeout} ms`, { cause: err })
            error.code = 'ETIMEDOUT'
            reject(error)
          } else {
            reject(err)
          }
        })

      }
    })
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