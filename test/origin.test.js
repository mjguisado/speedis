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
                "origin": {
                    "httpxOptions": {
                        "host": "mocks",
                        "port": 3030,
                        "timeout": 1000
                    }
                }
            }
        )
        plugins.set("proxy","/proxy")

        server.register(
            speedisPlugin,
            {
                "id": "proxy-timeout",
                "prefix": "/proxy-timeout",
                "exposeErrors": true,
                "origin": {
                    "httpxOptions": {
                        "host": "mocks",
                        "port": 3030,
                        "timeout": 1000
                    },
                    "originTimeout": 1000
                }
            }
        )
        plugins.set("proxy-timeout","/proxy-timeout")

        server.register(
            speedisPlugin,
            {
                "id": "proxy-agent",
                "prefix": "/proxy-agent",
                "exposeErrors": true,
                "origin": {
                    "httpxOptions": {
                        "host": "mocks",
                        "port": 3030,
                        "timeout": 1000
                    },
                    "agentOptions": {
                        "keepAlive": true
                    }
                }
            }
        )
        plugins.set("proxy-agent","/proxy-agent")

        server.register(
            speedisPlugin,
            {
                "id": "proxy-agent-timeout",
                "prefix": "/proxy-agent-timeout",
                "exposeErrors": true,
                "origin": {
                    "httpxOptions": {
                        "host": "mocks",
                        "port": 3030,
                        "timeout": 1000
                    },
                    "agentOptions": {
                        "keepAlive": true
                    },
                    "originTimeout": 1000
                }
            }
        )
        plugins.set("proxy-agent-timeout","/proxy-agent-timeout")

        server.register(
            speedisPlugin,
            {
                "id": "proxy-agent-timeout-circuit-breaker",
                "prefix": "/proxy-agent-timeout-circuit-breaker",
                "exposeErrors": true,
                "origin": {
                    "httpxOptions": {
                        "host": "mocks",
                        "port": 3030,
                        "timeout": 1000
                    },
                    "agentOptions": {
                        "keepAlive": true
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
        plugins.set("proxy-agent-timeout-circuit-breaker","/proxy-agent-timeout-circuit-breaker")

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

    test('Proxy - Agent', async (t) => {
        t.plan(1)
        let url = '/proxy-agent/mocks/items/public-' + crypto.randomUUID()
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

    test('Proxy - Agent - Timeout', async (t) => {
        t.plan(2)
        let url = '/proxy-agent-timeout/mocks/items/public-' + crypto.randomUUID()
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

    test('Proxy - Agent - Timeout - Circuit Breaker - CLOSED', async (t) => {
        t.plan(11)
        let url, response
        for (let counter = 0; counter < 5; counter ++) {
            url = '/proxy-agent-timeout/mocks/items/public-' + crypto.randomUUID()
            response = await server.inject({
                method: 'GET',
                url: url
            })
            t.assert.strictEqual(200, response.statusCode)
        }
        url = '/proxy-agent-timeout/mocks/items/public-' + crypto.randomUUID() + '?delay=2500'
        response = await server.inject({
            method: 'GET',
            url: url + '?delay=1200'
        })
        t.assert.strictEqual(504, response.statusCode)
        for (let counter = 0; counter < 5; counter ++) {
            url = '/proxy-agent-timeout/mocks/items/public-' + crypto.randomUUID()
            response = await server.inject({
                method: 'GET',
                url: url
            })
            t.assert.strictEqual(200, response.statusCode)
        }        
    })

    test('Proxy - Agent - Timeout - Circuit Breaker - OPEN', async (t) => {
        t.plan(12)
        let url, response
        // CB CLOSED => 200
        for (let counter = 0; counter < 4; counter ++) {
            url = '/proxy-agent-timeout-circuit-breaker/mocks/items/public-' + crypto.randomUUID()
            response = await server.inject({
                method: 'GET',
                url: url
            })
            t.assert.strictEqual(200, response.statusCode)
        }
        // (2x504) / (3x200) > 25% => CB OPENED
        for (let counter = 0; counter < 2; counter ++) {
            url = '/proxy-agent-timeout-circuit-breaker/mocks/items/public-' + crypto.randomUUID() + '?delay=2500'
            response = await server.inject({
                method: 'GET',
                url: url + '?delay=1200'
            })
            t.assert.strictEqual(504, response.statusCode)
        }
        // CB OPENED => 500
        for (let counter = 0; counter < 2; counter ++) {
            url = '/proxy-agent-timeout-circuit-breaker/mocks/items/public-' + crypto.randomUUID()
            response = await server.inject({
                method: 'GET',
                url: url
            })
            t.assert.strictEqual(500, response.statusCode)
        }
        // Wait to HALF OPENED
        await new Promise((resolve) => setTimeout(resolve, 2000))
        // CB HALF CLOSED and then CB CLOSED
        for (let counter = 0; counter < 4; counter ++) {
            url = '/proxy-agent-timeout-circuit-breaker/mocks/items/public-' + crypto.randomUUID()
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
