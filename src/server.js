import { build } from './app.js'

// See: https://fastify.dev/docs/latest/Guides/Testing/#separating-concerns-makes-testing-easy
const server = await build({
  logger: { level: 'info' }
})

// Run the server!
try {
  await server.listen({ port: 3000 })
} catch (err) {
  server.log.error(err)
  process.exit(1)
}
