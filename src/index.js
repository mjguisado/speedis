import os from 'os'
import path from 'path'
import fs from 'fs/promises'
import cluster from "node:cluster"
import fastify from 'fastify'
import { app } from './app.js'
import { register, collectDefaultMetrics, AggregatorRegistry } from 'prom-client'
import Ajv from "ajv"
import { open } from 'inspector';
import { createClient } from 'redis';

/*
Speedis also uses Redis as both a cache and as a background job queue via node-resque.
You can customize how this are used via your environment variables.

REDIS_URL="redis://localhost:6379/0"

The full set of options you can provide to REDIS_URL is: REDIS_URL="redis://{user}:{password}@{host}:{port}/{database}".
Note that you cannot use an @ or : in your username or password when using REDIS_URL.
Alternatively to REDIS_URL, you can set the following environment variables directly: REDIS_HOST, REDIS_PORT, REDIS_DB, and REDIS_USER, REDIS_PASS which do allow all special characters.
To use an in-memory redis, set REDIS_URL="redis://mock".
*/

let config = {}
let configdb = null

if (process.env.USE_REDIS_CONFIG) {
    console.info('Loading the Speedis configuration from Redis')
    try {
        if (process.env.REDIS_URL) {
            configdb = createClient({ url: process.env.REDIS_URL })
        } else {
            const socket = {
                host: process.env.REDIS_HOST || '127.0.0.1',
                port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT) : 6379
            }
            const opts = { socket }
            if (process.env.REDIS_USER) opts.username = process.env.REDIS_USER
            if (process.env.REDIS_PASS) opts.password = process.env.REDIS_PASS
            if (process.env.REDIS_DB) opts.database = parseInt(process.env.REDIS_DB)
            configdb = createClient(opts)
        }
        configdb.on('error', error => {
            console.error('Speedis configuration database connection lost.', error.message)
        })
        await configdb.connect()
        console.info(`Successfully connected to Redis to fetch the Speedis configuration.`)
    } catch (error) {
        console.error('Unable to connect to Redis to fetch the Speedis configuration.', error.message)
    }

    try {
        const speedisConfigKey = process.env.SPEEDIS_CONFIG_KEY || 'speedis:config:main'
        config = await configdb.json.get(speedisConfigKey)
        if (!config) {
            config = {}
            console.warn('Speedis configuration key not found: ' + speedisConfigKey)
        }
    } catch (error) {
        console.error('Error loading Speedis configuration from Redis:', error.message)
    } finally {
        try {
            if (configdb) await configdb.close()
        } catch (_) {}
    }

} else {
    const configurationFilename = path.join(process.cwd(), 'conf', 'speedis.json')
    console.info('Loading the Speedis configuration file: ' + configurationFilename)
    try {
        await fs.stat(configurationFilename)
        const data = await fs.readFile(configurationFilename, 'utf8')
        config = JSON.parse(data)
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.warn('Speedis configuration file not found: ', configurationFilename)
        } else {
            console.error('Error loading the Speedis configuration file: ' + configurationFilename, error.message)
        }
    }
}

if (Object.keys(config).length === 0) {
    console.warn('Using default Speedis configuration.')
}

const ajv = new Ajv({ useDefaults: true })
const validateSpeedis = ajv.compile({
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
        },
        localOriginsConfigs:  { type: "string", nullable: true, default: null },
        originsConfigsKeys: {
            type: "array",
            items: { type: "string" },
            default: []
        }
    }
})

if (!validateSpeedis(config)) {
    console.error("Invalid configuration file:", configurationFilename)
    console.error(validateSpeedis.errors)
    process.exit(1)
}

const aggregatorRegistry = new AggregatorRegistry()
collectDefaultMetrics()

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
    const server = await app (
        { logger: { level: config.logLevel } },
        ajv,
        config.localOriginsConfigs,
        configdb,
        config.originsConfigsKeys
    )

    // Run the server!
    try {
        await server.listen({ host: '::', port: config.port })
    } catch (error) {
        server.log.error(error)
        process.exit(1)
    }

}

