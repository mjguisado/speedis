import fastify from 'fastify'
import mocksPlugin from './plugins/mocks.js'
import { collectDefaultMetrics, register, Counter, Histogram } from 'prom-client'

const mockServer = fastify({
    logger: { level: 'debug' }
})

const httpRequestsTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests to Speedis',
})

const httpResponsesTotal = new Counter({
    name: 'http_responses_total',
    help: 'Total number of HTTP responses',
})

const httpResponsesDuration = new Histogram({
    name: 'http_responses_duration',
    help: 'Duration of HTTP responses',
    labelNames: ['statusCode']
})

collectDefaultMetrics()

mockServer.addHook('onRequest', async (request, reply) => {
    if (request.originalUrl.startsWith('/mocks')) {
        httpRequestsTotal.inc() 
    }
})

mockServer.addHook('onResponse', async (request, reply) => {
    if (request.originalUrl.startsWith('/mocks')) {
        httpResponsesTotal.inc()
        if (reply.elapsedTime && !Number.isNaN(reply.elapsedTime)) {
            httpResponsesDuration.labels({
                statusCode: reply.statusCode,
            }).observe(reply.elapsedTime)
        } else {
            server.log.warn('The duration value is not valid: ', reply.elapsedTime)
        }
    }
})

mockServer.get('/metrics', async (request, reply) => {
    reply.type(register.contentType);
    reply.send(await register.metrics());
})

await mockServer.register(mocksPlugin, {
    id: "mocks",
    prefix: "/mocks",
    logLevel: "info"
})

try {
    await mockServer.listen({ host: '::', port: 3030 })
} catch (err) {
    mockServer.log.error(err)
    process.exit(1)
}

