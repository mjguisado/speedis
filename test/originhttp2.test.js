import { suite, test, before, after } from 'node:test'
import fastify from 'fastify'
import speedisPlugin from '../src/plugins/speedis.js'

suite('Speedis - Origin', () => {

    let server

    before(async () => {

        server = fastify({
            logger: { level: 'info' }
        })

        const plugins = new Map()

        server.register(
            speedisPlugin,
            {
                "id": "proxy",
                "prefix": "/proxy",
                "exposeErrors": true,
                "metrics": false,
                "origin": {
                    "http2Options": {
                        "authority": "https://mocks:3032",
                        "options": {
                            "rejectUnauthorized": false,
                            "timeout": 1000
                        }
                    }
                }
            }
        )
        plugins.set("proxy", "/proxy")

        server.register(
            speedisPlugin,
            {
                "id": "proxy-timeout",
                "prefix": "/proxy-timeout",
                "exposeErrors": true,
                "metrics": false,
                "origin": {
                    "http2Options": {
                        "authority": "https://mocks:3032",
                        "options": {
                            "rejectUnauthorized": false,
                            "timeout": 1000
                        }
                    },
                    "originTimeout": 1000
                }
            }
        )
        plugins.set("proxy-proxy", "/proxy-timeout")

        server.register(
            speedisPlugin,
            {
                "id": "proxy-timeout-circuit-breaker",
                "prefix": "/proxy-timeout-circuit-breaker",
                "exposeErrors": true,
                "metrics": false,
                "origin": {
                    "http2Options": {
                        "authority": "https://mocks:3032",
                        "options": {
                            "rejectUnauthorized": false,
                            "timeout": 1000
                        }
                    },
                    "originTimeout": 1000,
                    "originBreaker": true,
                    "originBreakerOptions": {
                        "errorThresholdPercentage": 25,
                        "resetTimeout": 2000
                    }
                }
            }
        )
        plugins.set("proxy-timeout-circuit-breaker", "/proxy-timeout-circuit-breaker")

        server.decorate('plugins', plugins)
        await server.ready()

    })

    test('Proxy', async (t) => {
        t.plan(1)
        let url = '/proxy/mocks/items/public-' + crypto.randomUUID()
        let response = await server.inject({
            method: 'GET',
            url: url
        })
        t.assert.strictEqual(200, response.statusCode)
    })

    test('Proxy - Timeout', async (t) => {
        t.plan(2)
        let url = '/proxy-timeout/mocks/items/public-' + crypto.randomUUID()
        let response = await server.inject({
            method: 'GET',
            url: url + '?delay=800'
        })
        t.assert.strictEqual(200, response.statusCode)
        response = await server.inject({
            method: 'GET',
            url: url + '?delay=1200'
        })
        t.assert.strictEqual(504, response.statusCode)
    })

    test('Proxy - Timeout - Circuit Breaker - CLOSED', async (t) => {
        t.plan(11)
        let url, response
        for (let counter = 0; counter < 5; counter++) {
            url = '/proxy-timeout/mocks/items/public-' + crypto.randomUUID()
            response = await server.inject({
                method: 'GET',
                url: url
            })
            t.assert.strictEqual(200, response.statusCode)
        }
        url = '/proxy-timeout/mocks/items/public-' + crypto.randomUUID() + '?delay=2500'
        response = await server.inject({
            method: 'GET',
            url: url + '?delay=1200'
        })
        t.assert.strictEqual(504, response.statusCode)
        for (let counter = 0; counter < 5; counter++) {
            url = '/proxy-timeout/mocks/items/public-' + crypto.randomUUID()
            response = await server.inject({
                method: 'GET',
                url: url
            })
            t.assert.strictEqual(200, response.statusCode)
        }
    })

    test('Proxy - Timeout - Circuit Breaker - OPEN', async (t) => {
        t.plan(12)
        let url, response
        // CB CLOSED => 200
        for (let counter = 0; counter < 4; counter++) {
            url = '/proxy-timeout-circuit-breaker/mocks/items/public-' + crypto.randomUUID()
            response = await server.inject({
                method: 'GET',
                url: url
            })
            t.assert.strictEqual(200, response.statusCode)
        }
        // (2x504) / (3x200) > 25% => CB OPENED
        for (let counter = 0; counter < 2; counter++) {
            url = '/proxy-timeout-circuit-breaker/mocks/items/public-' + crypto.randomUUID() + '?delay=2500'
            response = await server.inject({
                method: 'GET',
                url: url + '?delay=1200'
            })
            t.assert.strictEqual(504, response.statusCode)
        }
        // CB OPENED => 500
        for (let counter = 0; counter < 2; counter++) {
            url = '/proxy-timeout-circuit-breaker/mocks/items/public-' + crypto.randomUUID()
            response = await server.inject({
                method: 'GET',
                url: url
            })
            t.assert.strictEqual(500, response.statusCode)
        }
        // Wait to HALF OPENED
        await new Promise((resolve) => setTimeout(resolve, 2000))
        // CB HALF CLOSED and then CB CLOSED
        for (let counter = 0; counter < 4; counter++) {
            url = '/proxy-timeout-circuit-breaker/mocks/items/public-' + crypto.randomUUID()
            response = await server.inject({
                method: 'GET',
                url: url
            })
            t.assert.strictEqual(200, response.statusCode)
        }
    })

    after(async () => {
        await server.close()
    })

})
