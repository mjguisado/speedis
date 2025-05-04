import path from 'path'
import { register, Counter, Histogram } from 'prom-client'
import { isPurgeRequest } from './cache.js'

export function initMetrics(server, opts) {

    const speedisHttpRequestsTotal = new Counter({
        name: 'speedis_http_requests_total',
        help: 'Total number of HTTP requests to Speedis',
        labelNames: ['origin', 'method', 'target']
    })

    const speedisHttpResponsesTotal = new Counter({
        name: 'speedis_http_responses_total',
        help: 'Total number of HTTP responses from Speedis',
        labelNames: ['origin', 'statusCode', 'cacheStatus']
    })

    const speedisHttpResponsesDuration = new Histogram({
        name: 'speedis_http_responses_duration',
        help: 'Duration of HTTP responses  from Speedis',
        labelNames: ['origin', 'statusCode', 'cacheStatus']
    })

    const oauth2UrlPrefix = opts.oauth2
        ? path.join(opts.prefix, opts.oauth2.prefix)
        : false

    server.addHook('onRequest', async (request, reply) => {
        let target
        if (oauth2UrlPrefix && request.raw.url.startsWith(oauth2UrlPrefix)) {
            target = 'oauth2'
        } else if (isPurgeRequest(opts, request)) {
            target = 'purge'
        } else if (request.cacheable) {
            target = 'cache'
        } else {
            target = 'proxy'
        }
        speedisHttpRequestsTotal
            .labels({
                origin: opts.id,
                method: request.method,
                target: target
            }).inc() 
    })

    /*
    const xSpeedisCacheStatusHeaderRE = /^(CACHE_.+) from/
    server.addHook('onResponse', async (request, reply) => {
        if (request.originalUrl !== '/metrics') {

            let origin = 'unknown'
            server.plugins.forEach((prefix, id) => {
                if (request.url.startsWith(prefix)) {
                    origin = id
                }
            })

            let statusCode = 'unknown'
            if (typeof reply.statusCode === 'number' && !Number.isNaN(reply.statusCode)) {
                statusCode = reply.statusCode
            }

            let cacheStatus = 'unknown'
            if (reply.hasHeader('x-speedis-cache-status')) {
                const matches = reply.getHeader('x-speedis-cache-status')
                    .match(xSpeedisCacheStatusHeaderRE)
                if (matches) cacheStatus = matches[1]
            }

            if ('unknown' === origin || 'unknown' === cacheStatus || 'unknown' === statusCode) {
                server.log.warn(`The origin ${origin}, cache status ${cacheStatus}  or status code ${statusCode} is not valid for ${request.raw.url}.`)
            }

            speedisHttpResponsesTotal
                .labels({
                    origin: origin,
                    statusCode: statusCode,
                    cacheStatus: cacheStatus
                }).inc()

            if (typeof reply.elapsedTime === 'number' && !Number.isNaN(reply.elapsedTime)) {
                speedisHttpResponsesDuration.labels({
                    origin: origin,
                    statusCode: statusCode,
                    cacheStatus: cacheStatus
                }).observe(reply.elapsedTime)
            } else {
                server.log.warn(`The duration value ${reply.elapsedTime} is not valid.`)
            }

        }

    })
    */

}