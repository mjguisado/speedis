import os from 'os'
import path from 'path'
import fs from 'fs/promises'
import cluster from "node:cluster"
import fastify from 'fastify'
import { app } from './app.js'
import { AggregatorRegistry,  } from 'prom-client'

// Load the origin's configuration.
const configurationFilename = path.join(process.cwd(), 'conf', 'speedis.json')
const config = await fs.readFile(configurationFilename, 'utf8')
  .then(jsonString => { return JSON.parse(jsonString) })
  .catch(err => {
    console.log(err, 'Error loading the configuration file ' + configurationFilename)
    throw err
  })

  // TODO: Validate configuration.


const aggregatorRegistry = new AggregatorRegistry()

// https://medium.com/@mjdrehman/implementing-node-js-cluster-for-improved-performance-f800146e58e1
// https://medium.com/deno-the-complete-reference/the-benefits-of-clustering-fastify-app-in-node-js-hello-world-case-8a99127b9951
if (cluster.isPrimary) {

  const numWorkers = Math.min(
    os.availableParallelism(), 
    config.maxNumberOfWorkers
  )

  for (let i = 0; i < numWorkers; i++) { cluster.fork() }

  cluster.on("exit", (worker, code, signal) => 
    console.log(`worker ${worker.process.pid} died`),
  )

  const metricsServer = fastify({
    logger: { level: config.metricServerLogLevel?config.metricServerLogLevel:'info' }
  })
  

  // FIXME: Las llamadas a las métricas no se contabilizan en el servidor de métricas.
  metricsServer.get('/metrics', async (req, res) => {
    try {
      res.type(aggregatorRegistry.contentType)
      res.send(await aggregatorRegistry.clusterMetrics())
    } catch (err) {
      res.code(500).send(err.message)
    }
  })
  
  metricsServer.listen({ 
      host: '::', 
      port: config.metricServerPort?config.metricServerPort:3003
    }, (err, address) => {
    if (err) {
      metricsServer.log.error('Error starting server:', err)
      process.exit(1)
    }
    metricsServer.log.info(`Master metrics server running at ${address}`)
  })

} else {

  // See: https://fastify.dev/docs/latest/Guides/Testing/#separating-concerns-makes-testing-easy

  const server = await app({
    logger: { level: config.logLevel?config.logLevel:'info' }
  })
  
  // Run the server!
  try {
    await server.listen({
      host: '::', 
      port: config.port?config.port:3001 })
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }

}

