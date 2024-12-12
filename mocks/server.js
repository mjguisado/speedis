import fastify from 'fastify'
import mocksPlugin from './plugins/mocks.js'
import fastifyCaching from '@fastify/caching'
const mockServer = fastify({
    logger: true
})

await mockServer.register(mocksPlugin, {
    id: "mocks",
    prefix: "/mocks",
    logLevel: "info"
})

await mockServer.register(fastifyCaching, {
})

// Run the server!
try {
    await mockServer.listen({ port: 3001 })
} catch (err) {
    mockServer.log.error(err)
    process.exit(1)
}

