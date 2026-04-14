import fs from 'fs'
import fastify from 'fastify'
import mocksPlugin from './plugins/mocks.js'
import { collectDefaultMetrics, register, Counter, Histogram } from 'prom-client'

// Build Fastify options depending on env var
let fastifyOptions = {
    logger: { level: 'warn' },
    http2: true,
    https: {
        allowHTTP1: true,
        key:  fs.readFileSync('./certs/mocks.key'),
        cert: fs.readFileSync('./certs/mocks.crt')
    }
}

const mockServer = fastify(fastifyOptions)

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
    logLevel: "warn",
    authentication: {
        bearer: {
            // Si se debe verificar la firma del JWT
            verifyJwtSignature: false,
            // Si se permiten tokens sin firmar (alg: none)
            allowUnsigned: true,
            // URI del JWKS para verificar firmas (requerido si verifyJwtSignature = true)
            jwksUri: null, // Ejemplo: 'https://your-auth-server.example.com/.well-known/jwks.json'
            // Clave de descifrado para JWE (opcional)
            decryptionKey: null,
            // Claim del JWT que contiene el user ID
            claim: 'sub'
        }
    }
})

try {
    await mockServer.listen({ host: '::', port: 3030 })
} catch (error) {
    mockServer.log.error(error)
    process.exit(1)
}

