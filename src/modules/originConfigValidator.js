export function initOriginConfigValidator(ajv) {
    return ajv.compile(
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
                circuitBreakerOptions: {
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
                requestOptions: {
                    type: "object",
                    additionalProperties: false,
                    // https://nodejs.org/api/http.html#httprequestoptions-callback
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
                metrics: { type: "boolean", default: true },
                origin: {
                    type: "object",
                    additionalProperties: false,
                    oneOf: [
                        { required: ["http2Options"] },
                        { required: ["http1xOptions"] }
                    ],
                    allOf: [
                        {
                            if: {
                                required: ["http2Options"]
                            },
                            then: {
                                not: {
                                    anyOf: [
                                        { required: ["http1xOptions"] },
                                        { required: ["agentOptions"] }
                                    ]
                                }
                            }
                        },
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
                        http2Options: {
                            type: "object",
                            additionalProperties: false,
                            required: ["authority"],
                            properties: {
                                authority: { type: "string" },
                                options: { type: "object" },
                            }
                        },
                        http1xOptions: { $ref: "#/definitions/requestOptions" },
                        agentOptions: { $ref: "#/definitions/agentOptions" },
                        headersToForward: {
                            type: "array",
                            items: { type: "string" },
                            default: []
                        },
                        headersToExclude: {
                            type: "array",
                            items: { type: "string" },
                            default: []
                        },
                        originTimeout: { type: "integer" },
                        originBreaker: { type: "boolean", default: false },
                        originBreakerOptions: { $ref: "#/definitions/circuitBreakerOptions" }
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
                            minItems: 1,
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
                                        minItems: 1,
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
                                                        "CacheResponse",
                                                        "VariantsTracker"
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
                variantsTracker: {
                    type: "object",
                    additionalProperties: false,
                    required: ["urlPatterns"],
                    properties: {
                        urlPatterns: {
                            type: "array",
                            minItems: 1,
                            items: { type: "string" }
                        }
                    }
                },
                cache: {
                    type: "object",
                    additionalProperties: false,
                    required: ["cacheables"],
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
                        cacheables: {
                            type: "array",
                            minItems: 1,
                            items: {
                                type: "object",
                                minProperties: 1,
                                maxProperties: 3,
                                required: ["urlPattern"],
                                properties: {
                                    urlPattern: { type: "string" },
                                    perUser: { type: "boolean", default: false },
                                    ttl: { type: "integer", default: -1 }
                                }
                            }
                        },
                        includeOriginIdInUrlKey: { type: "boolean", default: true },
                        ignoredQueryParams: {
                            type: "array",
                            items: {
                                type: "string"
                            }
                        },
                        sortQueryParams: { type: "boolean", default: true },
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
                oauth2: {
                    type: "object",
                    additionalProperties: false,
                    required: [
                        "id",
                        "baseUrl",
                        "clientId",
                        "clientSecret",
                        "discoverySupported",
                        "postAuthRedirectUri",
                    ],
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
                        clientId: { type: "string" },
                        clientSecret: { type: "string" },
                        discoverySupported: { type: "boolean" },
                        authorizationServerMetadataLocation: { type: "string" },
                        authorizationServerMetadata: {
                            type: "object",
                            additionalProperties: true,
                            required: [
                                "issuer",
                                "authorization_endpoint",
                                "token_endpoint",
                                "jwks_uri"
                            ],
                            properties: {
                                issuer: { type: "string" },
                                authorization_endpoint: { type: "string" },
                                token_endpoint: { type: "string" },
                                jwks_uri: { type: "string" }
                            }
                        },
                        authorizationRequest: { type: "object", default: {} },
                        pkceEnabled: { type: "boolean", default: false },
                        authorizationCodeTtl: { type: "number", default: 300 },
                        sessionIdCookieName: { type: "string", default: "speedis_session" },
                        postAuthRedirectUri: { type: "string" },
                        logoutRequest: { type: "object", default: {} },
                    }
                },
                redis: {
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
                        redisBreakerOptions: { $ref: "#/definitions/circuitBreakerOptions" },
                        disableOriginOnRedisOutage: { type: "boolean", default: false },
                    }
                }
            }
        }
    )
}



