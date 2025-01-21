import fastify from 'fastify'
import mocksPlugin from './plugins/mocks.js'
import fastifyCaching from '@fastify/caching'
import fastifyETag from '@fastify/etag'

const mockServer = fastify({
    logger: true
})

await mockServer.register(mocksPlugin, {
    id: "mocks",
    prefix: "/mocks",
    logLevel: "warn"
})

// await mockServer.register(fastifyCaching, {})
// await mockServer.register(fastifyETag, {})

// Run the server!
try {
    await mockServer.listen({ host: '::', port: 3030 })
} catch (err) {
    mockServer.log.error(err)
    process.exit(1)
}

