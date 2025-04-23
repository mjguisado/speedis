import { suite, test, before, after } from 'node:test'
import { app } from './app.js'
import crypto from 'crypto'


suite('Speedis', async () => {

    let fastifyServer

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    before(async () => {
        fastifyServer = await app({
            logger: { level: 'warn' }
        })
    })

    suite('Speedis - GET', () => {

        test('DELETE 404', async (t) => {
            t.plan(1)
            let url = '/mocks/mocks/items/test-' + crypto.randomUUID()
            let response = await fastifyServer.inject({
                method: 'DELETE',
                url: url.replace('/mocks/mocks/','/mocks/purge/mocks/')
            })
            t.assert.strictEqual(response.statusCode, 404)
        })
       
        test('DELETE 204', async (t) => {
            t.plan(2)
            let url = '/mocks/mocks/items/test-' + crypto.randomUUID()

            url += '?cc=' + encodeURIComponent('public,max-age=60')
            let response = await fastifyServer.inject({
                method: 'GET',
                url: url
            })
            t.assert.strictEqual(response.statusCode, 200)
            response = await fastifyServer.inject({
                method: 'DELETE',
                url: url.replace('/mocks/mocks/','/mocks/purge/mocks/')
            })
            t.assert.strictEqual(response.statusCode, 204)
        })

        test('GET - REQUEST max-age', async (t) => {
            t.plan(18)

            let clientmaxage = 2
            let originmaxage = clientmaxage * 2

            let url = '/mocks/mocks/items/test-' + crypto.randomUUID()
            url += '?cc=' + encodeURIComponent(`public,max-age=${originmaxage}`)
            let response = await fastifyServer.inject({
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

            response = await fastifyServer.inject({
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

            await sleep((clientmaxage + 1)  * 1000)

            response = await fastifyServer.inject({
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

            response = await fastifyServer.inject({
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

            let url = '/mocks/mocks/items/test-' + crypto.randomUUID()
            url += '?cc=' + encodeURIComponent(`public,max-age=${originmaxage}`)
            let response = await fastifyServer.inject({
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

            response = await fastifyServer.inject({
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

            await sleep((clientminfresh + 1)  * 1000)

            response = await fastifyServer.inject({
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

            response = await fastifyServer.inject({
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

            let url = '/mocks/mocks/items/test-' + crypto.randomUUID()
            url += '?cc=' + encodeURIComponent(`public,max-age=${originmaxage}`)
            let response = await fastifyServer.inject({
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

            response = await fastifyServer.inject({
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
            
            await sleep((originmaxage + 1)  * 1000)

            response = await fastifyServer.inject({
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

            await sleep((originmaxage + 1)  * 1000)

            response = await fastifyServer.inject({
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

            response = await fastifyServer.inject({
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

            let url = '/mocks/mocks/items/test-' + crypto.randomUUID()
            url += '?cc=' + encodeURIComponent(`public,max-age=${originmaxage}`)
            let response = await fastifyServer.inject({
                method: 'GET',
                url: url,
            })
            t.assert.strictEqual(response.statusCode, 200)
            t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-speedis-cache-status'))
            t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)     
            t.assert.ok(!Object.prototype.hasOwnProperty.call(response.headers, 'age'))

            response = await fastifyServer.inject({
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

            response = await fastifyServer.inject({
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

            let url = '/mocks/mocks/items/test-' + crypto.randomUUID()
            url += '?cc=' + encodeURIComponent(`public,max-age=${originmaxage}`)
            let response = await fastifyServer.inject({
                method: 'GET',
                url: url,
            })
            t.assert.strictEqual(response.statusCode, 200)
            t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-speedis-cache-status'))
            t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)     
            t.assert.ok(!Object.prototype.hasOwnProperty.call(response.headers, 'age'))

            await sleep((originmaxage + 1)  * 1000)

            response = await fastifyServer.inject({
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

            let url = '/mocks/mocks/items/test-' + crypto.randomUUID()
            url += '?cc=' + encodeURIComponent(`public,max-age=${originmaxage},no-cache`)
            let response = await fastifyServer.inject({
                method: 'GET',
                url: url,
            })
            t.assert.strictEqual(response.statusCode, 200)
            t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-speedis-cache-status'))
            t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)     
            t.assert.ok(!Object.prototype.hasOwnProperty.call(response.headers, 'age'))

            response = await fastifyServer.inject({
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

            let url = '/mocks/mocks/items/test-' + crypto.randomUUID()
            url += '?cc=' + encodeURIComponent(`public,max-age=${originmaxage},private`)
            let response = await fastifyServer.inject({
                method: 'GET',
                url: url,
            })
            t.assert.strictEqual(response.statusCode, 200)
            t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-speedis-cache-status'))
            t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)     
            t.assert.ok(!Object.prototype.hasOwnProperty.call(response.headers, 'age'))

            response = await fastifyServer.inject({
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

            let url = '/mocks/mocks/items/test-' + crypto.randomUUID()
            url += '?cc=' + encodeURIComponent(`public,max-age=${originmaxage},private="x-mocks-custom-header-1,x-mocks-custom-header-2"`)
            let response = await fastifyServer.inject({
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

            response = await fastifyServer.inject({
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

            let url = '/mocks/mocks/items/test-' + crypto.randomUUID()
            url += '?cc=' + encodeURIComponent(`public,max-age=${originmaxage},no-cache="x-mocks-custom-header-1,x-mocks-custom-header-2"`)
            let response = await fastifyServer.inject({
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

            response = await fastifyServer.inject({
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
            let url = '/mocks/mocks/items/test-' + uuid 
            url += '?cc=' + encodeURIComponent(`public,max-age=${originmaxage}`)
            let response = await fastifyServer.inject({
                method: 'GET',
                url: url,
                headers: {
                    'if-none-match': 'W/"' + crypto.randomUUID() + `", W/"test-${uuid}"`
                }
            })
            t.assert.strictEqual(response.statusCode, 304)
        })

        /*
        test('GET Sequence - CACHE_HIT_REVALIDATED', async (t) => {
            t.plan(13)

            let maxage = 3

            let url = '/mocks/mocks/items/test-' + crypto.randomUUID()
            url += '?cc=' + encodeURIComponent(`public,max-age=${maxage}`)
            let response = await fastifyServer.inject({
                method: 'GET',
                url: url
            })
            t.assert.strictEqual(response.statusCode, 200)
            t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-speedis-cache-status'))
            t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_MISS/)           

            response = await fastifyServer.inject({
                method: 'GET',
                url: url
            })
            t.assert.strictEqual(response.statusCode, 200)
            t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-speedis-cache-status'))
            t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT/)           

            await sleep((maxage + 1)  * 1000)

            response = await fastifyServer.inject({
                method: 'GET',
                url: url
            })
            t.assert.strictEqual(response.statusCode, 200)
            t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-speedis-cache-status'))
            t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT_REVALIDATED/)           

            response = await fastifyServer.inject({
                method: 'GET',
                url: url
            })
            t.assert.strictEqual(response.statusCode, 200)
            t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-speedis-cache-status'))
            t.assert.match(response.headers['x-speedis-cache-status'], /^CACHE_HIT/)

            response = await fastifyServer.inject({
                method: 'DELETE',
                url: url
            })
           
        })
        */

    })

    after(async () => {
        await fastifyServer.close()
    })

})
