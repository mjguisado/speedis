import fastify from 'fastify'
import path from 'path'
import fs from 'fs/promises'
import speedisPlugin from './plugins/speedis.js'
import { collectDefaultMetrics, Counter, Histogram, Summary } from 'prom-client'
import Ajv from "ajv"


export async function app(opts = {}, ajv = new Ajv({useDefaults: true})) {
  
  const validateOrigin = ajv.compile(
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "prefix", "redis", "origin"],
      properties: {
        id: { type: "string" },
        prefix: { type: "string" },
        logLevel: {
          enum: ["fatal", "error", "warn", "info", "debug", "trace"],
          default: "info"
        },
        exposeErrors: { type: "boolean", default: false },
        redis: {
          type: "object",
        },
        origin:{
          type: "object",
          additionalProperties: false,
          required: ["httpxOptions", "lock", "circuitBreaker"],
          if: { properties: { lock: { const: true } } },
          then: { required: ["lockOptions"] },
          if: { properties: { circuitBreaker: { const: true } } },
          then: { required: ["circuitBreakerOptions"] },
          properties: {
            // https://nodejs.org/api/http.html#httprequestoptions-callback
            httpxOptions: {
              type: "object",
              additionalProperties: false,
              properties: {
                auth: { type: "string" },
                // createConnection: { type: "function" },
                defaultPort: { type: "integer" },
                family: { enum: [4, 6] },
                headers: { type: "object" },
                hints: { type: "integer" },
                host: { type: "string", default: "localhost" },
                hostname: { type: "string" },
                insecureHTTPParser: { type: "boolean", default: false },
                joinDuplicateHeaders: { type: "boolean", default: false },
                localAddress: { type: "string" },
                localPort: { type: "integer" },
                // lookup: { type: "function" },
                maxHeaderSize: { type: "integer", default: 16384 },
                method: { type: "string", default: "GET" },
                path: { type: "string", default: "/" },
                port: { type: "integer", default: 80 },
                protocol: { type: "string", default: "http:" },
                setDefaultHeaders: { type: "boolean", default: true},
                setHost: { type: "boolean", default: true },
                // signal: { type: "function" },
                socketPath: { type: "string" },
                timeout: { type: "integer" },
                uniqueHeaders: { type: "array" }
              }
            },
            agentOptions: {
              type: "object",
              additionalProperties: false,
              properties: {
                // See: https://nodejs.org/api/http.html#new-agentoptions
                keepAlive: { type: "boolean", default: false },
                keepAliveMsecs: { type: "integer", default: 1000 },
                maxSockets: { type: "integer" },
                maxTotalSockets: { type: "integer" },
                maxFreeSockets: { type: "integer", default: 256 },
                scheduling: { type: "string", enum: ["fifo", "lifo"], default: "lifo" },
                timeout: { type: "integer" },
                // See: https://nodejs.org/api/https.html#new-agentoptions
                maxCachedSessions: { type: "integer", default: 100 },
                servername: { type: "string" },
              }
            },
            redisTimeout: { type: "integer", default: 200  },
            fetchTimeout: { type: "integer", default: 1000 },
            ignoredQueryParams: {
              type: "array",
              items: {
                type: "string"
              }
            },
            sortQueryParams: { type: "boolean", default: false },
            requestCoalescing: { type: "boolean", default: true },
            lock: { type: "boolean", default: false },
            lockOptions:
            {
              type: "object",
              required: ["lockTTL", "retryCount", "retryDelay", "retryJitter"],
              additionalProperties: false,
              properties: {
                lockTTL: { type: "integer" },
                retryCount: { type: "integer" },
                retryDelay: { type: "integer" },
                retryJitter: { type: "integer" }
              }
            },
            circuitBreaker: { type: "boolean", default: false },
            // See: https://github.com/nodeshift/opossum/blob/main/lib/circuit.js
            circuitBreakerOptions: {
              type: "object",
              additionalProperties: false,
              properties: {
                // status: { type: "Status" }, 
                // timeout: { type: "integer" },
                // Default value (10) is not specified because maxFailures it is deprecated
                maxFailures: { type: "integer" },
                resetTimeout: { type: "integer", default: 30000 },
                rollingCountTimeout: { type: "integer", default: 10000 },
                rollingCountBuckets: { type: "integer", default: 10 },
                // name: { type: "string" },
                rollingPercentilesEnabled: { type: "boolean", default: true },
                capacity: { type: "integer", default: Number.MAX_SAFE_INTEGER },
                errorThresholdPercentage: { type: "integer", default: 50 },
                enabled: { type: "boolean", default: true },
                allowWarmUp: { type: "boolean", default: false },
                volumeThreshold: { type: "integer", default: 0 },
                // errorFilter: { type: "Function" }, 
                /*
                cache: { type: "boolean" },
                cacheTTL: { type: "integer" },
                cacheSize: { type: "integer" },
                cacheGetKey: { type: "Function" }, 
                cacheTransport: { type: "CacheTransport" }, 
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
                autoRenewAbortController: { type: "boolean", default: false }
              }
            },
            actionsLibraries: {
              type: "object"
            },
            transformations: {
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
                            "ClientRequest",
                            "ClientResponse",
                            "OriginRequest",
                            "OriginResponse",
                            "CacheRequest",
                            "CacheResponse"
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
      }
    }
  )
  
  // Register the Prometheus metrics.
  const server = fastify(opts)

  collectDefaultMetrics()

  const httpRequestsTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests to Speedis',
    labelNames: ['origin','method',]
  })
  server.decorate('httpRequestsTotal', httpRequestsTotal)

  const circuitBreakersEvents = new Counter({
    name: 'circuit_brakers_events',
    help: `A count of all circuit' events`,
    labelNames: ['origin', 'event']
  })
  server.decorate('circuitBreakersEvents', circuitBreakersEvents)

  const circuitBreakersPerformance = new Summary({
    name: 'circuit_brakers_performance',
    help: `A summary of all circuit's events`,
    labelNames: ['origin', 'event']
  })
  server.decorate('circuitBreakersPerformance', circuitBreakersPerformance)

  const httpResponsesTotal = new Counter({
    name: 'http_responses_total',
    help: 'Total number of HTTP responses',
    labelNames: ['origin', 'statusCode', 'cacheStatus']
  })

  const httpResponsesDuration = new Histogram({
    name: 'http_responses_duration',
    help: 'Duration of HTTP responses',
    labelNames: ['origin', 'statusCode', 'cacheStatus']
  })

  const xSpeedisCacheStatusHeaderRE = /^(CACHE_.+) from/
  server.addHook('onResponse', async (request, reply) => {
    if (request.originalUrl !== '/metrics') {

      let origin = 'unknown'
      plugins.forEach((prefix, id) => {
        if (request.url.startsWith(prefix)) {
          origin = id
        }
      })

      let statusCode = 'unknown'
      if (typeof reply.statusCode === 'number' && !Number.isNaN(reply.statusCode)) {
        statusCode = reply.statusCode
      }

      let cacheStatus = 'unknown'
      if (reply.hasHeader('x-speedis-cache-status')) {
        const matches = reply.getHeader('x-speedis-cache-status')
          .match(xSpeedisCacheStatusHeaderRE)
        if (matches) cacheStatus = matches[1]
      }

      if ('unknown' === origin || 'unknown' === cacheStatus || 'unknown' === statusCode) {
        server.log.warn('The origin, cache status, or status code is not valid: ', origin, cacheStatus, statusCode)
      }

      httpResponsesTotal
        .labels({
          origin: origin,
          statusCode: statusCode,
          cacheStatus: cacheStatus
        }).inc()

      if (typeof reply.elapsedTime === 'number' && !Number.isNaN(reply.elapsedTime)) {
        httpResponsesDuration.labels({
          origin: origin,
          statusCode: statusCode,
          cacheStatus: cacheStatus
        }).observe(reply.elapsedTime)
      } else {
        server.log.warn('The duration value is not valid: ', reply.elapsedTime)
      }

    }

  })

  // Load the origin's configuration.
  const originsBasedir = path.join(process.cwd(), 'conf', 'origins')
  const originFiles = await fs.readdir(originsBasedir)
  let origins = []
  originFiles.forEach((originFile) => {
    const originFilePath = path.join(originsBasedir, originFile)
    origins.push(
      fs.readFile(originFilePath, 'utf8')
        .then(jsonString => { return JSON.parse(jsonString) })
        .catch(err => {
          server.log.error(err, 'Error loading the configuration file ' + originFilePath)
        }))
  })
  origins = await Promise.all(origins)

  // For each valid origin, we register an instance of the plugin that manages it.
  const plugins = new Map()
  origins.forEach((origin) => {
    if (undefined !== origin) {
      if (!validateOrigin(origin)) {
        server.log.error(validateOrigin.errors)
        server.log.error(`Origin configuration is invalid. Skiping origin: ${origin.id}`)
      } else {
        server.register(speedisPlugin, origin)
        plugins.set(origin.id, origin.prefix)
        server.after(err => { if (err) console.log(err) })
      }
    }
  })

  server.ready(err => { if (err) console.log(err) })

  return server

}