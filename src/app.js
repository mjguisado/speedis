import fastify from 'fastify'
import path from 'path'
import fs from 'fs/promises'
import speedisPlugin from './plugins/speedis.js'
import { collectDefaultMetrics, Counter, Histogram } from 'prom-client'
import { getCacheStatus} from './utils/utils.js'

export async function app(opts = {}) {

    const server = fastify(opts)
    const plugins =  new Map()

    // Register the Prometheus metrics.

    collectDefaultMetrics()

    const httpRequestsTotal = new Counter({
        name: 'http_requests_total',
        help: 'Total number of HTTP requests to Speedis',
        labelNames: ['origin']
    })
    server.decorate('httpRequestsTotal', httpRequestsTotal)

    const httpResponsesTotal = new Counter({
        name: 'http_responses_total',
        help: 'Total number of HTTP responses',
        labelNames: ['origin']
    })

    const httpResponsesDuration = new Histogram({
        name: 'http_responses_duration',
        help: 'Duration of HTTP responses',
        labelNames: ['origin', 'statusCode', 'cacheStatus']
    })

    // See: https://github.com/siimon/prom-client?tab=readme-ov-file#zeroing-metrics-with-labels

    httpResponsesDuration.zero({ cacheStatus: 'TCP_HIT' })
    httpResponsesDuration.zero({ cacheStatus: 'TCP_MISS' })
    httpResponsesDuration.zero({ cacheStatus: 'TCP_REFRESH_HIT' })
    httpResponsesDuration.zero({ cacheStatus: 'TCP_REFRESH_MISS' })
    httpResponsesDuration.zero({ cacheStatus: 'TCP_REFRESH_FAIL_HIT' })


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
                    server.log.error(err, 'Error loading the configuration file ' + originFilePath)
                }))
    })
    origins = await Promise.all(origins)

    // For each valid origin, we register an instance of the plugin that manages it.
    origins.forEach((origin) => {
        if (undefined !== origin) {
            server.register(speedisPlugin, origin)
            plugins.set(origin.id, origin.prefix)
            server.after(err => { if (err) console.log(err) })
            httpResponsesDuration.zero({ origin: origin.id })
        }
    })

    server.addHook('onResponse', async (request, reply) => {
        let origin = null
        plugins.forEach((prefix, id) => {
            if (request.url.startsWith(prefix)) {
                origin = id
            }
        })
        httpResponsesTotal
            .labels({origin: origin})
            .inc()

        if (typeof reply.elapsedTime === 'number' && !Number.isNaN(reply.elapsedTime)) {
            httpResponsesDuration.labels({
                origin: origin,
                statusCode: reply.statusCode,
                cacheStatus: getCacheStatus(reply)
            }).observe(reply.elapsedTime)
        } else {
            server.log.warn('The duration value is not valid: ', reply.elapsedTime)
        }
    
    })

    server.ready(err => { if (err) console.log(err) })

    return server

}