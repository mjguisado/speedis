/**
 * Initializes and compiles the origin configuration validator using AJV (Another JSON Schema Validator).
 *
 * This validator enforces complex conditional requirements between different modules:
 * - Redis dependency management based on enabled modules
 * - Authentication requirements for private caching
 * - Module-specific required fields only when modules are enabled
 *
 * @param {Object} ajv - An instance of AJV validator
 * @returns {Function} Compiled validation function
 */
export function initOriginConfigValidator(ajv) {
    return ajv.compile(
        {
            type: "object",
            additionalProperties: false,
            required: ["id", "prefix", "origin"],

            // Root-level conditional validations
            // These rules apply to the entire configuration object and enforce cross-module dependencies
            allOf: [
                {
                    /**
                     * CONDITIONAL RULE #1: Redis dependency validation
                     *
                     * Logic: Redis is REQUIRED if ANY of these modules are enabled:
                     * - cache
                     * - variantsTracker
                     *
                     * Implementation: Using double negation for clarity
                     * IF NOT (all modules are absent or disabled)
                     * THEN redis is required
                     *
                     * This translates to: "If at least one module needs Redis, then Redis must be configured"
                     */
                    if: {
                        not: {
                            allOf: [
                                {
                                    // variantsTracker is absent OR explicitly disabled (enabled: false)
                                    anyOf: [
                                        {
                                            // Module is not present in configuration
                                            not: {
                                                required: ["variantsTracker"]
                                            }
                                        },
                                        {
                                            // Module is present but explicitly disabled
                                            type: "object",
                                            properties: {
                                                variantsTracker: {
                                                    type: "object",
                                                    properties: { enabled: { const: false } },
                                                    required: ["enabled"]
                                                }
                                            }
                                        }
                                    ]
                                },
                                {
                                    // cache is absent OR explicitly disabled (enabled: false)
                                    anyOf: [
                                        {
                                            // Module is not present in configuration
                                            not: {
                                                required: ["cache"]
                                            }
                                        },
                                        {
                                            // Module is present but explicitly disabled
                                            type: "object",
                                            properties: {
                                                cache: {
                                                    type: "object",
                                                    properties: { enabled: { const: false } },
                                                    required: ["enabled"]
                                                }
                                            }
                                        }
                                    ]
                                }
                            ]
                        }
                    },
                    then: { required: ["redis"] }
                },
                {
                    /**
                     * CONDITIONAL RULE #2: Authentication requirement for private caching
                     *
                     * Logic: origin.authentication is REQUIRED (and must be enabled) when:
                     *   1. cache module is enabled (enabled !== false), AND
                     *   2. private caching is configured anywhere, that is, EITHER:
                     *      a. cache.defaultCacheSettings.private === true, OR
                     *      b. at least one cacheable has cacheSettings.private === true
                     *
                     * Rationale: Private caching requires user identification to build per-user
                     * cache keys. The authentication block defines how to extract that identifier.
                     *
                     * Note: this is intentionally a "safe side" check. If defaultCacheSettings
                     * declares private:true and every cacheable explicitly overrides it to
                     * private:false, the rule still requires authentication. To avoid that,
                     * leave defaultCacheSettings.private at its default (false) and opt in per
                     * cacheable instead.
                     */
                    if: {
                        properties: {
                            cache: {
                                type: "object",
                                allOf: [
                                    {
                                        // Condition 1: cache.enabled !== false
                                        // Note: This allows both enabled: true and missing enabled property (defaults to true)
                                        not: {
                                            properties: { enabled: { const: false } },
                                            required: ["enabled"]
                                        }
                                    },
                                    {
                                        // Condition 2: private caching is configured somewhere
                                        anyOf: [
                                            {
                                                // 2a. defaultCacheSettings.private === true
                                                properties: {
                                                    defaultCacheSettings: {
                                                        type: "object",
                                                        properties: { private: { const: true } },
                                                        required: ["private"]
                                                    }
                                                },
                                                required: ["defaultCacheSettings"]
                                            },
                                            {
                                                // 2b. at least one cacheable has cacheSettings.private === true
                                                properties: {
                                                    cacheables: {
                                                        type: "array",
                                                        contains: {
                                                            type: "object",
                                                            properties: {
                                                                cacheSettings: {
                                                                    type: "object",
                                                                    properties: { private: { const: true } },
                                                                    required: ["private"]
                                                                }
                                                            },
                                                            required: ["cacheSettings"]
                                                        }
                                                    }
                                                },
                                                required: ["cacheables"]
                                            }
                                        ]
                                    }
                                ]
                            }
                        },
                        required: ["cache"]
                    },
                    then: {
                        // When conditions are met, require origin.authentication and ensure it's enabled
                        properties: {
                            origin: {
                                type: "object",
                                required: ["authentication"],
                                properties: {
                                    authentication: {
                                        type: "object",
                                        // Ensure authentication.enabled !== false
                                        not: {
                                            properties: { enabled: { const: false } },
                                            required: ["enabled"]
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            ],
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
                /**
                 * Cache settings definition
                 *
                 * Defines the structure for cache behavior configuration.
                 * Used both for cache.defaults and individual cacheable entries.
                 */
                cacheSettings: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                        methods: {
                            type: "array",
                            items: { enum: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE"] }
                        },
                        /**
                         * Whether to cache responses separately per authenticated user
                         * If true, origin.authentication must be configured
                         */
                        private: { type: "boolean" },

                        /**
                         * Time-to-live in seconds for cache entries
                         * -1 means use HTTP cache headers to determine TTL
                         */
                        ttl: { type: "integer" },

                        /**
                         * Whether to sort query string parameters alphabetically
                         * when generating the cache key
                         */
                        sortQueryParams: { type: "boolean" },

                        /**
                         * List of query string parameters to ignore when
                         * generating the cache key
                         */
                        ignoredQueryParams: {
                            type: "array",
                            items: {
                                type: "string"
                            }
                        }
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
                /**
                 * ORIGIN CONFIGURATION
                 *
                 * Defines how Speedis connects to and communicates with the upstream origin server.
                 * Supports both HTTP/2 and HTTP/1.x protocols (mutually exclusive).
                 */
                origin: {
                    type: "object",
                    additionalProperties: false,

                    // Must configure either HTTP/2 or HTTP/1.x (but not both)
                    oneOf: [
                        { required: ["http2Options"] },
                        { required: ["http1xOptions"] }
                    ],
                    allOf: [
                        {
                            /**
                             * CONDITIONAL: HTTP/2 exclusivity
                             *
                             * If HTTP/2 is configured, then HTTP/1.x options and agent options
                             * must NOT be present (they are incompatible).
                             */
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
                            /**
                             * CONDITIONAL: Circuit breaker options requirement
                             *
                             * If originBreaker is explicitly enabled (true), then
                             * originBreakerOptions must be provided.
                             */
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
                            default: ["*"]
                        },
                        headersToExclude: {
                            type: "array",
                            items: { type: "string" },
                            default: []
                        },
                        originTimeout: { type: "integer" },
                        originBreaker: { type: "boolean", default: false },
                        originBreakerOptions: { $ref: "#/definitions/circuitBreakerOptions" },

                        /**
                         * AUTHENTICATION CONFIGURATION
                         *
                         * Defines how to extract user identifiers from requests for private caching.
                         * This is PASSIVE authentication - it extracts user info but doesn't manage login flows.
                         *
                         * Required when: cache module has private cacheables (see root-level conditional rule #2)
                         */
                        authentication: {
                            type: "object",
                            additionalProperties: false,

                            allOf: [
                                {
                                    /**
                                     * CONDITIONAL: Bearer token configuration requirement
                                     *
                                     * If scheme is "Bearer", then bearer configuration object is required
                                     * to specify JWT validation settings.
                                     */
                                    if: {
                                        properties: { scheme: { const: "Bearer" } },
                                        required: ["scheme"]
                                    },
                                    then: {
                                        required: ["bearer"]
                                    }
                                }
                            ],

                            properties: {
                                enabled: { type: "boolean", default: true },
                                scheme: { type: "string", enum: ["Basic", "Bearer"], default: "Basic" },
                                realm: { type: "string" },
                                /**
                                 * Bearer token validation settings
                                 * Used when scheme is "Bearer"
                                 */
                                bearer: {
                                    type: "object",
                                    additionalProperties: false,
                                    allOf: [
                                        {
                                            /**
                                             * CONDITIONAL: JWKS URI requirement
                                             *
                                             * If JWT signature verification is enabled (default behavior),
                                             * then jwksUri must be provided to fetch public keys for validation.
                                             *
                                             * Logic: IF NOT (verifyJwtSignature === false) THEN jwksUri is required
                                             */
                                            if: {
                                                not: {
                                                    properties: { verifyJwtSignature: { const: false } },
                                                    required: ["verifyJwtSignature"]
                                                }
                                            },
                                            then: {
                                                required: ["jwksUri"]
                                            }
                                        }
                                    ],
                                    properties: {
                                        claim: { type: "string", default: "sub" },
                                        decryptionKey: { type: "string" },
                                        allowUnsigned: { type: "boolean", default: false },
                                        verifyJwtSignature: { type: "boolean", default: true },
                                        jwksUri: { type: "string" }
                                    }
                                },

                                /**
                                 * User ID transformation settings
                                 *
                                 * Defines how to transform the extracted user identifier before using it
                                 * in cache keys (e.g., adding prefix/suffix, hashing for privacy).
                                 */
                                idTransformation: {
                                    type: "object",
                                    additionalProperties: false,
                                    properties: {
                                        prefix: { type: "string", default: "" },
                                        suffix: { type: "string", default: "" },
                                        hash: {
                                            type: "object",
                                            additionalProperties: false,
                                            properties: {
                                                enabled: { type: "boolean", default: true },
                                                algorithm: { type: "string", default: "md5" },
                                                hex: { type: "boolean", default: true }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
                /**
                 * BFF (Backend For Frontend) MODULE
                 *
                 * Enables request/response transformations at various phases of the request lifecycle.
                 * Can modify headers, body, or other aspects of requests and responses.
                 */
                bff: {
                    type: "object",
                    additionalProperties: false,

                    /**
                     * CONDITIONAL: transformations requirement
                     *
                     * If bff module is enabled (enabled !== false), then transformations array is required.
                     * This prevents enabling the module without defining what transformations to apply.
                     *
                     * Logic: IF NOT (enabled === false) THEN transformations is required
                     */
                    if: {
                        not: {
                            properties: { enabled: { const: false } },
                            required: ["enabled"]
                        }
                    },
                    then: {
                        required: ["transformations"]
                    },

                    properties: {
                        enabled: { type: "boolean", default: true },
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
                                                        "VariantsTracker",
                                                        "CacheKeyGeneration"
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

                /**
                 * VARIANTS TRACKER MODULE
                 *
                 * Tracks different response variants for the same URL to help identify
                 * cache key variations and optimize caching strategies.
                 */
                variantsTracker: {
                    type: "object",
                    additionalProperties: false,

                    /**
                     * CONDITIONAL: urlPatterns requirement
                     *
                     * If variantsTracker module is enabled (enabled !== false), then urlPatterns
                     * array is required to specify which URLs should be tracked.
                     *
                     * Logic: IF NOT (enabled === false) THEN urlPatterns is required
                     */
                    if: {
                        not: {
                            properties: { enabled: { const: false } },
                            required: ["enabled"]
                        }
                    },
                    then: {
                        required: ["urlPatterns"]
                    },

                    properties: {
                        enabled: { type: "boolean", default: true },
                        urlPatterns: {
                            type: "array",
                            minItems: 1,
                            items: { type: "string" }
                        }
                    }
                },
                /**
                 * CACHE MODULE
                 *
                 * Configures HTTP caching behavior including what to cache, cache key generation,
                 * and request coalescing strategies.
                 *
                 * Note: Authentication for private caching is configured in origin.authentication,
                 * not here. See root-level conditional rule #2 for authentication requirements.
                 */
                cache: {
                    type: "object",
                    additionalProperties: false,
                    required: ["cacheables"],

                    allOf: [
                        {
                            /**
                             * CONDITIONAL: Distributed request coalescing options requirement
                             *
                             * If distributedRequestsCoalescing is enabled, then the options
                             * object must be provided to configure lock TTL, retry behavior, etc.
                             */
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
                        enabled: { type: "boolean", default: true },
                        purgePath: { type: "string", default: "/purge" },
                        purgeToken: { type: "string" },
                        includeOriginIdInCacheKey: { type: "boolean", default: true },
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
                        },
                        /**
                         * Default cache behavior for all cacheable entries
                         *
                         * These defaults can be overridden per cacheable entry.
                         */
                        defaultCacheSettings: {
                            $ref: "#/definitions/cacheSettings",
                            default: {
                                methods: ["GET", "HEAD", "POST"],
                                private: false,
                                ttl: -1,
                                sortQueryParams: true,
                                ignoredQueryParams: []
                            }
                        },
                        /**
                         * Cacheables array - defines which URLs should be cached
                         *
                         * Each entry has two properties:
                         * - urlPattern: regex pattern to match URLs (required)
                         * - cacheSettings: cache behavior for this URL pattern (optional, inherits from defaultCacheSettings)
                         */
                        cacheables: {
                            type: "array",
                            minItems: 1,
                            items: {
                                type: "object",
                                required: ["urlPattern"],
                                additionalProperties: false,
                                properties: {
                                    urlPattern: { type: "string" },
                                    cacheSettings: { $ref: "#/definitions/cacheSettings" }
                                }
                            }
                        }
                    }
                },
                /**
                 * CORS MODULE
                 *
                 * Configures Cross-Origin Resource Sharing (CORS) for this origin using @fastify/cors.
                 * Per-origin CORS settings override the global defaults defined in speedis.json.
                 *
                 * Supported origin values (JSON-serializable only):
                 *   - Boolean true/false: allow/deny all origins
                 *   - String: allow a single specific origin
                 *   - Array of strings: allow multiple specific origins
                 *
                 * Note: Function-based dynamic origin is not supported via JSON configuration.
                 */
                cors: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                        /**
                         * Enables or disables CORS for this origin.
                         * When false, @fastify/cors is not registered even if cors is defined.
                         */
                        enabled: { type: "boolean", default: true },
                        /**
                         * Allowed origins.
                         * - true  → all origins allowed (reflects request Origin back)
                         * - false → CORS disabled (no Access-Control-Allow-Origin set)
                         * - string → single allowed origin
                         * - string[] → multiple allowed origins
                         */
                        origin: {
                            oneOf: [
                                { type: "boolean" },
                                { type: "string" },
                                { type: "array", items: { type: "string" }, minItems: 1 }
                            ],
                            default: false
                        },
                        /** Allowed HTTP methods for CORS requests */
                        methods: {
                            type: "array",
                            items: {
                                type: "string",
                                enum: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"]
                            }
                        },
                        /** Allowed request headers. If not set, reflects Access-Control-Request-Headers */
                        allowedHeaders: {
                            type: "array",
                            items: { type: "string" }
                        },
                        /** Response headers exposed to the browser (beyond the safe-listed set) */
                        exposedHeaders: {
                            type: "array",
                            items: { type: "string" }
                        },
                        /** Whether the browser should include credentials (cookies, auth headers) */
                        credentials: { type: "boolean" },
                        /**
                         * How long (in seconds) the browser may cache the preflight response.
                         * Corresponds to Access-Control-Max-Age.
                         */
                        maxAge: { type: "integer" },
                        /**
                         * If true, passes the preflight response to the next handler
                         * instead of replying immediately. Default: false.
                         */
                        preflightContinue: { type: "boolean" },
                        /**
                         * HTTP status code to use for successful OPTIONS preflight responses.
                         * Use 200 for legacy browsers that choke on 204. Default: 204.
                         */
                        optionsSuccessStatus: { type: "integer", enum: [200, 204] },
                        /**
                         * If false, disables the automatic OPTIONS preflight route.
                         * Useful when the origin server handles preflight natively.
                         * Default: true.
                         */
                        preflight: { type: "boolean" },
                        /**
                         * If true, returns 400 for preflight requests missing Origin or
                         * Access-Control-Request-Method. Default: true.
                         */
                        strictPreflight: { type: "boolean" },
                        /**
                         * If true, hides the OPTIONS preflight route from generated API schemas.
                         * Default: true.
                         */
                        hideOptionsRoute: { type: "boolean" }
                    }
                },
                /**
                 * REDIS MODULE
                 *
                 * Configures Redis connection for caching and distributed locking.
                 *
                 * Required when: Any of cache or variantsTracker modules are enabled
                 * (see root-level conditional rule #1)
                 */
                redis: {
                    type: "object",
                    additionalProperties: false,
                    required: ["redisOptions"],
                    allOf: [
                        {
                            /**
                             * CONDITIONAL: Circuit breaker options requirement
                             *
                             * If redisBreaker is enabled, then redisBreakerOptions must be provided
                             * to configure circuit breaker behavior for Redis operations.
                             */
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



