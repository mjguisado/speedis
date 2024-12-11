import { suite, test, before, after } from 'node:test'
import { build } from './app.js'

suite('GET Method', () => {

    let fastifyServer

    before(async () => {
        fastifyServer = await build({
            logger: { level: 'info' }
        })
    })

    test('Miss', async (t) => {
        t.plan(1)
        const response = await fastifyServer.inject({
            method: 'GET',
            url: '/restful-api/objects?id=3&id=5&id=10'
        })
        t.assert.strictEqual(response.statusCode, 200, 'returns a status code of 200')
    })

    test('404', async (t) => {
        t.plan(1)
        const response = await fastifyServer.inject({
            method: 'GET',
            url: '/restful-api/objects/100'
        })
        t.assert.strictEqual(response.statusCode, 404, 'returns a status code of 404')
    })

    after(async () => {
        await fastifyServer.close()
    })

})