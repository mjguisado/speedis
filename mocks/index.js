import fs from 'fs'
import fastify from 'fastify'
import mocksPlugin from './plugins/mocks.js'
import { collectDefaultMetrics, register, Counter, Histogram } from 'prom-client'

// Build Fastify options depending on env var
let fastifyOptions = { logger: { level: 'warn' } }

if (process.env.MOCKS_HTTP2 === 'true') {
    fastifyOptions = {
        logger: { level: 'warn' },
        http2: true,
        https: {
            allowHTTP1: true,
            key: fs.readFileSync('./certs/mocks.key'),
            cert: fs.readFileSync('./certs/mocks.crt')
        }
    }
}

const mockServer = fastify(fastifyOptions)

const httpRequestsTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests to Speedis',
})

const speedisHttpResponsesTotal = new Counter({
    name: 'http_responses_total',
    help: 'Total number of HTTP responses',
})

const speedisHttpResponsesDuration = new Histogram({
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
        speedisHttpResponsesTotal.inc()
        if (reply.elapsedTime && !Number.isNaN(reply.elapsedTime)) {
            speedisHttpResponsesDuration.labels({
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
    logLevel: "warn"
})

try {
    await mockServer.listen({ host: '::', port: 3030 })
} catch (error) {
    mockServer.log.error(error)
    process.exit(1)
}

