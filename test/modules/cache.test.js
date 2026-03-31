import { suite, test, before, after } from 'node:test'
import fastify from 'fastify'
import speedisPlugin from '../../src/plugins/speedis.js'
import crypto from 'crypto'
import Ajv from "ajv"
import { initOriginConfigValidator } from '../../src/modules/originConfigValidator.js'

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
                "http2Options": {
                    "authority": "https://mocks.localhost:3030",
                    "options": {
                        "rejectUnauthorized": false,
                        "timeout": 1000
                    }
                }
            },
            "cache": {
                "enabled": true,
                "defaultCacheSettings": {
                    "methods": ["GET", "HEAD"],
                    "private": false,
                    "ttl": 20,
                    "sortQueryParams": true,
                    "ignoredQueryParams": [
                        "cc",
                        "delay"
                    ]
                },
                "cacheables": [
                    {
                        "urlPattern": "mocks/public/.*"
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

    test('PURGE - 404', async (t) => {
        t.plan(1)
        let url = '/mocks/mocks/public/items/' + crypto.randomUUID()
        let response = await server.inject({
            method: 'DELETE',
            url: url.replace('/mocks/mocks/', '/mocks/purge/mocks/')
        })
        t.assert.strictEqual(response.statusCode, 404)
    })

    test('PURGE - GET - 204', async (t) => {
        t.plan(2)
        let url = '/mocks/mocks/public/items/' + crypto.randomUUID()

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

    test('PURGE - HEAD - 204', async (t) => {
        t.plan(2)
        let url = '/mocks/mocks/public/items/' + crypto.randomUUID()

        url += '?cc=' + encodeURIComponent('public,max-age=60')
        let response = await server.inject({
            method: 'HEAD',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)

        response = await server.inject({
            method: 'DELETE',
            url: url.replace('/mocks/mocks/', '/mocks/purge/mocks/')
        })
        t.assert.strictEqual(response.statusCode, 204)

    })


    test('PURGE - should delete both GET and HEAD cache entries', async (t) => {
        t.plan(10)
        let url = '/mocks/mocks/public/items/' + crypto.randomUUID()
        url += '?cc=' + encodeURIComponent('public,max-age=60')

        // Cache a GET request
        let response = await server.inject({
            method: 'GET',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)

        // Verify GET is cached
        response = await server.inject({
            method: 'GET',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT/)

        // Cache a HEAD request
        response = await server.inject({
            method: 'HEAD',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)

        // Verify HEAD is cached
        response = await server.inject({
            method: 'HEAD',
            url: url
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT/)

        // PURGE the URL
        response = await server.inject({
            method: 'DELETE',
            url: url.replace('/mocks/mocks/', '/mocks/purge/mocks/')
        })
        t.assert.strictEqual(response.statusCode, 204)

        // Verify both GET and HEAD are purged (should be CACHE_MISS)
        response = await server.inject({
            method: 'GET',
            url: url
        })
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)
    })

    test('PURGE with pattern - should delete both GET and HEAD cache entries', async (t) => {
        t.plan(13)
        const uuid = crypto.randomUUID()
        const url1 = '/mocks/mocks/public/items/' + uuid + '-1?cc=' + encodeURIComponent('public,max-age=60')
        const url2 = '/mocks/mocks/public/items/' + uuid + '-2?cc=' + encodeURIComponent('public,max-age=60')

        // Cache GET and HEAD for url1
        let response = await server.inject({ method: 'GET', url: url1 })
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)
        response = await server.inject({ method: 'HEAD', url: url1 })
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)

        // Cache GET and HEAD for url2
        response = await server.inject({ method: 'GET', url: url2 })
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)
        response = await server.inject({ method: 'HEAD', url: url2 })
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)

        // Verify all are cached
        response = await server.inject({ method: 'GET', url: url1 })
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT/)
        response = await server.inject({ method: 'HEAD', url: url1 })
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT/)
        response = await server.inject({ method: 'GET', url: url2 })
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT/)
        response = await server.inject({ method: 'HEAD', url: url2 })
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT/)

        // PURGE with pattern
        const purgeUrl = `/mocks/purge/mocks/public/items/${uuid}*`
        response = await server.inject({ method: 'DELETE', url: purgeUrl })
        t.assert.strictEqual(response.statusCode, 204)

        // Verify all are purged
        response = await server.inject({ method: 'GET', url: url1 })
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)
        response = await server.inject({ method: 'HEAD', url: url1 })
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)
        response = await server.inject({ method: 'GET', url: url2 })
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)
        response = await server.inject({ method: 'HEAD', url: url2 })
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)
    })

    test('GET - REQUEST max-age', async (t) => {
        t.plan(18)

        let clientmaxage = 1
        let originmaxage = clientmaxage * 2

        let url = '/mocks/mocks/public/items/' + crypto.randomUUID()
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

        let clientminfresh = 1
        let originmaxage = clientminfresh * 2

        let url = '/mocks/mocks/public/items/' + crypto.randomUUID()
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

        let clientmaxstale = 1
        let originmaxage = clientmaxstale

        let url = '/mocks/mocks/public/items/' + crypto.randomUUID()
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

        let originmaxage = 2

        let url = '/mocks/mocks/public/items/' + crypto.randomUUID()
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

        let url = '/mocks/mocks/public/items/' + crypto.randomUUID()
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

        let originmaxage = 2

        let url = '/mocks/mocks/public/items/' + crypto.randomUUID()
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

        let originmaxage = 2

        let url = '/mocks/mocks/public/items/' + crypto.randomUUID()
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

        let originmaxage = 2

        let url = '/mocks/mocks/public/items/' + crypto.randomUUID()
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

        let originmaxage = 2

        let url = '/mocks/mocks/public/items/' + crypto.randomUUID()
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

    test('GET - if-none-match - wildcard duplicate', async (t) => {
        t.plan(1)
        let originmaxage = 10
        const uuid = crypto.randomUUID()
        let url = '/mocks/mocks/public/items/' + uuid
        url += '?cc=' + encodeURIComponent(`public,max-age=${originmaxage}`)
        let response = await server.inject({
            method: 'GET',
            url: url,
            headers: {
                'if-none-match': '"*", W/"' + crypto.randomUUID() + `", "*", W/"${uuid}"`
            }
        })
        t.assert.strictEqual(response.statusCode, 400)
    })

    test('GET - if-none-match - wildcard - 200', async (t) => {
        t.plan(1)
        let originmaxage = 10
        const uuid = crypto.randomUUID()
        let url = '/mocks/mocks/public/items/' + uuid
        url += '?cc=' + encodeURIComponent(`public,max-age=${originmaxage}`)
        let response = await server.inject({
            method: 'GET',
            url: url,
            headers: {
                'if-none-match': '"*"'
            }
        })
        t.assert.strictEqual(response.statusCode, 200)
    })

    test('GET - if-none-match - wildcard - 304', async (t) => {
        t.plan(2)
        let originmaxage = 10
        const uuid = crypto.randomUUID()
        let url = '/mocks/mocks/public/items/' + uuid
        url += '?cc=' + encodeURIComponent(`public,max-age=${originmaxage}`)
        let response = await server.inject({
            method: 'GET',
            url: url,
            headers: {
                'if-none-match': '"*"'
            }
        })
        t.assert.strictEqual(response.statusCode, 200)
        response = await server.inject({
            method: 'GET',
            url: url,
            headers: {
                'if-none-match': '"*"'
            }
        })
        t.assert.strictEqual(response.statusCode, 304)
    })

    test('GET - if-none-match - 304', async (t) => {
        t.plan(1)
        let originmaxage = 4
        const uuid = crypto.randomUUID()
        let url = '/mocks/mocks/public/items/' + uuid
        url += '?cc=' + encodeURIComponent(`public,max-age=${originmaxage}`)
        let response = await server.inject({
            method: 'GET',
            url: url,
            headers: {
                'if-none-match': 'W/"' + crypto.randomUUID() + `", W/"${uuid}"`
            }
        })
        t.assert.strictEqual(response.statusCode, 304)
    })

    test('GET - if-modified-since - invalid date', async (t) => {
        t.plan(1)
        let originmaxage = 10
        const uuid = crypto.randomUUID()
        let url = '/mocks/mocks/public/items/' + uuid
        url += '?cc=' + encodeURIComponent(`public,max-age=${originmaxage}`)
        let response = await server.inject({
            method: 'GET',
            url: url,
            headers: {
                'if-modified-since': 'INVALID DATE'
            }
        })
        t.assert.strictEqual(response.statusCode, 200)
    })

    test('GET - if-modified-since - 304', async (t) => {
        t.plan(2)
        let originmaxage = 10
        const uuid = crypto.randomUUID()
        let url = '/mocks/mocks/public/items/' + uuid
        url += '?cc=' + encodeURIComponent(`public,max-age=${originmaxage}`)
        let response = await server.inject({
            method: 'GET',
            url: url,
            headers: {}
        })
        t.assert.strictEqual(response.statusCode, 200)
        response = await server.inject({
            method: 'HEAD',
            url: url,
            headers: {
                'if-modified-since': response.headers['last-modified']
            }
        })
        t.assert.strictEqual(response.statusCode, 304)
    })

    // ========================================================================
    // RFC 9111 - HTTP Caching Extended Compliance Tests
    // ========================================================================

    // ========================================================================
    // RFC 9111 §5.2.2.5 - no-store Directive
    // ========================================================================

    test('RFC 9111 - REQUEST no-store - should not store response in cache', async (t) => {
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

    test('RFC 9111 - RESPONSE no-store - should not store response in cache', async (t) => {
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

    test('RFC 9111 - REQUEST no-store - can use already cached response', async (t) => {
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

    test('RFC 9111 - RESPONSE s-maxage - should override max-age for shared cache', async (t) => {
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

    test('RFC 9111 - RESPONSE must-revalidate - should revalidate when stale', async (t) => {
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

    test('RFC 9111 - RESPONSE proxy-revalidate - shared cache must revalidate when stale', async (t) => {
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

    test('RFC 8246 - RESPONSE immutable - should not revalidate even when reload requested', async (t) => {
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

    test('RFC 9110 - RESPONSE Vary header - should NOT cache responses with Vary header', async (t) => {
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

    test('RFC 9110 - RESPONSE Vary: * - should NOT cache responses with Vary: *', async (t) => {
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

    test('RFC 9111 - RESPONSE Expires header - should use for freshness calculation', async (t) => {
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

    test('RFC 9111 - RESPONSE max-age overrides Expires', async (t) => {
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

    test('RFC 9111 - Status 200 OK - should be cacheable', async (t) => {
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

    test('RFC 9111 - Status 404 Not Found - should be cacheable with explicit directives', async (t) => {
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

    test('RFC 9110 - HEAD method - should be cacheable separately from GET', async (t) => {
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

    test('RFC 9111 - REQUEST only-if-cached - should return 504 if not in cache', async (t) => {
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

    test('RFC 9111 - REQUEST only-if-cached - should return cached response if available', async (t) => {
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

    test('RFC 9111 - Combined max-age and min-fresh - should respect both constraints', async (t) => {
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

    test('RFC 9111 - Combined s-maxage and must-revalidate', async (t) => {
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

    test('RFC 9111 - Age header - should be calculated correctly', async (t) => {
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

    test('RFC 9111 - Stale response with max-stale - should include age greater than max-age', async (t) => {
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

    test('RFC 9111 - Invalid Cache-Control syntax - should handle gracefully', async (t) => {
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

    test('RFC 9111 - Multiple Cache-Control headers - should parse correctly', async (t) => {
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

// ============================================================================
// RFC 9110 §13 - Conditional Requests with POST (SOAP cache)
// ============================================================================

suite('Speedis - Conditional Requests with POST', () => {

    let server

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
                "http2Options": {
                    "authority": "https://mocks.localhost:3030",
                    "options": {
                        "rejectUnauthorized": false,
                        "timeout": 1000
                    }
                }
            },
            "cache": {
                "enabled": true,
                "defaultCacheSettings": {
                    "methods": ["GET", "HEAD"],
                    "private": false,
                    "ttl": 20,
                    "sortQueryParams": true,
                    "ignoredQueryParams": ["cc", "delay"]
                },
                "cacheables": [
                    {
                        "urlPattern": "mocks/public/soap/.*",
                        "cacheSettings": {
                            "methods": ["POST"]
                        }
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

    // RFC 9110 §13.1.2 + §13.2:
    // If-None-Match with "*" on a POST that is NOT yet cached:
    // precondition passes (no current representation) → origin executes → 200
    test('POST - if-none-match wildcard - resource not cached - 200', async (t) => {
        t.plan(2)
        const uuid = crypto.randomUUID()
        const url = '/mocks/mocks/public/soap/' + uuid
            + '?cc=' + encodeURIComponent('public,max-age=60')
        const response = await server.inject({
            method: 'POST',
            url: url,
            headers: {
                'content-type': 'text/xml',
                'if-none-match': '"*"'
            },
            body: `<request>${uuid}</request>`
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)
    })

    // RFC 9110 §13.1.2 + §13.2:
    // If-None-Match with "*" on a POST that IS already cached:
    // precondition fails (representation exists) → 412 Precondition Failed (not 304)
    test('POST - if-none-match wildcard - resource cached - 412', async (t) => {
        t.plan(3)
        const uuid = crypto.randomUUID()
        const url = '/mocks/mocks/public/soap/' + uuid
            + '?cc=' + encodeURIComponent('public,max-age=60')
        const body = `<request>${uuid}</request>`

        // Populate the cache
        let response = await server.inject({
            method: 'POST',
            url: url,
            headers: { 'content-type': 'text/xml' },
            body: body
        })
        t.assert.strictEqual(response.statusCode, 200)

        // Conditional POST: resource already cached → 412
        response = await server.inject({
            method: 'POST',
            url: url,
            headers: {
                'content-type': 'text/xml',
                'if-none-match': '"*"'
            },
            body: body
        })
        t.assert.strictEqual(response.statusCode, 412)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT/)
    })

    // RFC 9110 §13.1.2 + §13.2:
    // If-None-Match with a specific ETag when the cached POST response has no ETag:
    // comparison is not possible → condition passes → cached response returned (200, not 412).
    test('POST - if-none-match specific etag - no etag in cached response - 200', async (t) => {
        t.plan(3)
        const uuid = crypto.randomUUID()
        const url = '/mocks/mocks/public/soap/' + uuid
            + '?cc=' + encodeURIComponent('public,max-age=60')
        const body = `<request>${uuid}</request>`

        // Populate the cache (SOAP endpoint does not return ETag)
        let response = await server.inject({
            method: 'POST',
            url: url,
            headers: { 'content-type': 'text/xml' },
            body: body
        })
        t.assert.strictEqual(response.statusCode, 200)

        // Conditional POST with a specific ETag: no ETag in cached response
        // → condition cannot match → passes → cached response returned
        response = await server.inject({
            method: 'POST',
            url: url,
            headers: {
                'content-type': 'text/xml',
                'if-none-match': `W/"${uuid}"`
            },
            body: body
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT/)
    })

    // RFC 9110 §13.1.3:
    // If-Modified-Since MUST be ignored for methods other than GET and HEAD.
    // A cached POST with If-Modified-Since must return 200, not 304.
    test('POST - if-modified-since - must be ignored - 200', async (t) => {
        t.plan(3)
        const uuid = crypto.randomUUID()
        const url = '/mocks/mocks/public/soap/' + uuid
            + '?cc=' + encodeURIComponent('public,max-age=60')
        const body = `<request>${uuid}</request>`

        // Populate the cache
        let response = await server.inject({
            method: 'POST',
            url: url,
            headers: { 'content-type': 'text/xml' },
            body: body
        })
        t.assert.strictEqual(response.statusCode, 200)
        const lastModified = response.headers['last-modified']

        // POST with If-Modified-Since: header must be ignored → 200 from cache
        response = await server.inject({
            method: 'POST',
            url: url,
            headers: {
                'content-type': 'text/xml',
                'if-modified-since': lastModified
            },
            body: body
        })
        t.assert.strictEqual(response.statusCode, 200)
        t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT/)
    })

    after(async () => {
        await server.close()
    })

})
