import { suite, test, before, after } from 'node:test'
import { app } from './app.js'

suite('Speedis', async () => {

    let fastifyServer

    before(async () => {
        fastifyServer = await app({
            logger: { level: 'info' }
        })
    })

    suite('Speedis - GET', () => {

        test('GET 200 TCP_MISS', async (t) => {
            t.plan(3)
            let response = await fastifyServer.inject({
                method: 'DELETE',
                url: '/mocks/mocks/items'
            })
            response = await fastifyServer.inject({
                method: 'GET',
                url: '/mocks/mocks/items'
            })
            t.assert.strictEqual(response.statusCode, 200, 'GET returns a status code of 200')
            t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-speedis-cache'))
            t.assert.match(response.headers['x-speedis-cache'],/^TCP_MISS/)
        })

        test('GET 200 TCP_FF_MISS', async (t) => {
            t.plan(3)
            const response = await fastifyServer.inject({
                method: 'GET',
                headers: {
                    'x-speedis-force-fetch': true
                },
                url: '/mocks/mocks/items'
            })
            t.assert.strictEqual(response.statusCode, 200, 'GET returns a status code of 200')
            t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-speedis-cache'))
            t.assert.match(response.headers['x-speedis-cache'],/^TCP_FF_MISS/)
        })

        test('GET 200 TCP_FF_MISS', async (t) => {
            t.plan(3)
            const response = await fastifyServer.inject({
                method: 'GET',
                headers: {
                    'x-speedis-preview': true
                },
                url: '/mocks/mocks/items'
            })
            t.assert.strictEqual(response.statusCode, 200, 'GET returns a status code of 200')
            t.assert.ok(Object.prototype.hasOwnProperty.call(response.headers, 'x-speedis-cache'))
            t.assert.match(response.headers['x-speedis-cache'],/^TCP_PV_MISS/)
        })

    })

    after(async () => {
        await fastifyServer.close()
    })

})
