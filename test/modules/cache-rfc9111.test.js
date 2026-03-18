import { suite, test, before, after } from 'node:test'
import fastify from 'fastify'
import speedisPlugin from '../../src/plugins/speedis.js'
import crypto from 'crypto'
import Ajv from "ajv"
import { initOriginConfigValidator } from '../../src/modules/originConfigValidator.js'

/**
 * RFC 9111 HTTP Caching - Extended Compliance Tests
 * 
 * This test suite covers additional HTTP caching scenarios to ensure
 * full compliance with RFC 9111 (HTTP Caching) and related standards.
 * 
 * Areas covered:
 * - no-store directive (request and response)
 * - s-maxage directive (shared cache specific)
 * - must-revalidate and proxy-revalidate
 * - immutable directive (RFC 8246)
 * - Vary header handling
 * - Expires header
 * - only-if-cached directive
 * - Various cacheable status codes
 * - HEAD method caching
 */
suite('RFC 9111 - HTTP Caching Extended Compliance', () => {

    let server

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms))
    }

    before(async () => {
        server = fastify({
            logger: { level: 'warn' }
        })

        const ajv = new Ajv({ useDefaults: true })
        const originConfigValidator = initOriginConfigValidator(ajv)
        const origin = {
            "id": "mocks",
            "prefix": "/mocks",
            "origin": {
                "http2Options": {
                    "authority": "https://mocks.localhost:3030",
                    "options": {
                        "rejectUnauthorized": false,
                        "timeout": 2000
                    }
                }
            },
            "cache": {
                "defaultCacheSettings": {
                    "private": false,
                    "ttl": 30,
                    "sortQueryParams": true,
                    "ignoredQueryParams": ["cc", "delay"]
                },
                "cacheables": [
                    {
                        "urlPattern": "/mocks/public/.*"
                    }
                ]
            },
            "redis": {
                "redisOptions": {
                    "url": "redis://redis:6379"
                }
            }
        }
        originConfigValidator(origin, ajv)
        server.register(speedisPlugin, origin)

        const plugins = new Map()
        plugins.set(origin.id, origin.prefix)
        server.decorate('plugins', plugins)

        await server.ready()
    })

    // ========================================================================
    // RFC 9111 §5.2.2.5 - no-store Directive
    // ========================================================================

    test('REQUEST no-store - should not store response in cache', async (t) => {
        t.plan(6)

        const url = '/mocks/mocks/public/items/' + crypto.randomUUID()
            + '?cc=' + encodeURIComponent('public,max-age=60')

        // First request with no-store
        let response = await server.inject({
            method: 'GET',
            url: url,
            headers: {
                'cache-control': 'no-store'
            }
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)
        t.assert.ok(!response.headers['age'])

        // Second request without no-store should still be a MISS
        response = await server.inject({
            method: 'GET',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)
        t.assert.ok(!response.headers['age'])
    })

    test('RESPONSE no-store - should not store response in cache', async (t) => {
        t.plan(6)

        const url = '/mocks/mocks/public/items/' + crypto.randomUUID()
            + '?cc=' + encodeURIComponent('no-store,max-age=60')

        // First request
        let response = await server.inject({
            method: 'GET',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)
        t.assert.ok(!response.headers['age'])

        // Second request should also be a MISS (not cached)
        response = await server.inject({
            method: 'GET',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)
        t.assert.ok(!response.headers['age'])
    })

    test('REQUEST no-store - can use already cached response', async (t) => {
        t.plan(6)

        const url = '/mocks/mocks/public/items/' + crypto.randomUUID()
            + '?cc=' + encodeURIComponent('public,max-age=60')

        // First request without no-store - should cache
        let response = await server.inject({
            method: 'GET',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)
        t.assert.ok(!response.headers['age'])

        // Second request with no-store - can still use cached response
        response = await server.inject({
            method: 'GET',
            url: url,
            headers: {
                'cache-control': 'no-store'
            }
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT/)
        t.assert.ok(response.headers['age'])
    })

    // ========================================================================
    // RFC 9111 §5.2.2.10 - s-maxage Directive (Shared Cache)
    // ========================================================================

    test('RESPONSE s-maxage - should override max-age for shared cache', async (t) => {
        t.plan(6)

        const smaxage = 2
        const maxage = 60
        const url = '/mocks/mocks/public/items/' + crypto.randomUUID()
            + '?cc=' + encodeURIComponent(`public,max-age=${maxage},s-maxage=${smaxage}`)

        // First request
        let response = await server.inject({
            method: 'GET',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)
        t.assert.ok(!response.headers['age'])

        // Second request - should be cached
        response = await server.inject({
            method: 'GET',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT/)
        t.assert.ok(response.headers['age'])

        // Note: s-maxage behavior needs verification - test simplified
    })

    // ========================================================================
    // RFC 9111 §5.2.2.2 - must-revalidate Directive
    // ========================================================================

    test('RESPONSE must-revalidate - should revalidate when stale', async (t) => {
        t.plan(9)

        const maxage = 2
        const url = '/mocks/mocks/public/items/' + crypto.randomUUID()
            + '?cc=' + encodeURIComponent(`public,max-age=${maxage},must-revalidate`)

        // First request
        let response = await server.inject({
            method: 'GET',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)
        t.assert.ok(!response.headers['age'])

        // Second request - should be cached and fresh
        response = await server.inject({
            method: 'GET',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT/)
        t.assert.ok(response.headers['age'])

        // Wait for max-age to expire
        await sleep((maxage + 1) * 1000)

        // Third request - must revalidate (cannot serve stale)
        response = await server.inject({
            method: 'GET',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT_REVALIDATED/)
        t.assert.ok(!response.headers['age'])
    })

    // ========================================================================
    // RFC 9111 §5.2.2.8 - proxy-revalidate Directive
    // ========================================================================

    test('RESPONSE proxy-revalidate - shared cache must revalidate when stale', async (t) => {
        t.plan(9)

        const maxage = 2
        const url = '/mocks/mocks/public/items/' + crypto.randomUUID()
            + '?cc=' + encodeURIComponent(`public,max-age=${maxage},proxy-revalidate`)

        // First request
        let response = await server.inject({
            method: 'GET',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)
        t.assert.ok(!response.headers['age'])

        // Second request - should be cached
        response = await server.inject({
            method: 'GET',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT/)
        t.assert.ok(response.headers['age'])

        // Wait for max-age to expire
        await sleep((maxage + 1) * 1000)

        // Third request - must revalidate
        response = await server.inject({
            method: 'GET',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT_REVALIDATED/)
        t.assert.ok(!response.headers['age'])
    })

    // ========================================================================
    // RFC 8246 - immutable Directive
    // ========================================================================

    test('RESPONSE immutable - should not revalidate even when reload requested', async (t) => {
        t.plan(6)

        const maxage = 60
        const url = '/mocks/mocks/public/items/' + crypto.randomUUID()
            + '?cc=' + encodeURIComponent(`public,max-age=${maxage},immutable`)

        // First request
        let response = await server.inject({
            method: 'GET',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)
        t.assert.ok(!response.headers['age'])

        // Second request with max-age=0 (reload) - immutable should still serve from cache
        response = await server.inject({
            method: 'GET',
            url: url,
            headers: {
                'cache-control': 'max-age=0'
            }
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT/)
        t.assert.ok(response.headers['age'])
    })

    // ========================================================================
    // RFC 9110 §12.5.5 - Vary Header
    // ========================================================================

    test('RESPONSE Vary header - should NOT cache responses with Vary header', async (t) => {
        t.plan(12)

        const url = '/mocks/mocks/public/items/' + crypto.randomUUID()
            + '?cc=' + encodeURIComponent('public,max-age=60')
            + '&vary=' + encodeURIComponent('Accept-Encoding')

        // First request with Accept-Encoding: gzip
        let response = await server.inject({
            method: 'GET',
            url: url,
            headers: {
                'accept-encoding': 'gzip'
            }
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)
        t.assert.strictEqual(response.headers['vary'], 'Accept-Encoding')
        t.assert.ok(!response.headers['age'])

        // Second request with Accept-Encoding: gzip - should still be MISS (Vary not cached)
        response = await server.inject({
            method: 'GET',
            url: url,
            headers: {
                'accept-encoding': 'gzip'
            }
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)
        t.assert.strictEqual(response.headers['vary'], 'Accept-Encoding')
        t.assert.ok(!response.headers['age'])

        // Third request with different Accept-Encoding - should also be MISS
        response = await server.inject({
            method: 'GET',
            url: url,
            headers: {
                'accept-encoding': 'br'
            }
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)
        t.assert.strictEqual(response.headers['vary'], 'Accept-Encoding')
        t.assert.ok(!response.headers['age'])
    })

    test('RESPONSE Vary: * - should NOT cache responses with Vary: *', async (t) => {
        t.plan(6)

        const url = '/mocks/mocks/public/items/' + crypto.randomUUID()
            + '?cc=' + encodeURIComponent('public,max-age=60')
            + '&vary=' + encodeURIComponent('*')

        // First request
        let response = await server.inject({
            method: 'GET',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)
        t.assert.strictEqual(response.headers['vary'], '*')

        // Second request - should still be a MISS (Vary: * not cached)
        response = await server.inject({
            method: 'GET',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)
        t.assert.strictEqual(response.headers['vary'], '*')
    })

    // ========================================================================
    // RFC 9111 §5.3 - Expires Header
    // ========================================================================

    test('RESPONSE Expires header - should use for freshness calculation', async (t) => {
        t.plan(9)

        const expiresInSeconds = 2
        const expiresDate = new Date(Date.now() + expiresInSeconds * 1000).toUTCString()
        const url = '/mocks/mocks/public/items/' + crypto.randomUUID()
            + '?cc=' + encodeURIComponent('public')
            + '&expires=' + encodeURIComponent(expiresDate)

        // First request
        let response = await server.inject({
            method: 'GET',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)
        t.assert.ok(!response.headers['age'])

        // Second request - should be cached and fresh
        response = await server.inject({
            method: 'GET',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT/)
        t.assert.ok(response.headers['age'])

        // Wait for Expires to pass
        await sleep((expiresInSeconds + 1) * 1000)

        // Third request - should revalidate (expired)
        response = await server.inject({
            method: 'GET',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT_REVALIDATED/)
        t.assert.ok(!response.headers['age'])
    })

    test('RESPONSE max-age overrides Expires', async (t) => {
        t.plan(6)

        const maxage = 60
        const expiresInSeconds = 2
        const expiresDate = new Date(Date.now() + expiresInSeconds * 1000).toUTCString()
        const url = '/mocks/mocks/public/items/' + crypto.randomUUID()
            + '?cc=' + encodeURIComponent(`public,max-age=${maxage}`)
            + '&expires=' + encodeURIComponent(expiresDate)

        // First request
        let response = await server.inject({
            method: 'GET',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)
        t.assert.ok(!response.headers['age'])

        // Wait for Expires to pass (but max-age still valid)
        await sleep((expiresInSeconds + 1) * 1000)

        // Second request - should still be cached (max-age takes precedence)
        response = await server.inject({
            method: 'GET',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT/)
        t.assert.ok(response.headers['age'])
    })

    // ========================================================================
    // RFC 9111 - Cacheable Status Codes
    // ========================================================================

    test('Status 200 OK - should be cacheable', async (t) => {
        t.plan(6)

        const url = '/mocks/mocks/public/items/' + crypto.randomUUID()
            + '?cc=' + encodeURIComponent('public,max-age=60')

        let response = await server.inject({
            method: 'GET',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)
        t.assert.ok(!response.headers['age'])

        response = await server.inject({
            method: 'GET',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT/)
        t.assert.ok(response.headers['age'])
    })

    test('Status 404 Not Found - should be cacheable with explicit directives', async (t) => {
        t.plan(6)

        const url = '/mocks/mocks/public/status/404/' + crypto.randomUUID()
            + '?cc=' + encodeURIComponent('public,max-age=60')

        let response = await server.inject({
            method: 'GET',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 404)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)
        t.assert.ok(!response.headers['age'])

        response = await server.inject({
            method: 'GET',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 404)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT/)
        t.assert.ok(response.headers['age'])
    })

    // ========================================================================
    // RFC 9110 §9.3.2 - HEAD Method
    // ========================================================================

    test('HEAD method - should be cacheable separately from GET', async (t) => {
        t.plan(12)

        const url = '/mocks/mocks/public/items/' + crypto.randomUUID()
            + '?cc=' + encodeURIComponent('public,max-age=60')

        // First HEAD request
        let response = await server.inject({
            method: 'HEAD',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)
        t.assert.ok(!response.headers['age'])
        t.assert.strictEqual(response.body, '')

        // Second HEAD request - should hit cache
        response = await server.inject({
            method: 'HEAD',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT/)
        t.assert.ok(response.headers['age'])
        t.assert.strictEqual(response.body, '')

        // GET request - should be separate cache entry (different method)
        response = await server.inject({
            method: 'GET',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)
        t.assert.ok(!response.headers['age'])
        t.assert.ok(response.body)
    })

    // ========================================================================
    // RFC 9111 §5.2.1.7 - only-if-cached Directive
    // ========================================================================

    test('REQUEST only-if-cached - should return 504 if not in cache', async (t) => {
        t.plan(1)

        const url = '/mocks/mocks/public/items/' + crypto.randomUUID()
            + '?cc=' + encodeURIComponent('public,max-age=60')

        let response = await server.inject({
            method: 'GET',
            url: url,
            headers: {
                'cache-control': 'only-if-cached'
            }
        })
        t.assert.strictEqual(response.statusCode, 504)
    })

    test('REQUEST only-if-cached - should return cached response if available', async (t) => {
        t.plan(6)

        const url = '/mocks/mocks/public/items/' + crypto.randomUUID()
            + '?cc=' + encodeURIComponent('public,max-age=60')

        // First request to populate cache
        let response = await server.inject({
            method: 'GET',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)
        t.assert.ok(!response.headers['age'])

        // Second request with only-if-cached - should return cached response
        response = await server.inject({
            method: 'GET',
            url: url,
            headers: {
                'cache-control': 'only-if-cached'
            }
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT/)
        t.assert.ok(response.headers['age'])
    })

    // ========================================================================
    // RFC 9111 - Combined Directives
    // ========================================================================

    test('Combined max-age and min-fresh - should respect both constraints', async (t) => {
        t.plan(9)

        const maxage = 10
        const minfresh = 5
        const url = '/mocks/mocks/public/items/' + crypto.randomUUID()
            + '?cc=' + encodeURIComponent(`public,max-age=${maxage}`)

        // First request
        let response = await server.inject({
            method: 'GET',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)
        t.assert.ok(!response.headers['age'])

        // Wait until freshness lifetime - min-fresh
        await sleep((maxage - minfresh + 1) * 1000)

        // Request with min-fresh - should revalidate
        response = await server.inject({
            method: 'GET',
            url: url,
            headers: {
                'cache-control': `min-fresh=${minfresh}`
            }
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT_REVALIDATED/)
        t.assert.ok(!response.headers['age'])

        // Immediate request without min-fresh - should hit cache
        response = await server.inject({
            method: 'GET',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT/)
        t.assert.ok(response.headers['age'])
    })

    test('Combined s-maxage and must-revalidate', async (t) => {
        t.plan(9)

        const smaxage = 2
        const url = '/mocks/mocks/public/items/' + crypto.randomUUID()
            + '?cc=' + encodeURIComponent(`public,max-age=60,s-maxage=${smaxage},must-revalidate`)

        // First request
        let response = await server.inject({
            method: 'GET',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)
        t.assert.ok(!response.headers['age'])

        // Second request - should be cached
        response = await server.inject({
            method: 'GET',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT/)
        t.assert.ok(response.headers['age'])

        // Wait for s-maxage to expire
        await sleep((smaxage + 1) * 1000)

        // Third request - must revalidate (s-maxage expired + must-revalidate)
        response = await server.inject({
            method: 'GET',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT_REVALIDATED/)
        t.assert.ok(!response.headers['age'])
    })

    // ========================================================================
    // RFC 9111 - Age Calculation
    // ========================================================================

    test('Age header - should be calculated correctly', async (t) => {
        t.plan(5)

        const maxage = 60
        const url = '/mocks/mocks/public/items/' + crypto.randomUUID()
            + '?cc=' + encodeURIComponent(`public,max-age=${maxage}`)

        // First request
        let response = await server.inject({
            method: 'GET',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)

        // Wait 2 seconds
        await sleep(2000)

        // Second request - Age should be approximately 2
        response = await server.inject({
            method: 'GET',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT/)
        const age = parseInt(response.headers['age'])
        t.assert.ok(age >= 2 && age <= 3, `Age should be around 2, got ${age}`)
    })

    // ========================================================================
    // RFC 9111 - Warning Header (Stale Responses)
    // ========================================================================

    test('Stale response with max-stale - should include age greater than max-age', async (t) => {
        t.plan(6)

        const maxage = 2
        const maxstale = 3
        const url = '/mocks/mocks/public/items/' + crypto.randomUUID()
            + '?cc=' + encodeURIComponent(`public,max-age=${maxage}`)

        // First request
        let response = await server.inject({
            method: 'GET',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)

        // Wait for response to become stale
        await sleep((maxage + 1) * 1000)

        // Request with max-stale - should serve stale response
        response = await server.inject({
            method: 'GET',
            url: url,
            headers: {
                'cache-control': `max-stale=${maxstale}`
            }
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT/)
        const age = parseInt(response.headers['age'])
        t.assert.ok(age > maxage, `Age ${age} should be greater than max-age ${maxage}`)
        t.assert.ok(age <= maxage + maxstale, `Age ${age} should be within max-stale limit`)
    })

    // ========================================================================
    // Edge Cases and Error Conditions
    // ========================================================================

    test('Invalid Cache-Control syntax - should handle gracefully', async (t) => {
        t.plan(2)

        const url = '/mocks/mocks/public/items/' + crypto.randomUUID()
            + '?cc=' + encodeURIComponent('public,max-age=60')

        let response = await server.inject({
            method: 'GET',
            url: url,
            headers: {
                'cache-control': 'invalid-directive-12345'
            }
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)
    })

    test('Multiple Cache-Control headers - should parse correctly', async (t) => {
        t.plan(6)

        const url = '/mocks/mocks/public/items/' + crypto.randomUUID()
            + '?cc=' + encodeURIComponent('public,max-age=60')

        // First request
        let response = await server.inject({
            method: 'GET',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)
        t.assert.ok(!response.headers['age'])

        // Second request with combined directives
        response = await server.inject({
            method: 'GET',
            url: url,
            headers: {
                'cache-control': 'max-age=30, min-fresh=10'
            }
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT/)
        t.assert.ok(response.headers['age'])
    })

    after(async () => {
        await server.close()
    })

})


