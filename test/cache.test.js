import { suite, test, before, after } from 'node:test'
import fastify from 'fastify'
import speedisPlugin from '../src/plugins/speedis.js'
import crypto from 'crypto'
import Ajv from "ajv"
import { initOriginConfigValidator } from '../src/modules/originConfigValidator.js'

suite('Speedis - Origin', () => {

    let server

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    before(async () => {

        server = fastify({
            logger: { level: 'info' }
        })

        const ajv = new Ajv({ useDefaults: true })
        const originConfigValidator = initOriginConfigValidator(ajv)
        const origin = {
            "id": "mocks",
            "prefix": "/mocks",
            "origin": {
                "httpxOptions": {
                    "host": "mocks",
                    "port": 3030,
                    "timeout": 2000
                }
            },
            "cache": {
                "cacheables": [
                    {
                        "urlPattern": "/mocks/items/public-.*"
                    },
                    {
                        "urlPattern": "/mocks/items/.*",
                        "perUser": true
                    }
                ],
                "ignoredQueryParams": [
                    "cc",
                    "delay"
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

        await server.ready()

    })

    test('DELETE 404', async (t) => {
        t.plan(1)
        let url = '/mocks/mocks/items/public-' + crypto.randomUUID()
        let response = await server.inject({
            method: 'DELETE',
            url: url.replace('/mocks/mocks/', '/mocks/purge/mocks/')
        })
        t.assert.strictEqual(response.statusCode, 404)
    })

    test('DELETE 204', async (t) => {
        t.plan(2)
        let url = '/mocks/mocks/items/public-' + crypto.randomUUID()

        url += '?cc=' + encodeURIComponent('public,max-age=60')
        let response = await server.inject({
            method: 'GET',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)
        response = await server.inject({
            method: 'DELETE',
            url: url.replace('/mocks/mocks/', '/mocks/purge/mocks/')
        })
        t.assert.strictEqual(response.statusCode, 204)
    })

    test('GET - REQUEST max-age', async (t) => {
        t.plan(18)

        let clientmaxage = 2
        let originmaxage = clientmaxage * 2

        let url = '/mocks/mocks/items/public-' + crypto.randomUUID()
        url += '?cc=' + encodeURIComponent(`public,max-age=${originmaxage}`)
        let response = await server.inject({
            method: 'GET',
            url: url,
            headers: {
                'cache-control': `max-age=${clientmaxage}`
            }
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-speedis-cache-status'))
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)
        t.assert.ok(!Object.prototype.hasOwnProperty.call(response.headers, 'age'))

        response = await server.inject({
            method: 'GET',
            url: url,
            headers: {
                'cache-control': `max-age=${clientmaxage}`
            }
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-speedis-cache-status'))
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT/)
        t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'age'))
        t.assert.ok(Number.parseInt(response.headers['age']) <= clientmaxage)

        await sleep((clientmaxage + 1) * 1000)

        response = await server.inject({
            method: 'GET',
            url: url,
            headers: {
                'cache-control': `max-age=${clientmaxage}`
            }
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-speedis-cache-status'))
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT_REVALIDATED/)
        t.assert.ok(!Object.prototype.hasOwnProperty.call(response.headers, 'age'))

        response = await server.inject({
            method: 'GET',
            url: url,
            headers: {
                'cache-control': `max-age=${clientmaxage}`
            }
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-speedis-cache-status'))
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT/)
        t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'age'))
        t.assert.ok(Number.parseInt(response.headers['age']) <= clientmaxage)

    })

    test('GET - REQUEST min-fresh', async (t) => {
        t.plan(18)

        let clientminfresh = 2
        let originmaxage = clientminfresh * 2

        let url = '/mocks/mocks/items/public-' + crypto.randomUUID()
        url += '?cc=' + encodeURIComponent(`public,max-age=${originmaxage}`)
        let response = await server.inject({
            method: 'GET',
            url: url,
            headers: {
                'cache-control': `min-fresh=${clientminfresh}`
            }
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-speedis-cache-status'))
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)
        t.assert.ok(!Object.prototype.hasOwnProperty.call(response.headers, 'age'))

        response = await server.inject({
            method: 'GET',
            url: url,
            headers: {
                'cache-control': `min-fresh=${clientminfresh}`
            }
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-speedis-cache-status'))
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT/)
        t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'age'))
        t.assert.ok(Number.parseInt(originmaxage - response.headers['age']) >= clientminfresh)

        await sleep((clientminfresh + 1) * 1000)

        response = await server.inject({
            method: 'GET',
            url: url,
            headers: {
                'cache-control': `min-fresh=${clientminfresh}`
            }
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-speedis-cache-status'))
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT_REVALIDATED/)
        t.assert.ok(!Object.prototype.hasOwnProperty.call(response.headers, 'age'))

        response = await server.inject({
            method: 'GET',
            url: url,
            headers: {
                'cache-control': `min-fresh=${clientminfresh}`
            }
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-speedis-cache-status'))
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT/)
        t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'age'))
        t.assert.ok(Number.parseInt(originmaxage - response.headers['age']) >= clientminfresh)

    })

    test('GET - REQUEST max-stale', async (t) => {
        t.plan(24)

        let clientmaxstale = 2
        let originmaxage = clientmaxstale

        let url = '/mocks/mocks/items/public-' + crypto.randomUUID()
        url += '?cc=' + encodeURIComponent(`public,max-age=${originmaxage}`)
        let response = await server.inject({
            method: 'GET',
            url: url,
            headers: {
                'cache-control': `max-stale=${clientmaxstale}`
            }
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-speedis-cache-status'))
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)
        t.assert.ok(!Object.prototype.hasOwnProperty.call(response.headers, 'age'))

        response = await server.inject({
            method: 'GET',
            url: url,
            headers: {
                'cache-control': `max-stale=${clientmaxstale}`
            }
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-speedis-cache-status'))
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT/)
        t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'age'))
        t.assert.ok(Number.parseInt(response.headers['age']) <= originmaxage)

        await sleep((originmaxage + 1) * 1000)

        response = await server.inject({
            method: 'GET',
            url: url,
            headers: {
                'cache-control': `max-stale=${clientmaxstale}`
            }
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-speedis-cache-status'))
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT/)
        t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'age'))
        t.assert.ok(Number.parseInt(response.headers['age']) > originmaxage)
        t.assert.ok(Number.parseInt(response.headers['age']) <= originmaxage + clientmaxstale)

        await sleep((originmaxage + 1) * 1000)

        response = await server.inject({
            method: 'GET',
            url: url,
            headers: {
                'cache-control': `max-stale=${clientmaxstale}`
            }
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-speedis-cache-status'))
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT_REVALIDATED/)
        t.assert.ok(!Object.prototype.hasOwnProperty.call(response.headers, 'age'))

        response = await server.inject({
            method: 'GET',
            url: url,
            headers: {
                'cache-control': `max-stale=${clientmaxstale}`
            }
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-speedis-cache-status'))
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT/)
        t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'age'))
        t.assert.ok(Number.parseInt(response.headers['age']) <= originmaxage)

    })

    test('GET - REQUEST no-cache', async (t) => {
        t.plan(13)

        let originmaxage = 4

        let url = '/mocks/mocks/items/public-' + crypto.randomUUID()
        url += '?cc=' + encodeURIComponent(`public,max-age=${originmaxage}`)
        let response = await server.inject({
            method: 'GET',
            url: url,
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-speedis-cache-status'))
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)
        t.assert.ok(!Object.prototype.hasOwnProperty.call(response.headers, 'age'))

        response = await server.inject({
            method: 'GET',
            url: url,
            headers: {
                'cache-control': 'no-cache'
            }
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-speedis-cache-status'))
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT_REVALIDATED/)
        t.assert.ok(!Object.prototype.hasOwnProperty.call(response.headers, 'age'))

        response = await server.inject({
            method: 'GET',
            url: url,
            headers: {}
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-speedis-cache-status'))
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT/)
        t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'age'))
        t.assert.ok(Number.parseInt(response.headers['age']) <= originmaxage)

    })

    test('GET - RESPONSE is not Fresh', async (t) => {
        t.plan(8)

        let originmaxage = 2

        let url = '/mocks/mocks/items/public-' + crypto.randomUUID()
        url += '?cc=' + encodeURIComponent(`public,max-age=${originmaxage}`)
        let response = await server.inject({
            method: 'GET',
            url: url,
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-speedis-cache-status'))
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)
        t.assert.ok(!Object.prototype.hasOwnProperty.call(response.headers, 'age'))

        await sleep((originmaxage + 1) * 1000)

        response = await server.inject({
            method: 'GET',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-speedis-cache-status'))
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT_REVALIDATED/)
        t.assert.ok(!Object.prototype.hasOwnProperty.call(response.headers, 'age'))

    })

    test('GET - RESPONSE unqualified no-cache', async (t) => {
        t.plan(8)

        let originmaxage = 4

        let url = '/mocks/mocks/items/public-' + crypto.randomUUID()
        url += '?cc=' + encodeURIComponent(`public,max-age=${originmaxage},no-cache`)
        let response = await server.inject({
            method: 'GET',
            url: url,
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-speedis-cache-status'))
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)
        t.assert.ok(!Object.prototype.hasOwnProperty.call(response.headers, 'age'))

        response = await server.inject({
            method: 'GET',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-speedis-cache-status'))
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT_REVALIDATED/)
        t.assert.ok(!Object.prototype.hasOwnProperty.call(response.headers, 'age'))

    })

    test('GET - RESPONSE unqualified private', async (t) => {
        t.plan(8)

        let originmaxage = 4

        let url = '/mocks/mocks/items/public-' + crypto.randomUUID()
        url += '?cc=' + encodeURIComponent(`public,max-age=${originmaxage},private`)
        let response = await server.inject({
            method: 'GET',
            url: url,
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-speedis-cache-status'))
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)
        t.assert.ok(!Object.prototype.hasOwnProperty.call(response.headers, 'age'))

        response = await server.inject({
            method: 'GET',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-speedis-cache-status'))
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)
        t.assert.ok(!Object.prototype.hasOwnProperty.call(response.headers, 'age'))

    })

    test('GET - RESPONSE qualified private', async (t) => {
        t.plan(15)

        let originmaxage = 4

        let url = '/mocks/mocks/items/public-' + crypto.randomUUID()
        url += '?cc=' + encodeURIComponent(`public,max-age=${originmaxage},private="x-mocks-custom-header-1,x-mocks-custom-header-2"`)
        let response = await server.inject({
            method: 'GET',
            url: url,
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-speedis-cache-status'))
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)
        t.assert.ok(!Object.prototype.hasOwnProperty.call(response.headers, 'age'))
        t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-mocks-custom-header-1'))
        t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-mocks-custom-header-2'))
        t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-mocks-custom-header-3'))

        response = await server.inject({
            method: 'GET',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-speedis-cache-status'))
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT/)
        t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'age'))
        t.assert.ok(Number.parseInt(response.headers['age']) <= originmaxage)
        t.assert.ok(!Object.prototype.hasOwnProperty.call(response.headers, 'x-mocks-custom-header-1'))
        t.assert.ok(!Object.prototype.hasOwnProperty.call(response.headers, 'x-mocks-custom-header-2'))
        t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-mocks-custom-header-3'))

    })

    test('GET - RESPONSE qualified no-cache', async (t) => {
        t.plan(15)

        let originmaxage = 4

        let url = '/mocks/mocks/items/public-' + crypto.randomUUID()
        url += '?cc=' + encodeURIComponent(`public,max-age=${originmaxage},no-cache="x-mocks-custom-header-1,x-mocks-custom-header-2"`)
        let response = await server.inject({
            method: 'GET',
            url: url,
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-speedis-cache-status'))
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)
        t.assert.ok(!Object.prototype.hasOwnProperty.call(response.headers, 'age'))
        t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-mocks-custom-header-1'))
        t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-mocks-custom-header-2'))
        t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-mocks-custom-header-3'))

        response = await server.inject({
            method: 'GET',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-speedis-cache-status'))
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT/)
        t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'age'))
        t.assert.ok(Number.parseInt(response.headers['age']) <= originmaxage)
        t.assert.ok(!Object.prototype.hasOwnProperty.call(response.headers, 'x-mocks-custom-header-1'))
        t.assert.ok(!Object.prototype.hasOwnProperty.call(response.headers, 'x-mocks-custom-header-2'))
        t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-mocks-custom-header-3'))

    })

    test('GET - RESPONSE Not Modified', async (t) => {
        t.plan(1)
        let originmaxage = 4
        const uuid = crypto.randomUUID()
        let url = '/mocks/mocks/items/public-' + uuid
        url += '?cc=' + encodeURIComponent(`public,max-age=${originmaxage}`)
        let response = await server.inject({
            method: 'GET',
            url: url,
            headers: {
                'if-none-match': 'W/"' + crypto.randomUUID() + `", W/"public-${uuid}"`
            }
        })
        t.assert.strictEqual(response.statusCode, 304)
    })

    after(async () => {
        await server.close()
    })

})
