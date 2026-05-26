import { describe, it, suite, test } from 'node:test'
import assert from 'node:assert'
import fastify from 'fastify'
import { initBff, transform, CLIENT_REQUEST, CLIENT_RESPONSE, ORIGIN_REQUEST, ORIGIN_RESPONSE, CACHE_KEY_GENERATION, VARIANTS_TRACKER } from '../../src/modules/bff.js'

describe('BFF Transformations - Multiple Matches', () => {

    it('should apply all transformations that match the URL in order', () => {
        // Simulate the BFF transform logic
        const transformations = [
            {
                urlPattern: "/api/users/.*",
                re: new RegExp("/api/users/.*"),
                actions: [
                    {
                        phase: "OriginResponse",
                        uses: "headers:setHeaders",
                        with: {
                            headers: {
                                "X-User-API": "true",
                                "Cache-Control": "private, max-age=600"
                            }
                        }
                    }
                ]
            },
            {
                urlPattern: "/api/.*",
                re: new RegExp("/api/.*"),
                actions: [
                    {
                        phase: "OriginResponse",
                        uses: "headers:setHeaders",
                        with: {
                            headers: {
                                "X-API": "true"
                            }
                        }
                    }
                ]
            },
            {
                urlPattern: ".*",
                re: new RegExp(".*"),
                actions: [
                    {
                        phase: "OriginResponse",
                        uses: "headers:setHeaders",
                        with: {
                            headers: {
                                "X-Powered-By": "Speedis",
                                "Cache-Control": "public, max-age=300"
                            }
                        }
                    }
                ]
            }
        ]

        const target = {
            path: "/api/users/123",
            headers: {}
        }

        // Simulate applying all matching transformations
        const matchedTransformations = []
        transformations.forEach(transformation => {
            if (transformation.re.test(target.path)) {
                matchedTransformations.push(transformation.urlPattern)
                transformation.actions.forEach(action => {
                    if (action.phase === "OriginResponse") {
                        // Simulate setHeaders action
                        Object.assign(target.headers, action.with.headers)
                    }
                })
            }
        })

        // Verify that all 3 transformations matched
        assert.strictEqual(matchedTransformations.length, 3)
        assert.deepStrictEqual(matchedTransformations, [
            "/api/users/.*",
            "/api/.*",
            ".*"
        ])

        // Verify that headers were applied in order
        // The last transformation should win for Cache-Control
        assert.strictEqual(target.headers['X-User-API'], 'true')
        assert.strictEqual(target.headers['X-API'], 'true')
        assert.strictEqual(target.headers['X-Powered-By'], 'Speedis')
        assert.strictEqual(target.headers['Cache-Control'], 'public, max-age=300') // Last one wins
    })

    it('should apply transformations in order - last wins for conflicting headers', () => {
        const transformations = [
            {
                urlPattern: "/api/.*",
                re: new RegExp("/api/.*"),
                actions: [
                    {
                        phase: "OriginResponse",
                        uses: "headers:setHeaders",
                        with: {
                            headers: {
                                "Cache-Control": "private, max-age=600"
                            }
                        }
                    }
                ]
            },
            {
                urlPattern: ".*",
                re: new RegExp(".*"),
                actions: [
                    {
                        phase: "OriginResponse",
                        uses: "headers:setHeaders",
                        with: {
                            headers: {
                                "Cache-Control": "public, max-age=300"
                            }
                        }
                    }
                ]
            }
        ]

        const target = {
            path: "/api/test",
            headers: {}
        }

        transformations.forEach(transformation => {
            if (transformation.re.test(target.path)) {
                transformation.actions.forEach(action => {
                    if (action.phase === "OriginResponse") {
                        Object.assign(target.headers, action.with.headers)
                    }
                })
            }
        })

        // The last transformation should win
        assert.strictEqual(target.headers['Cache-Control'], 'public, max-age=300')
    })

    it('should only apply transformations that match the URL', () => {
        const transformations = [
            {
                urlPattern: "/api/users/.*",
                re: new RegExp("/api/users/.*"),
                actions: [
                    {
                        phase: "OriginResponse",
                        uses: "headers:setHeaders",
                        with: {
                            headers: {
                                "X-User-API": "true"
                            }
                        }
                    }
                ]
            },
            {
                urlPattern: "/api/products/.*",
                re: new RegExp("/api/products/.*"),
                actions: [
                    {
                        phase: "OriginResponse",
                        uses: "headers:setHeaders",
                        with: {
                            headers: {
                                "X-Product-API": "true"
                            }
                        }
                    }
                ]
            }
        ]

        const target = {
            path: "/api/users/123",
            headers: {}
        }

        transformations.forEach(transformation => {
            if (transformation.re.test(target.path)) {
                transformation.actions.forEach(action => {
                    if (action.phase === "OriginResponse") {
                        Object.assign(target.headers, action.with.headers)
                    }
                })
            }
        })

        // Only the first transformation should have been applied
        assert.strictEqual(target.headers['X-User-API'], 'true')
        assert.strictEqual(target.headers['X-Product-API'], undefined)
    })
})

// ---------------------------------------------------------------------------
// Real initBff + transform tests
//
// The suites above are pure simulations of the transform logic. The tests
// below exercise the actual bff module so the per-phase action index is
// covered end-to-end.
// ---------------------------------------------------------------------------

async function buildOpts(transformations) {
    const opts = {
        id: 'bff-test',
        bff: { enabled: true, transformations }
    }
    const server = fastify({ logger: false })
    await initBff(server, opts)
    return { opts, server }
}

