import path from 'path'
import { register, Counter, Histogram } from 'prom-client'
import { isPurgeRequest } from './cache.js'

export function initMetrics(server, opts) {
   
    let speedisHttpRequestsTotal = 
        register.getSingleMetric('speedis_http_requests_total')
    if (!speedisHttpRequestsTotal) {
        speedisHttpRequestsTotal = new Counter({
            name: 'speedis_http_requests_total',
            help: 'Total number of HTTP requests to Speedis',
            labelNames: ['origin', 'target', 'method']
        })
    }

    let speedisHttpResponsesTotal =
        register.getSingleMetric('speedis_http_responses_total')
    if (!speedisHttpResponsesTotal) {
        speedisHttpResponsesTotal = new Counter({
            name: 'speedis_http_responses_total',
            help: 'Total number of HTTP responses from Speedis',
            labelNames: ['origin', 'target', 'statusCode', 'cacheStatus']
        })
    }

    let speedisHttpResponsesDuration = 
        register.getSingleMetric('speedis_http_responses_duration')
    if (!speedisHttpResponsesDuration) {
        speedisHttpResponsesDuration = new Histogram({
            name: 'speedis_http_responses_duration',
            help: 'Duration of HTTP responses  from Speedis',
            labelNames: ['origin', 'target', 'statusCode', 'cacheStatus']
        })
    }

    const oauth2UrlPrefix = opts.oauth2
        ? path.join(opts.prefix, opts.oauth2.prefix)
        : false

    server.decorateRequest('target', null)
    server.addHook('onRequest', async (request, reply) => {
        if (oauth2UrlPrefix && request.raw.url.startsWith(oauth2UrlPrefix)) {
            request.target = 'oauth2'
        } else if (isPurgeRequest(server, opts, request)) {
            request.target = 'purge'
        } else if (request.cacheable) {
            request.target = 'cache'
        } else {
            request.target = 'proxy'
        }
        speedisHttpRequestsTotal
            .labels({
                origin: opts.id,
                target: request.target,
                method: request.method
            }).inc()
    })

    const xSpeedisCacheStatusHeaderRE = /^(CACHE_.+) from/
    server.addHook('onResponse', async (request, reply) => {

        let origin = 'Unknown'
        server.plugins.forEach((prefix, id) => {
            if (request.url.startsWith(prefix)) {
                origin = id
            }
        })

        let statusCode = 'Unknown'
        if (typeof reply.statusCode === 'number' && !Number.isNaN(reply.statusCode)) {
            statusCode = reply.statusCode
        }

        let cacheStatus = 'Unknown'
        if ('cache' === request.target &&
            reply.hasHeader('x-speedis-cache-status')) {
            const matches = reply.getHeader('x-speedis-cache-status')
                .match(xSpeedisCacheStatusHeaderRE)
            if (matches) cacheStatus = matches[1]
        }

        speedisHttpResponsesTotal
            .labels({
                origin: origin,
                target: request.target,
                statusCode: statusCode,
                cacheStatus: cacheStatus
            }).inc()

        if (typeof reply.elapsedTime === 'number' && !Number.isNaN(reply.elapsedTime)) {
            speedisHttpResponsesDuration.labels({
                origin: origin,
                target: request.target,
                statusCode: statusCode,
                cacheStatus: cacheStatus
            }).observe(reply.elapsedTime)
        } else {
            server.log.warn(`The duration value ${reply.elapsedTime} is not valid.`)
        }

    })

}