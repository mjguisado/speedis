import { suite, test, before, after } from 'node:test'
import { build } from './app.js'
import path from 'path'

suite('GET Method', () => {

    let fastifyServer
    let mocksServer

    before(async () => {
        fastifyServer = await build({
            logger: { level: 'info' }
        })
    })

    test('Miss', async (t) => {
        t.plan(1)
        const response = await fastifyServer.inject({
            method: 'GET',
            url: '/restful-api/users'
        })
        t.assert.strictEqual(response.statusCode, 200, 'returns a status code of 200')
    })

    after(async () => {
    })

})