suite('BFF transform – per-phase action index', () => {

    test('initBff builds actionsByPhase grouped by phase', async () => {
        const { opts, server } = await buildOpts([
            {
                urlPattern: '/api/.*',
                actions: [
                    { phase: 'OriginRequest', uses: 'headers:setHeaders', with: { 'x-a': '1' } },
                    { phase: 'OriginResponse', uses: 'headers:setHeaders', with: { 'x-b': '1' } }
                ]
            },
            {
                urlPattern: '/api/users/.*',
                actions: [
                    { phase: 'OriginResponse', uses: 'headers:setHeaders', with: { 'x-c': '1' } }
                ]
            }
        ])
        try {
            assert.strictEqual(opts.bff.actionsByPhase['OriginRequest'].length, 1)
            assert.strictEqual(opts.bff.actionsByPhase['OriginResponse'].length, 2)
            assert.strictEqual(opts.bff.actionsByPhase['ClientRequest'], undefined)
        } finally {
            await server.close()
        }
    })

    test('transform only runs actions of the requested phase', async () => {
        const { opts, server } = await buildOpts([
            {
                urlPattern: '.*',
                actions: [
                    { phase: 'OriginRequest', uses: 'headers:setHeaders', with: { 'x-request-side': '1' } },
                    { phase: 'OriginResponse', uses: 'headers:setHeaders', with: { 'x-response-side': '1' } }
                ]
            }
        ])
        try {
            const req = { path: '/anything', headers: {} }
            transform(opts, ORIGIN_REQUEST, req)
            assert.strictEqual(req.headers['x-request-side'], '1')
            assert.strictEqual(req.headers['x-response-side'], undefined)

            const res = { path: '/anything', headers: {} }
            transform(opts, ORIGIN_RESPONSE, res)
            assert.strictEqual(res.headers['x-response-side'], '1')
            assert.strictEqual(res.headers['x-request-side'], undefined)
        } finally {
            await server.close()
        }
    })

    test('transform preserves insertion order across transformations (last wins)', async () => {
        const { opts, server } = await buildOpts([
            {
                urlPattern: '/api/users/.*',
                actions: [
                    { phase: 'OriginResponse', uses: 'headers:setHeaders', with: { 'cache-control': 'private, max-age=600' } }
                ]
            },
            {
                urlPattern: '.*',
                actions: [
                    { phase: 'OriginResponse', uses: 'headers:setHeaders', with: { 'cache-control': 'public, max-age=300' } }
                ]
            }
        ])
        try {
            const res = { path: '/api/users/123', headers: {} }
            transform(opts, ORIGIN_RESPONSE, res)
            // Second transformation runs last and wins on the conflicting header.
            assert.strictEqual(res.headers['cache-control'], 'public, max-age=300')
        } finally {
            await server.close()
        }
    })

    test('transform short-circuits when no actions are registered for the phase', async () => {
        const { opts, server } = await buildOpts([
            {
                urlPattern: '.*',
                actions: [{ phase: 'OriginResponse', uses: 'headers:setHeaders', with: { 'x-y': '1' } }]
            }
        ])
        try {
            const req = { path: '/anything', headers: {} }
            // Should be a no-op (no ClientRequest actions configured).
            transform(opts, CLIENT_REQUEST, req)
            assert.deepStrictEqual(req.headers, {})
        } finally {
            await server.close()
        }
    })

    test('transform skips actions whose urlPattern does not match target.path', async () => {
        const { opts, server } = await buildOpts([
            {
                urlPattern: '/users/.*',
                actions: [{ phase: 'OriginResponse', uses: 'headers:setHeaders', with: { 'x-users': '1' } }]
            },
            {
                urlPattern: '/products/.*',
                actions: [{ phase: 'OriginResponse', uses: 'headers:setHeaders', with: { 'x-products': '1' } }]
            }
        ])
        try {
            const res = { path: '/users/42', headers: {} }
            transform(opts, ORIGIN_RESPONSE, res)
            assert.strictEqual(res.headers['x-users'], '1')
            assert.strictEqual(res.headers['x-products'], undefined)
        } finally {
            await server.close()
        }
    })

    test('Cache-Control no-transform skips ClientResponse but not CacheKeyGeneration or VariantsTracker', async () => {
        const { opts, server } = await buildOpts([
            {
                urlPattern: '.*',
                actions: [
                    { phase: 'ClientResponse', uses: 'headers:setHeaders', with: { 'x-client': '1' } },
                    { phase: 'CacheKeyGeneration', uses: 'headers:setHeaders', with: { 'x-cachekey': '1' } },
                    { phase: 'VariantsTracker', uses: 'headers:setHeaders', with: { 'x-variant': '1' } }
                ]
            }
        ])
        try {
            // headers:setHeaders writes onto target.headers; we abuse this here to
            // observe whether transform() ran or not for each phase.
            const wireTarget = { path: '/anything', headers: { 'cache-control': 'no-transform' } }
            transform(opts, CLIENT_RESPONSE, wireTarget)
            assert.strictEqual(wireTarget.headers['x-client'], undefined, 'no-transform should block ClientResponse')

            const keyTarget = { path: '/anything', headers: { 'cache-control': 'no-transform' } }
            transform(opts, CACHE_KEY_GENERATION, keyTarget)
            assert.strictEqual(keyTarget.headers['x-cachekey'], '1', 'no-transform must not block CacheKeyGeneration')

            const variantTarget = { path: '/anything', headers: { 'cache-control': 'no-transform' } }
            transform(opts, VARIANTS_TRACKER, variantTarget)
            assert.strictEqual(variantTarget.headers['x-variant'], '1', 'no-transform must not block VariantsTracker')
        } finally {
            await server.close()
        }
    })
})

