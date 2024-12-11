import { suite, test, before, after } from 'node:test'
import { createServer } from '@mocks-server/main'
import { build } from './app.js'
import path from 'path'

suite('GET Method', () => {

    let fastifyServer
    let mocksServer

    before(async () => {

        mocksServer = createServer(
            {
                config: {
                    readFile: true,
                },
                files: {
                    enabled: true,
                },
                mock: {
                    collections: {
                      selected: "base"
                    }
                }
            }
        )
        await mocksServer.start();
        fastifyServer = await build({
            logger: { level: 'info' }
        })

    })

    test('Miss', async (t) => {
        t.plan(1)
        const response = await fastifyServer.inject({
            method: 'GET',
            url: '/mocks/items'
        })
        t.assert.strictEqual(response.statusCode, 200, 'returns a status code of 200')
    })

    after(async () => {
        await mocksServer.stop()
    })

})