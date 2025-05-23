
import os from 'os'
import * as bff from '../modules/bff.js'
import * as cache from '../modules/cache.js'
import * as utils from '../utils/utils.js'
import sessionPlugin from './session.js'
import { initOrigin, generateUrlKey, proxy } from '../modules/origin.js'
import { initRedis } from '../modules/redis.js'
import { initOAuth2 } from '../modules/oauth2.js'
import { initVariantsTracker } from '../modules/variantTracker.js'
import { initMetrics } from '../modules/metrics.js'
import { errorHandler } from '../modules/error.js'

export default async function (server, opts) {

    // This parameter determines whether descriptive error 
    // messages are included in the response body
    server.decorate('exposeErrors', opts.exposeErrors)
    /*
    const remoteBaseUrl = opts.origin.http2Options
        ? opts.origin.http2Options.authority
        : `${opts.origin.http1xOptions.protocol}//${opts.origin.http1xOptions.host}:${opts.origin.http1xOptions.port}`
    */
   
    // Module init
    await initOrigin(server, opts)
    if (opts.redis) await initRedis(server, opts)
    if (opts.cache) cache.initCache(server, opts)
    if (opts.bff) await bff.initBff(server, opts)
    if (opts.oauth2) {
        await initOAuth2(server, opts)
        await server.register(sessionPlugin, opts.oauth2)
    }
    if (opts.variantsTracker) initVariantsTracker(server, opts)

    // In Fastify, you can’t explicitly define the execution order of hooks of 
    // the same type (such as onRequest, preHandler, etc.), because all hooks 
    // registered for the same event are executed in the order they were added.
    // For this reason, the metrics are initialized at the last moment so that 
    // their hooks are executed last for each event.
    if (opts.metrics) initMetrics(server, opts)

    server.all('/*', async (request, reply) => {

        try {

            if (opts.bff) bff.transform(opts, bff.CLIENT_REQUEST, request)

            generateUrlKey(opts, request)

            if (cache.isPurgeRequest(opts, request))
                return cache.purge(server, opts, request, reply)

            let response = request.cacheable
                ? await cache.getCacheable(server, opts, request)
                : await proxy(server, opts, request)
            utils.ensureValidDateHeader(response, Date.now())
            if (!response.headers['x-speedis-cache-status']) {
                response.headers['x-speedis-cache-status'] = 'CACHE_STATUS_UNDEFINED from ' + os.hostname()
            }

            if (opts.bff) bff.transform(opts, bff.CLIENT_RESPONSE, response)

            return reply
                .code(response.statusCode)
                .headers(response.headers)
                .send(response.body)

        } catch (error) {
            const msg = `Origin: ${opts.id}. Failed to retrieve the requested resource. ` +
                `RID: ${request.id}. Method: ${request.method}. URL: ${request.raw.url}`
            server.log.error(error, msg)
            return errorHandler(reply, "ETIMEDOUT"===error.code?504:500, msg, opts.exposeErrors, error)
        }

    })

}
