import { collectDefaultMetrics, Counter, Histogram } from 'prom-client'

export function initMetrics(server, plugins) {

    collectDefaultMetrics()

    const httpRequestsTotal = new Counter({
        name: 'http_requests_total',
        help: 'Total number of HTTP requests to Speedis',
        labelNames: ['origin', 'method',]
    })
    server.decorate('httpRequestsTotal', httpRequestsTotal)

    const httpResponsesTotal = new Counter({
        name: 'http_responses_total',
        help: 'Total number of HTTP responses',
        labelNames: ['origin', 'statusCode', 'cacheStatus']
    })

    const httpResponsesDuration = new Histogram({
        name: 'http_responses_duration',
        help: 'Duration of HTTP responses',
        labelNames: ['origin', 'statusCode', 'cacheStatus']
    })

    const xSpeedisCacheStatusHeaderRE = /^(CACHE_.+) from/
    server.addHook('onResponse', async (request, reply) => {
        if (request.originalUrl !== '/metrics') {

            let origin = 'unknown'
            plugins.forEach((prefix, id) => {
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
                server.log.warn(`The origin ${origin}, cache status ${cacheStatus}  or status code ${statusCode} is not valid.`)
            }

            httpResponsesTotal
                .labels({
                    origin: origin,
                    statusCode: statusCode,
                    cacheStatus: cacheStatus
                }).inc()

            if (typeof reply.elapsedTime === 'number' && !Number.isNaN(reply.elapsedTime)) {
                httpResponsesDuration.labels({
                    origin: origin,
                    statusCode: statusCode,
                    cacheStatus: cacheStatus
                }).observe(reply.elapsedTime)
            } else {
                server.log.warn(`The duration value ${reply.elapsedTime} is not valid.`)
            }

        }

    })

}