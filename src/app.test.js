import { suite, test, before, after } from 'node:test'
import { app } from './app.js'
import crypto from 'crypto'


suite('Speedis', async () => {

    let fastifyServer

    before(async () => {
        fastifyServer = await app({
            logger: { level: 'info' }
        })
    })

    suite('Speedis - GET', () => {

        test('DELETE 404', async (t) => {
            t.plan(1)
            let url = '/mocks/mocks/items/' + crypto.randomUUID()
            let response = await fastifyServer.inject({
                method: 'DELETE',
                url: url
            })
            t.assert.strictEqual(response.statusCode, 404)
        })

        test('DELETE 204', async (t) => {
            t.plan(2)
            let url = '/mocks/mocks/items/' + crypto.randomUUID()
            url += '?cc=' + encodeURIComponent('public,max-age=60')
            let response = await fastifyServer.inject({
                method: 'GET',
                url: url
            })
            t.assert.strictEqual(response.statusCode, 200)
            response = await fastifyServer.inject({
                method: 'DELETE',
                url: url
            })
            t.assert.strictEqual(response.statusCode, 204)
        })

        test('GET 200', async (t) => {
            t.plan(2)
            let url = '/mocks/mocks/items/' + crypto.randomUUID()
            // url += '?cc=' + encodeURIComponent('public,max-age=60')
            let response = await fastifyServer.inject({
                method: 'GET',
                url: url
            })
            t.assert.strictEqual(response.statusCode, 200)
            response = await fastifyServer.inject({
                method: 'DELETE',
                url: url
            })
            t.assert.strictEqual(response.statusCode, 404)
        })

/*

        test('GET 200 TCP_MISS', async (t) => {
            t.plan(3)
            const url = '/mocks/mocks/items'
            let response = await fastifyServer.inject({
                method: 'DELETE',
                url: url
            })
            response = await fastifyServer.inject({
                method: 'GET',
                url: url
            })
            t.assert.strictEqual(response.statusCode, 200)
            t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-speedis-cache'))
            t.assert.match(response.headers['x-speedis-cache'], /^TCP_MISS/)
        })

        test('GET 200 TCP_HIT', async (t) => {
            t.plan(10)
            const url = '/mocks/mocks/items?s-maxage=30&max-age=10'
            const deleteResponse = await fastifyServer.inject({
                method: 'DELETE',
                url: url
            })
            const  firstResponse = await fastifyServer.inject({
                method: 'GET',
                url: url
            })
            const secondResponse = await fastifyServer.inject({
                method: 'GET',
                url: url
            })
            t.assert.strictEqual( firstResponse.statusCode, 200)
            t.assert.strictEqual(secondResponse.statusCode, 200)
            t.assert.ok(Object.prototype.hasOwnProperty.call( firstResponse.headers, 'date'))
            t.assert.ok(Object.prototype.hasOwnProperty.call(secondResponse.headers, 'date'))
            t.assert.strictEqual(firstResponse.headers['date'], secondResponse.headers['date'])
            t.assert.ok(Date.now() - Date.parse(secondResponse.headers['date']) < 60 * 1000)
            t.assert.ok(Object.prototype.hasOwnProperty.call(secondResponse.headers, 'age'))
            t.assert.ok(secondResponse.headers['age'] < 60)
            t.assert.ok(Object.prototype.hasOwnProperty.call(secondResponse.headers, 'x-speedis-cache'))
            t.assert.match(secondResponse.headers['x-speedis-cache'], /^TCP_HIT/)
        })

        // test('GET 304 TCP_MEM_HIT ETAG', async (t) => {})
        // test('GET 304 TCP_MEM_HIT LAST-MODIFIED', async (t) => {})

        test('GET 200 TCP_FF_MISS', async (t) => {
            t.plan(4)
            const url = '/mocks/mocks/items'
            let deleteResponse = await fastifyServer.inject({
                method: 'DELETE',
                url: url
            })
            const getResponse = await fastifyServer.inject({
                method: 'GET',
                headers: {
                    'x-speedis-force-fetch': true
                },
                url: url
            })
            deleteResponse = await fastifyServer.inject({
                method: 'DELETE',
                url: url
            })
            t.assert.strictEqual(getResponse.statusCode, 200)
            t.assert.ok(Object.prototype.hasOwnProperty.call(getResponse.headers, 'x-speedis-cache'))
            t.assert.match(getResponse.headers['x-speedis-cache'], /^TCP_FF_MISS/)
            t.assert.strictEqual(deleteResponse.statusCode, 204)
        })

        test('GET 200 TCP_PV_MISS', async (t) => {
            t.plan(3)
            const response = await fastifyServer.inject({
                method: 'GET',
                headers: {
                    'x-speedis-preview': true
                },
                url: '/mocks/mocks/items'
            })
            t.assert.strictEqual(response.statusCode, 200)
            t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-speedis-cache'))
            t.assert.match(response.headers['x-speedis-cache'], /^TCP_PV_MISS/)
        })

        // The no-store response directive indicates that any caches of any 
        // kind (private or shared) should not store this response.
        test('GET 200 NO-STORE', async (t) => {
            t.plan(6)
            const url = '/mocks/mocks/no-store'
            let deleteResponse = await fastifyServer.inject({
                method: 'DELETE',
                url: url
            })
            const getResponse = await fastifyServer.inject({
                method: 'GET',
                url: url
            })
            deleteResponse = await fastifyServer.inject({
                method: 'DELETE',
                url: url
            })
            t.assert.strictEqual(getResponse.statusCode, 200)
            t.assert.ok(Object.prototype.hasOwnProperty.call(getResponse.headers, 'cache-control'))
            t.assert.match(getResponse.headers['cache-control'], /no-store/)
            t.assert.ok(Object.prototype.hasOwnProperty.call(getResponse.headers, 'x-speedis-cache'))
            t.assert.match(getResponse.headers['x-speedis-cache'], /^TCP_MISS/)
            t.assert.strictEqual(deleteResponse.statusCode, 404)
        })

        // The private response directive indicates that the response can be 
        // stored only in a private cache (e.g. local caches in browsers).
        test('GET 200 PRIVATE', async (t) => {
            t.plan(6)
            const url = '/mocks/mocks/private'
            let deleteResponse = await fastifyServer.inject({
                method: 'DELETE',
                url: url
            })
            const getResponse = await fastifyServer.inject({
                method: 'GET',
                url: url
            })
            deleteResponse = await fastifyServer.inject({
                method: 'DELETE',
                url: url
            })
            t.assert.strictEqual(getResponse.statusCode, 200)
            t.assert.ok(Object.prototype.hasOwnProperty.call(getResponse.headers, 'cache-control'))
            t.assert.match(getResponse.headers['cache-control'], /private/)
            t.assert.ok(Object.prototype.hasOwnProperty.call(getResponse.headers, 'x-speedis-cache'))
            t.assert.match(getResponse.headers['x-speedis-cache'], /^TCP_MISS/)
            t.assert.strictEqual(deleteResponse.statusCode, 404)
        })
    */

    })

    after(async () => {
        await fastifyServer.close()
    })

})
