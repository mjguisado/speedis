import fastify from 'fastify'
import path from 'path'
import fs from 'fs/promises'
import speedisPlugin from './plugins/speedis.js'
import { Counter, Histogram }  from 'prom-client'

export async function app(opts = {}) {
    
    const server = fastify(opts)

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
            server.after(err => { if (err) console.log(err) })
        }
    })

    // Register the Prometheus metrics.
    const httpRequestsTotal = new Counter({
        name: 'http_requests_total',
        help: 'Total number of HTTP requests',
    })
    const httpResponsesTotal = new Counter({
        name: 'http_responses_total',
        help: 'Total number of HTTP responses',
    })
    const httpHitResponsesTotal = new Counter({
        name: 'http_hit_responses_total',
        help: 'Total number of HTTP HIT responses',
    })
    const httpMissResponsesTotal = new Counter({
        name: 'http_miss_responses_total',
        help: 'Total number of HTTP MISS responses',
    })
    const httpRefreshHitResponsesTotal = new Counter({
        name: 'http_refresh_hit_responses_total',
        help: 'Total number of HTTP REFRESH  HIT responses',
    })
    const httpRefreshMissResponsesTotal = new Counter({
        name: 'http_refresh_miss_responses_total',
        help: 'Total number of HTTP REFRESH MISS responses',
    })
    const httpRefreshFailHitResponsesTotal = new Counter({
        name: 'http_refresh_fail_hit_responses_total',
        help: 'Total number of HTTP REFRESH FAIL HIT responses',
    })

    const httpResponsesDuration = new Histogram({
        name: 'http_responses_duration',
        help: 'Duration of HTTP responses',
    })
    const httpHitResponsesDuration = new Histogram({
        name: 'http_hit_responses_duration',
        help: 'Duration of HTTP HIT responses',
    })
    const httpMissResponsesDuration = new Histogram({
        name: 'http_miss_responses_duration',
        help: 'Duration of HTTP MISS responses',
    })
    const httpRefreshHitResponsesDuration = new Histogram({
        name: 'http_refresh_hit_responses_duration',
        help: 'Duration of HTTP REFRESH  HIT responses',
    })
    const httpRefreshMissResponsesDuration = new Histogram({
        name: 'http_refresh_miss_responses_duration',
        help: 'Duration of HTTP REFRESH MISS responses',
    })
    const httpRefreshFailHitResponsesDuration = new Histogram({
        name: 'http_refresh_fail_hit_responses_duration',
        help: 'Duration of HTTP REFRESH FAIL HIT responses',
    })

    server.addHook('onRequest', async (request, reply) => {
        httpRequestsTotal.inc()
    })

    server.addHook('onResponse', async (request, reply) => {
        const xSpeedisCacheHeader = reply.getHeader('x-speedis-cache')
        httpResponsesTotal.inc()
        httpResponsesDuration.observe(reply.elapsedTime)
        if (xSpeedisCacheHeader) {
            if (xSpeedisCacheHeader.startsWith('TCP_HIT')) {
                httpHitResponsesTotal.inc()
                httpHitResponsesDuration.observe(reply.elapsedTime)
            } else if (xSpeedisCacheHeader.startsWith('TCP_MISS')) {
                httpMissResponsesTotal.inc()
                httpMissResponsesDuration.observe(reply.elapsed)
            } else if (xSpeedisCacheHeader.startsWith('TCP_REFRESH_HIT')) {
                httpRefreshHitResponsesTotal.inc()
                httpRefreshHitResponsesDuration.observe(reply.elapsedTime)
            } else if (xSpeedisCacheHeader.startsWith('TCP_REFRESH_MISS')) {
                httpRefreshMissResponsesTotal.inc()
                httpRefreshMissResponsesDuration.observe(reply.elapsed)
            } else if (xSpeedisCacheHeader.startsWith('TCP_REFRESH_FAIL_HIT')) {
                httpRefreshFailHitResponsesTotal.inc()
                httpRefreshFailHitResponsesDuration.observe(reply.elapsedTime)
            }
        }
    })
   
    server.ready(err => { if (err) console.log(err) })
    
    return server

}