import cluster from "node:cluster";
import os from 'os'
import path from 'path'
import fs from 'fs/promises'
import { app } from './app.js'


// Load the origin's configuration.
const configurationFilename = path.join(process.cwd(), 'conf', 'speedis.json')
const config = await fs.readFile(configurationFilename, 'utf8')
  .then(jsonString => { return JSON.parse(jsonString) })
  .catch(err => {
    server.log.error(err, 'Error loading the configuration file ' + configurationFilename)
    throw err
  })

/*
validateConfig = ajv.compile({
  type: "object",
  additionalProperties: false,
  properties: {
    enableCluster: { type: "boolean", default: "false" },
    maxCPUAllocationPercentage: { type: "integer", default: 80 }
  }
})
*/

const numCPUs = os.cpus().length;

if (config.enableCluster && cluster.isPrimary) {
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }
  cluster.on("exit", (worker, code, signal) => 
    console.log(`worker ${worker.process.pid} died`),
  );
} else {

  // See: https://fastify.dev/docs/latest/Guides/Testing/#separating-concerns-makes-testing-easy
  const server = await app({
    logger: { level: 'info' }
  })
  // Run the server!
  try {
    await server.listen({ port: 3000 })
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }

}

