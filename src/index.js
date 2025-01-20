import os from 'os'
import path from 'path'
import fs from 'fs/promises'
import cluster from "node:cluster"
import fastify from 'fastify'
import { app } from './app.js'
import { AggregatorRegistry, collectDefaultMetrics } from 'prom-client'

// Load the origin's configuration.
const configurationFilename = path.join(process.cwd(), 'conf', 'speedis.json')
const config = await fs.readFile(configurationFilename, 'utf8')
  .then(jsonString => { return JSON.parse(jsonString) })
  .catch(err => {
    console.log(err, 'Error loading the configuration file ' + configurationFilename)
    throw err
  })

// TODO: Validate configuration.

const aggregatorRegistry = new AggregatorRegistry();

if (cluster.isPrimary) {

  const numWorkers = Math.min(
    os.availableParallelism(), 
    config.maxNumberOfWorkers
  )
  for (let i = 0; i < numWorkers; i++) {
    cluster.fork();
  }

  cluster.on("exit", (worker, code, signal) => 
    console.log(`worker ${worker.process.pid} died`),
  );

  collectDefaultMetrics();

  const metricsServer = fastify({});

  metricsServer.get('/metrics', async (req, res) => {
    try {
      const metrics = await aggregatorRegistry.clusterMetrics();
      res.type(aggregatorRegistry.contentType)
      res.send(metrics);
    } catch (err) {
      res.code(500).send(err.message);
    }
  });
  
  metricsServer.listen({ 
      host: '::', 
      port: config.metricServerPort
    }, (err, address) => {
    if (err) {
      metricsServer.log.error('Error starting server:', err);
      process.exit(1);
    }
    metricsServer.log.info(`Master metrics server running at ${address}`);
  });

} else {

  // See: https://fastify.dev/docs/latest/Guides/Testing/#separating-concerns-makes-testing-easy
  const server = await app({
    logger: { level: 'info' }
  })
  
  // Run the server!
  try {
    await server.listen({host: '::', port: config.port })
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }

}

