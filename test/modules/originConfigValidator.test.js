import { suite, test } from 'node:test'
import assert from 'node:assert'
import Ajv from 'ajv'
import { initOriginConfigValidator } from '../../src/modules/originConfigValidator.js'

suite('OriginConfigValidator Module', () => {

    let validator

    suite('Basic Configuration Validation', () => {

        test('should validate minimal valid configuration', (t) => {
            const ajv = new Ajv({ useDefaults: true })
            validator = initOriginConfigValidator(ajv)

            const config = {
                id: 'test-origin',
                prefix: '/test',
                origin: {
                    http2Options: {
                        authority: 'https://example.com',
                        options: {}
                    }
                }
            }

            const isValid = validator(config, ajv)
            assert.strictEqual(isValid, true)
        })

        test('should reject configuration without id', (t) => {
            const ajv = new Ajv({ useDefaults: true })
            validator = initOriginConfigValidator(ajv)

            const config = {
                prefix: '/test',
                origin: {
                    http2Options: {
                        authority: 'https://example.com',
                        options: {}
                    }
                }
            }

            const isValid = validator(config, ajv)
            assert.strictEqual(isValid, false)
            assert.ok(validator.errors)
        })

        test('should reject configuration without prefix', (t) => {
            const ajv = new Ajv({ useDefaults: true })
            validator = initOriginConfigValidator(ajv)

            const config = {
                id: 'test-origin',
                origin: {
                    http2Options: {
                        authority: 'https://example.com',
                        options: {}
                    }
                }
            }

            const isValid = validator(config, ajv)
            assert.strictEqual(isValid, false)
            assert.ok(validator.errors)
        })

        test('should reject configuration without origin', (t) => {
            const ajv = new Ajv({ useDefaults: true })
            validator = initOriginConfigValidator(ajv)

            const config = {
                id: 'test-origin',
                prefix: '/test'
            }

            const isValid = validator(config, ajv)
            assert.strictEqual(isValid, false)
            assert.ok(validator.errors)
        })
    })

    suite('HTTP1x Configuration', () => {

        test('should validate http1x configuration', (t) => {
            const ajv = new Ajv({ useDefaults: true })
            validator = initOriginConfigValidator(ajv)

            const config = {
                id: 'test-origin',
                prefix: '/test',
                origin: {
                    http1xOptions: {
                        protocol: 'https:',
                        host: 'example.com',
                        port: 443
                    }
                }
            }

            const isValid = validator(config, ajv)
            assert.strictEqual(isValid, true)
        })
    })

    suite('Cache Configuration', () => {

        test('should validate cache configuration with redis', (t) => {
            const ajv = new Ajv({ useDefaults: true })
            validator = initOriginConfigValidator(ajv)

            const config = {
                id: 'test-origin',
                prefix: '/test',
                origin: {
                    http2Options: {
                        authority: 'https://example.com',
                        options: {}
                    }
                },
                cache: {
                    cacheables: [
                        {
                            urlPattern: '/api/.*',
                            cacheSettings: {
                                private: false,
                                ttl: 3600
                            }
                        }
                    ]
                },
                redis: {
                    redisOptions: {
                        url: 'redis://localhost:6379'
                    }
                }
            }

            const isValid = validator(config, ajv)
            assert.strictEqual(isValid, true)
        })

        test('should reject cache configuration without redis', (t) => {
            const ajv = new Ajv({ useDefaults: true })
            validator = initOriginConfigValidator(ajv)

            const config = {
                id: 'test-origin',
                prefix: '/test',
                origin: {
                    http2Options: {
                        authority: 'https://example.com',
                        options: {}
                    }
                },
                cache: {
                    cacheables: [
                        {
                            urlPattern: '/api/.*',
                            private: false,
                            ttl: 3600
                        }
                    ]
                }
            }

            const isValid = validator(config, ajv)
            assert.strictEqual(isValid, false)
        })
    })

    // ---------------------------------------------------------------------
    // Conditional rules
    //
    // The schema defines several cross-module conditional requirements
    // through if/then, oneOf, allOf, and "contains". These tests cover the
    // positive and negative cases for every conditional.
    // ---------------------------------------------------------------------

    function check(config) {
        const ajv = new Ajv({ useDefaults: true })
        const v = initOriginConfigValidator(ajv)
        return { valid: v(config, ajv), errors: v.errors }
    }

    const minimalOrigin = () => ({
        id: 'cond',
        prefix: '/cond',
        origin: { http1xOptions: { protocol: 'http:', host: '127.0.0.1', port: 9999 } }
    })

    suite('Conditional: Redis required when cache or variantsTracker enabled', () => {

        test('cache enabled without redis → invalid', () => {
            assert.strictEqual(check({
                ...minimalOrigin(),
                cache: { cacheables: [{ urlPattern: '/x' }] }
            }).valid, false)
        })

        test('variantsTracker enabled without redis → invalid', () => {
            assert.strictEqual(check({
                ...minimalOrigin(),
                variantsTracker: { urlPatterns: ['/x'] }
            }).valid, false)
        })

        test('cache disabled (enabled:false) without redis → valid', () => {
            assert.strictEqual(check({
                ...minimalOrigin(),
                cache: { enabled: false, cacheables: [{ urlPattern: '/x' }] }
            }).valid, true)
        })

        test('variantsTracker disabled without redis → valid', () => {
            assert.strictEqual(check({
                ...minimalOrigin(),
                variantsTracker: { enabled: false, urlPatterns: ['/x'] }
            }).valid, true)
        })

        test('neither cache nor variantsTracker → redis not required', () => {
            assert.strictEqual(check(minimalOrigin()).valid, true)
        })

        test('cache + variantsTracker + redis → valid', () => {
            assert.strictEqual(check({
                ...minimalOrigin(),
                cache: { cacheables: [{ urlPattern: '/x' }] },
                variantsTracker: { urlPatterns: ['/x'] },
                redis: { redisOptions: { url: 'redis://x' } }
            }).valid, true)
        })
    })

    suite('Conditional: authentication required for private caching', () => {

        const withRedis = (extra) => ({
            ...minimalOrigin(),
            ...extra,
            redis: { redisOptions: { url: 'redis://x' } }
        })

        test('private cacheable without authentication → invalid', () => {
            assert.strictEqual(check(withRedis({
                cache: { cacheables: [{ urlPattern: '/x', cacheSettings: { private: true } }] }
            })).valid, false)
        })

        test('private cacheable with disabled authentication → invalid', () => {
            assert.strictEqual(check({
                id: 'a', prefix: '/a',
                origin: {
                    http1xOptions: { protocol: 'http:', host: '127.0.0.1', port: 9999 },
                    authentication: { enabled: false }
                },
                cache: { cacheables: [{ urlPattern: '/x', cacheSettings: { private: true } }] },
                redis: { redisOptions: { url: 'redis://x' } }
            }).valid, false)
        })

        test('non-private cacheable without authentication → valid', () => {
            assert.strictEqual(check(withRedis({
                cache: { cacheables: [{ urlPattern: '/x', cacheSettings: { private: false } }] }
            })).valid, true)
        })

        test('private cacheable with authentication → valid', () => {
            assert.strictEqual(check({
                id: 'a', prefix: '/a',
                origin: {
                    http1xOptions: { protocol: 'http:', host: '127.0.0.1', port: 9999 },
                    authentication: { scheme: 'Basic' }
                },
                cache: { cacheables: [{ urlPattern: '/x', cacheSettings: { private: true } }] },
                redis: { redisOptions: { url: 'redis://x' } }
            }).valid, true)
        })

        test('cache disabled bypasses authentication check', () => {
            assert.strictEqual(check(withRedis({
                cache: { enabled: false, cacheables: [{ urlPattern: '/x', cacheSettings: { private: true } }] }
            })).valid, true)
        })

        test('defaultCacheSettings.private:true without authentication → invalid', () => {
            assert.strictEqual(check(withRedis({
                cache: {
                    defaultCacheSettings: { private: true },
                    cacheables: [{ urlPattern: '/x' }]
                }
            })).valid, false)
        })

        test('defaultCacheSettings.private:true with authentication → valid', () => {
            assert.strictEqual(check({
                id: 'a', prefix: '/a',
                origin: {
                    http1xOptions: { protocol: 'http:', host: '127.0.0.1', port: 9999 },
                    authentication: { scheme: 'Basic' }
                },
                cache: {
                    defaultCacheSettings: { private: true },
                    cacheables: [{ urlPattern: '/x' }]
                },
                redis: { redisOptions: { url: 'redis://x' } }
            }).valid, true)
        })
    })

    suite('Conditional: origin must declare exactly one of http1xOptions / http2Options', () => {

        test('neither http1xOptions nor http2Options → invalid', () => {
            assert.strictEqual(check({
                id: 'a', prefix: '/a', origin: {}
            }).valid, false)
        })

        test('both http1xOptions and http2Options → invalid', () => {
            assert.strictEqual(check({
                id: 'a', prefix: '/a',
                origin: {
                    http1xOptions: { protocol: 'http:', host: 'x', port: 80 },
                    http2Options: { authority: 'https://x' }
                }
            }).valid, false)
        })

        test('http2Options + agentOptions → invalid (agentOptions only allowed with http1x)', () => {
            assert.strictEqual(check({
                id: 'a', prefix: '/a',
                origin: {
                    http2Options: { authority: 'https://x' },
                    agentOptions: { keepAlive: true }
                }
            }).valid, false)
        })

        test('http1xOptions + agentOptions → valid', () => {
            assert.strictEqual(check({
                id: 'a', prefix: '/a',
                origin: {
                    http1xOptions: { protocol: 'http:', host: 'x', port: 80 },
                    agentOptions: { keepAlive: true }
                }
            }).valid, true)
        })
    })

    suite('Conditional: originBreaker → originBreakerOptions required', () => {

        test('originBreaker:true without options → invalid', () => {
            assert.strictEqual(check({
                id: 'a', prefix: '/a',
                origin: {
                    http1xOptions: { protocol: 'http:', host: 'x', port: 80 },
                    originBreaker: true
                }
            }).valid, false)
        })

        test('originBreaker:true with options → valid', () => {
            assert.strictEqual(check({
                id: 'a', prefix: '/a',
                origin: {
                    http1xOptions: { protocol: 'http:', host: 'x', port: 80 },
                    originBreaker: true,
                    originBreakerOptions: { errorThresholdPercentage: 25 }
                }
            }).valid, true)
        })

        test('originBreaker omitted (defaults to false) without options → valid', () => {
            assert.strictEqual(check(minimalOrigin()).valid, true)
        })
    })

    suite('Conditional: Bearer scheme requirements', () => {

        const withBearerAuth = (bearer) => ({
            id: 'a', prefix: '/a',
            origin: {
                http1xOptions: { protocol: 'http:', host: 'x', port: 80 },
                authentication: { scheme: 'Bearer', bearer }
            }
        })

        test('Bearer scheme without bearer object → invalid', () => {
            assert.strictEqual(check({
                id: 'a', prefix: '/a',
                origin: {
                    http1xOptions: { protocol: 'http:', host: 'x', port: 80 },
                    authentication: { scheme: 'Bearer' }
                }
            }).valid, false)
        })

        test('Bearer with verifyJwtSignature:true (default) requires jwksUri', () => {
            // Empty bearer object → verifyJwtSignature defaults to true → jwksUri required
            assert.strictEqual(check(withBearerAuth({})).valid, false)
        })

        test('Bearer with verifyJwtSignature:false → jwksUri NOT required', () => {
            assert.strictEqual(check(withBearerAuth({ verifyJwtSignature: false })).valid, true)
        })

        test('Bearer with verifyJwtSignature:true + jwksUri → valid', () => {
            assert.strictEqual(check(withBearerAuth({
                verifyJwtSignature: true,
                jwksUri: 'https://example.com/.well-known/jwks.json'
            })).valid, true)
        })

        test('Basic scheme without bearer object → valid', () => {
            assert.strictEqual(check({
                id: 'a', prefix: '/a',
                origin: {
                    http1xOptions: { protocol: 'http:', host: 'x', port: 80 },
                    authentication: { scheme: 'Basic' }
                }
            }).valid, true)
        })
    })

    suite('Conditional: distributedRequestsCoalescing → options required', () => {

        const withRedis = (cache) => ({
            ...minimalOrigin(),
            cache,
            redis: { redisOptions: { url: 'redis://x' } }
        })

        test('distributedRequestsCoalescing:true without options → invalid', () => {
            assert.strictEqual(check(withRedis({
                cacheables: [{ urlPattern: '/x' }],
                distributedRequestsCoalescing: true
            })).valid, false)
        })

        test('distributedRequestsCoalescing:true with full options → valid', () => {
            assert.strictEqual(check(withRedis({
                cacheables: [{ urlPattern: '/x' }],
                distributedRequestsCoalescing: true,
                distributedRequestsCoalescingOptions: {
                    lockTTL: 750, retryCount: 3, retryDelay: 500, retryJitter: 250
                }
            })).valid, true)
        })

        test('distributedRequestsCoalescing:true with partial options → invalid (all 4 fields required)', () => {
            assert.strictEqual(check(withRedis({
                cacheables: [{ urlPattern: '/x' }],
                distributedRequestsCoalescing: true,
                distributedRequestsCoalescingOptions: { lockTTL: 750 }
            })).valid, false)
        })
    })

    suite('Conditional: redisBreaker → redisBreakerOptions required', () => {

        test('redisBreaker:true without options → invalid', () => {
            assert.strictEqual(check({
                ...minimalOrigin(),
                cache: { cacheables: [{ urlPattern: '/x' }] },
                redis: { redisOptions: { url: 'redis://x' }, redisBreaker: true }
            }).valid, false)
        })

        test('redisBreaker:true with options → valid', () => {
            assert.strictEqual(check({
                ...minimalOrigin(),
                cache: { cacheables: [{ urlPattern: '/x' }] },
                redis: {
                    redisOptions: { url: 'redis://x' },
                    redisBreaker: true,
                    redisBreakerOptions: { errorThresholdPercentage: 25 }
                }
            }).valid, true)
        })
    })

    suite('Conditional: bff and variantsTracker require their lists when enabled', () => {

        test('bff enabled without transformations → invalid', () => {
            assert.strictEqual(check({
                ...minimalOrigin(),
                bff: {}
            }).valid, false)
        })

        test('bff with enabled:false without transformations → valid', () => {
            assert.strictEqual(check({
                ...minimalOrigin(),
                bff: { enabled: false }
            }).valid, true)
        })

        test('variantsTracker enabled without urlPatterns → invalid', () => {
            assert.strictEqual(check({
                ...minimalOrigin(),
                variantsTracker: {},
                redis: { redisOptions: { url: 'redis://x' } }
            }).valid, false)
        })

        test('variantsTracker with enabled:false → valid', () => {
            assert.strictEqual(check({
                ...minimalOrigin(),
                variantsTracker: { enabled: false }
            }).valid, true)
        })
    })

    suite('CORS schema validation', () => {

        const withCors = (cors) => ({ ...minimalOrigin(), cors })

        test('cors.origin: true → valid', () => {
            assert.strictEqual(check(withCors({ origin: true })).valid, true)
        })

        test('cors.origin: string → valid', () => {
            assert.strictEqual(check(withCors({ origin: 'https://a.com' })).valid, true)
        })

        test('cors.origin: array of strings → valid', () => {
            assert.strictEqual(check(withCors({ origin: ['https://a.com', 'https://b.com'] })).valid, true)
        })

        test('cors.origin: empty array → invalid (minItems: 1)', () => {
            assert.strictEqual(check(withCors({ origin: [] })).valid, false)
        })

        test('cors.origin: number → invalid', () => {
            assert.strictEqual(check(withCors({ origin: 42 })).valid, false)
        })

        test('cors with valid methods enum → valid', () => {
            assert.strictEqual(check(withCors({ origin: true, methods: ['GET', 'POST'] })).valid, true)
        })

        test('cors with invalid method enum → invalid', () => {
            assert.strictEqual(check(withCors({ origin: true, methods: ['BOGUS'] })).valid, false)
        })

        test('cors.optionsSuccessStatus only accepts 200 or 204', () => {
            assert.strictEqual(check(withCors({ origin: true, optionsSuccessStatus: 200 })).valid, true)
            assert.strictEqual(check(withCors({ origin: true, optionsSuccessStatus: 204 })).valid, true)
            assert.strictEqual(check(withCors({ origin: true, optionsSuccessStatus: 200.5 })).valid, false)
            assert.strictEqual(check(withCors({ origin: true, optionsSuccessStatus: 418 })).valid, false)
        })

        test('cors rejects unknown properties (additionalProperties: false)', () => {
            assert.strictEqual(check(withCors({ origin: true, bogus: 'x' })).valid, false)
        })

        test('cors: { enabled: false } alone (no other fields) → valid', () => {
            assert.strictEqual(check(withCors({ enabled: false })).valid, true)
        })
    })

    // ---------------------------------------------------------------------
    // Default values application
    //
    // Ajv's `useDefaults: true` does NOT apply defaults inside subschemas of
    // oneOf / anyOf / allOf / not. Several modules in this schema use such
    // combinators (origin has oneOf+allOf, cache/redis have allOf, bff and
    // variantsTracker have if/then). These tests guarantee that the defaults
    // declared on direct `properties` of those objects are still applied.
    //
    // If a future change places a `default:` keyword inside a oneOf/anyOf/
    // allOf branch, these tests will fail and signal a silent regression.
    // ---------------------------------------------------------------------
    suite('Default values applied via useDefaults', () => {

        function validateMinimal(extra = {}) {
            const ajv = new Ajv({ useDefaults: true })
            const validator = initOriginConfigValidator(ajv)
            const config = {
                id: 'defaults',
                prefix: '/defaults',
                origin: { http1xOptions: { protocol: 'http:', host: '127.0.0.1', port: 9999 } },
                ...extra
            }
            const ok = validator(config, ajv)
            assert.strictEqual(ok, true, 'config should validate')
            return config
        }

        test('root: logLevel, exposeErrors, metrics get defaults', () => {
            const c = validateMinimal()
            assert.strictEqual(c.logLevel, 'info')
            assert.strictEqual(c.exposeErrors, false)
            assert.strictEqual(c.metrics, true)
        })

        test('origin (with oneOf+allOf): headersToForward defaults to ["*"]', () => {
            const c = validateMinimal()
            assert.deepStrictEqual(c.origin.headersToForward, ['*'])
            assert.deepStrictEqual(c.origin.headersToExclude, [])
            assert.strictEqual(c.origin.originBreaker, false)
        })

        test('origin.http1xOptions defaults injected via $ref', () => {
            const c = validateMinimal()
            assert.strictEqual(c.origin.http1xOptions.method, 'GET')
            assert.strictEqual(c.origin.http1xOptions.path, '/')
            assert.deepStrictEqual(c.origin.http1xOptions.headers, {})
        })

        test('cache (with allOf): enabled, purgePath and other defaults get applied', () => {
            const c = validateMinimal({
                cache: { cacheables: [{ urlPattern: '/x' }] },
                redis: { redisOptions: { url: 'redis://x' } }
            })
            assert.strictEqual(c.cache.enabled, true)
            assert.strictEqual(c.cache.purgePath, '/purge')
            assert.strictEqual(c.cache.includeOriginIdInCacheKey, true)
            assert.strictEqual(c.cache.localRequestsCoalescing, true)
            assert.strictEqual(c.cache.distributedRequestsCoalescing, false)
        })

        test('cache.defaultCacheSettings injected via default sibling of $ref', () => {
            const c = validateMinimal({
                cache: { cacheables: [{ urlPattern: '/x' }] },
                redis: { redisOptions: { url: 'redis://x' } }
            })
            assert.deepStrictEqual(c.cache.defaultCacheSettings, {
                methods: ['GET', 'HEAD', 'POST'],
                private: false,
                ttl: -1,
                sortQueryParams: true,
                ignoredQueryParams: []
            })
        })

        test('bff (with if/then): enabled defaults to true', () => {
            const c = validateMinimal({
                bff: {
                    transformations: [
                        { urlPattern: '.*', actions: [{ phase: 'OriginResponse', uses: 'headers:setHeaders', with: {} }] }
                    ]
                }
            })
            assert.strictEqual(c.bff.enabled, true)
        })

        test('variantsTracker (with if/then): enabled defaults to true', () => {
            const c = validateMinimal({
                variantsTracker: { urlPatterns: ['/x'] },
                cache: { cacheables: [{ urlPattern: '/x' }] },
                redis: { redisOptions: { url: 'redis://x' } }
            })
            assert.strictEqual(c.variantsTracker.enabled, true)
        })

        test('cors: enabled and origin defaults applied (origin has oneOf+default sibling)', () => {
            const c = validateMinimal({ cors: {} })
            assert.strictEqual(c.cors.enabled, true)
            assert.strictEqual(c.cors.origin, false)
        })

        test('redis (with allOf): redisBreaker and disableOriginOnRedisOutage default to false', () => {
            const c = validateMinimal({
                cache: { cacheables: [{ urlPattern: '/x' }] },
                redis: { redisOptions: { url: 'redis://x' } }
            })
            assert.strictEqual(c.redis.redisBreaker, false)
            assert.strictEqual(c.redis.disableOriginOnRedisOutage, false)
        })

        test('originBreakerOptions: defaults injected via $ref to circuitBreakerOptions', () => {
            const c = validateMinimal({
                origin: {
                    http1xOptions: { protocol: 'http:', host: '127.0.0.1', port: 9999 },
                    originBreaker: true,
                    originBreakerOptions: {}
                }
            })
            assert.strictEqual(c.origin.originBreakerOptions.resetTimeout, 30000)
            assert.strictEqual(c.origin.originBreakerOptions.errorThresholdPercentage, 50)
            assert.strictEqual(c.origin.originBreakerOptions.enabled, true)
        })

        test('authentication (with allOf): defaults applied at object and bearer levels', () => {
            const c = validateMinimal({
                origin: {
                    http1xOptions: { protocol: 'http:', host: '127.0.0.1', port: 9999 },
                    authentication: {
                        scheme: 'Bearer',
                        bearer: { verifyJwtSignature: false }
                    }
                }
            })
            assert.strictEqual(c.origin.authentication.enabled, true)
            assert.strictEqual(c.origin.authentication.bearer.claim, 'sub')
            assert.strictEqual(c.origin.authentication.bearer.allowUnsigned, false)
        })

        test('idTransformation defaults applied at every nesting level', () => {
            const c = validateMinimal({
                origin: {
                    http1xOptions: { protocol: 'http:', host: '127.0.0.1', port: 9999 },
                    authentication: { idTransformation: { hash: {} } }
                }
            })
            const t = c.origin.authentication.idTransformation
            assert.strictEqual(t.prefix, '')
            assert.strictEqual(t.suffix, '')
            assert.strictEqual(t.hash.enabled, true)
            assert.strictEqual(t.hash.algorithm, 'md5')
            assert.strictEqual(t.hash.hex, true)
        })
    })
})

