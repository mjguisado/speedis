import fastify from 'fastify'
import path from 'path'
import fs from 'fs/promises'
import speedisPlugin from './plugins/speedis.js'

const server = fastify({
  logger: { level: 'info' }
})

// Load the origin's configuration.
const originsBasedir = path.join(process.cwd(), 'conf', 'origins')
const originFiles = await fs.readdir(originsBasedir)
let origins = []
originFiles.forEach((originFile) => {
  const originFilePath = path.join(originsBasedir, originFile)
  origins.push(
    fs.readFile(originFilePath, 'utf8')
      .then(jsonString => { return JSON.parse(jsonString) })
      .catch(err => {
        server.log.err(err, 'Error loading the configuration file ' + originFilePath)
      }))
})
origins = await Promise.all(origins)

// For each valid origin, we register an instance of the plugin that manages it.
origins.forEach((origin) => {
  if (undefined !== origin) {
    server.register(speedisPlugin, origin)
    // `after` will be executed once the previous declared `register` has finished.
    server.after(err => server.log.error(err))
  }
})

// Run the server!
try {
  await server.listen({ port: 3000 })
} catch (err) {
  server.log.error(err)
  process.exit(1)
}