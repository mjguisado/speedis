import fastify from 'fastify'
import path from 'path'
import fs from 'fs/promises'
import speedisPlugin from './plugins/speedis.js'
import { collectDefaultMetrics, Counter, Histogram, Summary } from 'prom-client'

export async function app(opts = {}) {

  const server = fastify(opts)
  const plugins = new Map()

  // Register the Prometheus metrics.

  collectDefaultMetrics()

  const httpRequestsTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests to Speedis',
    labelNames: ['origin']
  })
  server.decorate('httpRequestsTotal', httpRequestsTotal)

  const circuitBreakersEvents = new Counter({
    name: 'circuit_brakers_events',
    help: `A count of all circuit' events`,
    labelNames: ['origin', 'event']
  })
  server.decorate('circuitBreakersEvents', circuitBreakersEvents)

  const circuitBreakersPerformance = new Summary({
    name: 'circuit_brakers_performance',
    help: `A summary of all circuit's events`,
    labelNames: ['origin', 'event']
  })
  server.decorate('circuitBreakersPerformance', circuitBreakersPerformance)

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
    }
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
        server.log.warn('The origin, cache status, or status code is not valid: ', origin, cacheStatus, statusCode)
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
        server.log.warn('The duration value is not valid: ', reply.elapsedTime)
      }

    }

  })

  server.ready(err => { if (err) console.log(err) })

  return server

}