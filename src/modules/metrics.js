import { register, Counter, Histogram, Gauge } from 'prom-client'
import { isPurgeRequest } from './cache.js'
import cluster from "node:cluster"

export function initMetrics(server, opts) {
   
    let tcpConnectionsGauge = 
        register.getSingleMetric('speedis_tcp_connections')
    if (!tcpConnectionsGauge) {
        tcpConnectionsGauge = new Gauge({
            name: 'speedis_tcp_connections',
            help: 'Number of active TCP connections',
            labelNames: ['worker_id'],
            async collect() {
                if (cluster.isWorker && server?.server) {
                    const count = await new Promise((resolve) => {
                        server.server.getConnections((err, count) => {
                            resolve(err ? 0 : count)
                        })
                    })
                    this.set({ worker_id: cluster.worker.id }, count)
                }
            }
        })
    }    

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

    let speedisCacheableRequestsTotal =
        register.getSingleMetric('speedis_cacheable_requests_total')
    if (!speedisCacheableRequestsTotal) {
        speedisCacheableRequestsTotal = new Counter({
            name: 'speedis_cacheable_requests_total',
            help: 'Total number of cacheable requests by URL pattern and cache status',
            labelNames: ['origin', 'urlPattern', 'cacheStatus']
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

    let speedisUpstreamRequestsDuration =
        register.getSingleMetric('speedis_upstream_requests_duration')
    if (!speedisUpstreamRequestsDuration) {
        speedisUpstreamRequestsDuration = new Histogram({
            name: 'speedis_upstream_requests_duration',
            help: 'Duration (ms) of requests made to the upstream/origin servers',
            labelNames: ['origin', 'method', 'statusCode'],
            buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]
        })
    }

    let speedisUpstreamRequestsErrorsTotal =
        register.getSingleMetric('speedis_upstream_requests_errors_total')
    if (!speedisUpstreamRequestsErrorsTotal) {
        speedisUpstreamRequestsErrorsTotal = new Counter({
            name: 'speedis_upstream_requests_errors_total',
            help: 'Total number of failed upstream requests with no HTTP response (timeouts, connection errors)',
            labelNames: ['origin', 'method', 'code']
        })
    }

    server.decorateRequest('target', null)
    server.addHook('onRequest', async (request, reply) => {
        if (isPurgeRequest(server, opts, request)) {
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

        // The plugin scope decorates request.originId with its own opts.id,
        // so no URL resolution is needed here.
        const origin = request.originId ?? 'Unknown'

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

        if ('cache' === request.target && request.cacheableUrlPattern) {
            speedisCacheableRequestsTotal
                .labels({
                    origin: origin,
                    urlPattern: request.cacheableUrlPattern,
                    cacheStatus: cacheStatus
                }).inc()
        }

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

    // Recorder for upstream/origin calls, invoked from _fetch in origin.js.
    // Decorated on the server (instead of imported) to avoid the import cycle
    // origin.js -> metrics.js -> cache.js -> origin.js. opts.id is the origin label.
    server.decorate('recordUpstreamRequest', (method, statusCode, durationMs, errorCode) => {
        if (errorCode) {
            speedisUpstreamRequestsErrorsTotal
                .labels({ origin: opts.id, method, code: errorCode })
                .inc()
        } else {
            speedisUpstreamRequestsDuration
                .labels({ origin: opts.id, method, statusCode })
                .observe(durationMs)
        }
    })

}