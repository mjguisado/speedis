import os from 'os'
import path from 'path'
import fs from 'fs/promises'
import cluster from "node:cluster"
import fastify from 'fastify'
import { app } from './app.js'
import { AggregatorRegistry, } from 'prom-client'
import Ajv from "ajv"
import { open } from 'inspector';

// Load the origin's configuration.
const configurationFilename = path.join(process.cwd(), 'conf', 'speedis.json')
const config = await
    fs.stat(configurationFilename)
        .then(() => {
            return fs.readFile(configurationFilename, 'utf8')
        })
        .then((data) => {
            return JSON.parse(data)
        })
        .catch(err => {
            if (err.code === 'ENOENT') {
                console.warn('Configuration file not found:', configurationFilename)
                return {}
            } else {
                console.log(err, 'Error loading the configuration file ' + configurationFilename)
                process.exit(1)
            }
        })

const ajv = new Ajv({ useDefaults: true })
const validateSpeedis = ajv.compile(
    {
        type: "object",
        additionalProperties: false,
        properties: {
            maxNumberOfWorkers: { type: "number", default: os.availableParallelism() },
            port: { type: "number", default: 3001 },
            logLevel: {
                enum: ["fatal", "error", "warn", "info", "debug", "trace"],
                default: "info"
            },
            metricServerPort: { type: "number", default: 3003 },
            metricServerLogLevel: {
                enum: ["fatal", "error", "warn", "info", "debug", "trace"],
                default: "info"
            }
        }
    }
)
if (!validateSpeedis(config)) {
    console.error("Invalid configuration file:", configurationFilename)
    console.error(validateSpeedis.errors)
    process.exit(1)
}

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
        logger: { level: config.metricServerLogLevel }
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

    if (process.env.NODE_ENV === 'development') {
        // Enable remote DEBUG
        // open(9229, '0.0.0.0');
    }

    metricsServer.listen(
        { host: '::', port: config.metricServerPort },
        (error, address) => {
            if (error) {
                metricsServer.log.error(error, 'Error starting metric server.')
                process.exit(1)
            }
            metricsServer.log.info(`Metrics server running at ${address}.`)
        }
    )

} else {

    if (process.env.NODE_ENV === 'development') {
        // Enable remote DEBUG
        open(9229 + cluster.worker.id, '0.0.0.0');
    }

    // See: https://fastify.dev/docs/latest/Guides/Testing/#separating-concerns-makes-testing-easy

    const server = await app(
        { logger: { level: config.logLevel } },
        ajv
    )

    // Run the server!
    try {
        await server.listen({ host: '::', port: config.port })
    } catch (error) {
        server.log.error(error)
        process.exit(1)
    }

}

