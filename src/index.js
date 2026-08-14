import os from 'os'
import path from 'path'
import fs from 'fs/promises'
import cluster from "node:cluster"
import fastify from 'fastify'
import { app } from './app.js'
import { collectDefaultMetrics, AggregatorRegistry } from 'prom-client'
import Ajv from "ajv"
import { open } from 'inspector'
import { createClient } from 'redis'
import mainSchema from '../schemas/main.schema.json' with { type: 'json' }

/*
In Speedis, Redis is used to store cache entries.
Additionally, it can be used to store configuration information in a 
centralized way. The following environment variable configures the 
connection to the Redis instance that holds the centralized configuration:

REDIS_URL=“redis://{user}:{password}@{host}:{port}/{database}”

The default value is REDIS_URL=“redis://127.0.0.1:6379/”

Note: When using REDIS_URL, the username and password cannot contain
“@” or “:” characters.

Alternatively, instead of REDIS_URL, you can configure the connection using
the following environment variables: 
REDIS_HOST, REDIS_PORT, REDIS_DB, REDIS_USER, REDIS_PASS

These variables allow all special characters in the username and password.
*/

let config = {}
let configdb = null

const configurationFilename = path.join(process.cwd(), 'conf', 'speedis.json')
const speedisConfigKey = process.env.SPEEDIS_CONFIG_KEY || 'speedis:config:main'

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
        config = await configdb.json.get(speedisConfigKey)
        if (!config) {
            config = {}
            console.warn('Speedis configuration key not found: ' + speedisConfigKey)
        }
    } catch (error) {
        console.error('Error loading Speedis configuration from Redis:', error.message)
    } finally {
        try {
            if (configdb) configdb.close()
        } catch (_) { }
    }

} else {
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
const validateSpeedis = ajv.compile(mainSchema)

if (!validateSpeedis(config)) {
    if (process.env.USE_REDIS_CONFIG) {
        console.error("Invalid configuration. Key: ", speedisConfigKey)
    } else {
        console.error("Invalid configuration file:", configurationFilename)
    }
    console.error(validateSpeedis.errors)
    process.exit(1)
}

// Dynamic default (cannot be expressed in JSON schema).
config.maxNumberOfWorkers ??= os.availableParallelism()

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

    /*
    if (process.env.NODE_ENV === 'development') {
        // Enable remote DEBUG
        open(9229, '0.0.0.0')
    }
    */

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
        open(9229 + cluster.worker.id, '0.0.0.0')
    }

    // See: https://fastify.dev/docs/latest/Guides/Testing/#separating-concerns-makes-testing-easy
    const server = await app(
        config.fastify,
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

