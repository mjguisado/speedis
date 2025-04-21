import http from 'http'
import https from 'https'
import path from 'path'
import os from 'os'
import * as crypto from 'crypto'
import { createClient } from 'redis'
import CircuitBreaker from 'opossum'
import * as utils from '../utils/utils.js'
import sessionPlugin from './session.js'
import { jwtVerify, createRemoteJWKSet } from 'jose'
import * as openIdClient from 'openid-client'
import { storeSession } from './helpers.js'
import replyFrom from '@fastify/reply-from'

// TODO: https://www.rfc-editor.org/rfc/rfc9111.html#name-must-understand
// TODO: https://www.rfc-editor.org/rfc/rfc9111.html#name-no-transform
// TODO: https://www.rfc-editor.org/rfc/rfc9111.html#name-no-transform-2
// TODO: https://www.rfc-editor.org/rfc/rfc9111.html#name-public
// TODO: https://www.rfc-editor.org/rfc/rfc9111#name-storing-incomplete-response
// TODO: https://www.rfc-editor.org/rfc/rfc9111.html#name-constructing-responses-from
// https://tohidhaghighi.medium.com/add-prometheus-metrics-in-nodejs-ce0ff5a43b44

// REVIEW: Unusual Status Code management
// THINK ABOUT: Remote Configuration Management => JSON + Client Side Cache
// THINK ABOUT: Logs management (Kiabana). Fluentd or Central Logging (K8s)

export default async function (server, opts) {

  server.route({
    method: 'DELETE',
    url: '/*',
    handler: async function (request, reply) {
      server.httpRequestsTotal
        .labels({ origin: opts.id, method: 'DELETE' })
        .inc()
      const fieldNames = utils.parseVaryHeader(request)
      let cacheKey = generateCacheKey(request, fieldNames)
      try {
        let result = 0
        // See: https://antirez.com/news/93
        if (cacheKey.indexOf('*') > -1) {
          // See: https://github.com/redis/node-redis/blob/master/docs/scan-iterators.md
          // See: https://github.com/redis/node-redis/blob/master/docs/v4-to-v5.md#scan-iterators
          for await (const toTrash of server.redis.scanIterator({
            MATCH: cacheKey,
            COUNT: 100
          })) {
            result += await server.redis.unlink((toTrash))
          }
        } else {
          result = await server.redis.unlink(cacheKey)
        }
        if (result) {
          reply.code(204)
        } else {
          reply.code(404)
        }
      } catch (error) {
        const msg =
          "Error deleting the cache in Redis. " +
          `Origin: ${opts.id}. Key: ${cacheKey}. RID: ${rid}.`
        if (opts.exposeErrors) { throw new Error(msg, { cause: error }) }
        else throw new Error(msg)
      }
    }
  })

}
