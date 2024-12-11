import { suite, test, before, after } from 'node:test'
import { build as app } from './app.js'
import mocksPlugin from './plugins/mocks.js'

suite('GET Method', () => {

    let fastifyServer
    before(async () => {
        fastifyServer = await app({
            logger: { level: 'warn' }
        })
        await fastifyServer.register(mocksPlugin, {
            id: "mocks",
            prefix: "/mocks",
            logLevel: "warn"
        })
    })

    test('GET', async (t) => {
        t.plan(1)
        const response = await fastifyServer.inject({
            method: 'GET',
            url: 'mocks/items'
        })
        t.assert.strictEqual(response.statusCode, 200, 'returns a status code of 200')
    })

    test('404 Not Found', async (t) => {
        t.plan(1)
        const response = await fastifyServer.inject({
            method: 'GET',
            url: 'mocks/notfound'
        })
        t.assert.strictEqual(response.statusCode, 404, 'returns a status code of 404')
    })

    after(async () => {
        await fastifyServer.close()
    })

})