import fastify from 'fastify'
import path from 'path'
import fs from 'fs/promises'
import speedisPlugin from './plugins/speedis.js'
import { collectDefaultMetrics, Counter, Histogram } from 'prom-client'
import PrometheusMetrics from 'opossum-prometheus'
import Ajv from "ajv"

export async function app(opts = {}, ajv = new Ajv({ useDefaults: true })) {

  const validateOrigin = ajv.compile(
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "prefix", "origin"],
      if: { 
        anyOf: [
          { required: ["cache"] },
          { required: ["oauth2"] }
        ]
      },
      then: { required: ["redis"] },
      definitions: {
        circuitBreakerConfiguration: {
          type: "object",
          additionalProperties: false,
          // See: https://github.com/nodeshift/opossum/blob/main/lib/circuit.js
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
        redisConfiguration: {
          type: "object",
          additionalProperties: false,
          required: ["redisOptions"],
          allOf: [
            {
              if: {
                properties: {
                  redisBreaker: { const: true }
                },
                required: ["redisBreaker"]
              },
              then: {
                required: ["redisBreakerOptions"]
              }
            }
          ],
          properties: {
            redisOptions: {
              type: "object",
            },
            redisTimeout: { type: "integer" },
            redisBreaker: { type: "boolean", default: false },
            redisBreakerOptions: { $ref: "#/definitions/circuitBreakerConfiguration" },
            disableOriginOnRedisOutage: { type: "boolean", default: false },
          }
        }
      },
      properties: {
        id: { type: "string" },
        prefix: { type: "string" },
        logLevel: {
          enum: ["fatal", "error", "warn", "info", "debug", "trace"],
          default: "info"
        },
        exposeErrors: { type: "boolean", default: false },
        redis: { $ref: "#/definitions/redisConfiguration" },
        origin: {
          type: "object",
          additionalProperties: false,
          required: ["httpxOptions"],
          allOf: [
            {
              if: {
                properties: {
                  originBreaker: { const: true }
                },
                required: ["originBreaker"]
              },
              then: {
                required: ["originBreakerOptions"]
              }
            }
          ],
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
                headers: { type: "object", default: {} },
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
                setDefaultHeaders: { type: "boolean", default: true },
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
            originTimeout: { type: "integer" },
            originBreaker: { type: "boolean", default: false },
            originBreakerOptions: { $ref: "#/definitions/circuitBreakerConfiguration" }
          }
        },
        cache: {
          type: "object",
          additionalProperties: false,
          allOf: [
            {
              if: {
                properties: {
                  distributedRequestsCoalescing: { const: true }
                },
                required: ["distributedRequestsCoalescing"]
              },
              then: {
                required: ["distributedRequestsCoalescingOptions"]
              }
            }
          ],
          properties: {
            purgePath: { type: "string", default: "/purge" },
            cacheableUrlPatterns: {
              type: "array",
              items: {
                type: "string"
              },
              default: []
            },
            includeOriginIdInCacheKey: { type: "boolean", default: true },
            ignoredQueryParams: {
              type: "array",
              items: {
                type: "string"
              }
            },
            sortQueryParams: { type: "boolean", default: false },
            localRequestsCoalescing: { type: "boolean", default: true },
            distributedRequestsCoalescing: { type: "boolean", default: false },
            distributedRequestsCoalescingOptions:
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
            }
          }
        },
        bff: {
          type: "object",
          additionalProperties: false,
          required: ["transformations"],
          properties: {
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
            },
          }
        },
        oauth2: {
          type: "object",
          additionalProperties: false,
          required: [
            "id",
            "baseUrl",
            "clientId",
            "clientSecret",
            "discoverySupported",
            "postAuthRedirectUrl",
            "redis"],
          allOf: [
            {
              if: {
                properties: {
                  discoverySupported: { const: true }
                },
                required: ["discoverySupported"]
              },
              then: {
                required: ["authorizationServerMetadataLocation"]
              }
            },
            {
              if: {
                properties: {
                  discoverySupported: { const: false }
                },
                required: ["discoverySupported"]
              },
              then: {
                required: ["authorizationServerMetadata"]
              }
            }
          ],
          properties: {
            id: { type: "string" },
            prefix: { type: "string", default: "/oauth2" },
            logLevel: {
              enum: ["fatal", "error", "warn", "info", "debug", "trace"],
              default: "info"
            },
            baseUrl: { type: "string" },
            redirectPath: { type: "string", default: "/login" },
            callbackPath: { type: "string", default: "/callback" },
            logoutPath: { type: "string", default: "/logout" },
            clientId: { type: "string" },
            clientSecret: { type: "string" },
            discoverySupported: { type: "boolean" },
            authorizationServerMetadataLocation: { type: "string" },
            authorizationServerMetadata: {
              type: "object",
              additionalProperties: true,
              required: ["issuer", "authorization_endpoint", "token_endpoint"],
              properties: {
                issuer: { type: "string" },
                authorization_endpoint: { type: "string" },
                token_endpoint: { type: "string" },
                response_types_supported: {
                  type: "array",
                  items: {
                    type: "string"
                  }
                }
              }
            },
            authorizationRequest: { type: "object", default: {} },
            pkceEnabled: { type: "boolean", default: false },
            authorizationCodeTtl: { type: "number", default: 300 },
            sessionIdCookieName: { type: "string", default: "speedis_token_id" },
            postAuthRedirectUrl: { type: "string" },
          }
        }
      }
    }
  )

  /*
  accessControl: { 
    type: "array",
    items: {
      type: "object",
      minProperties: 2,
      maxProperties: 2,
      additionalProperties: false,
      required: ["urlPattern", "requiredScopes"],
      properties: {
        urlPattern: { type: "string" },
        requiredScopes: {
          type: "array",
          items: {
            type: "string",
          }
        } 
      }
    }
  }
  */


  // Register the Prometheus metrics.
  const server = fastify(opts)

  collectDefaultMetrics()

  const breakersMetrics = new PrometheusMetrics({})
  server.decorate('breakersMetrics', breakersMetrics)

  const httpRequestsTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests to Speedis',
    labelNames: ['origin', 'method',]
  })
  server.decorate('httpRequestsTotal', httpRequestsTotal)

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