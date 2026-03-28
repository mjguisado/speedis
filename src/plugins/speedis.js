
import os from 'os'
import * as bff from '../modules/bff.js'
import * as cache from '../modules/cache.js'
import * as utils from '../utils/utils.js'
import { initRedis } from '../modules/redis.js'
import { initOrigin, generateUrlKey, proxy, generatePath } from '../modules/origin.js'
import { initAuthentication } from '../modules/authentication.js'
import { initVariantsTracker } from '../modules/variantTracker.js'
import { initMetrics } from '../modules/metrics.js'
import { errorHandler } from '../modules/error.js'

export default async function (server, opts) {

    // This parameter determines whether descriptive error 
    // messages are included in the response body
    server.decorate('exposeErrors', opts.exposeErrors)
   
    // The path of the request without the prefix
    server.decorateRequest("path", null)
    server.addHook('onRequest', (request, reply) => {    
        request.path = generatePath(request)
    })

    // Module init
    await initOrigin(server, opts)
    if (opts.redis) await initRedis(server, opts)
    if (opts?.origin?.authentication?.enabled) initAuthentication(server, opts)
    if (opts?.cache?.enabled) cache.initCache(server, opts)
    if (opts?.bff?.enabled) await bff.initBff(server, opts)
    if (opts?.variantsTracker?.enabled) initVariantsTracker(server, opts)

    // In Fastify, you can’t explicitly define the execution order of hooks of 
    // the same type (such as onRequest, preHandler, etc.), because all hooks 
    // registered for the same event are executed in the order they were added.
    // For this reason, the metrics are initialized at the last moment so that 
    // their hooks are executed last for each event.
    if (opts.metrics) initMetrics(server, opts)

    server.all('/*', async (request, reply) => {

        try {

            if (opts?.bff?.enabled) {
                bff.transform(opts, bff.CLIENT_REQUEST, request)
            }

            generateUrlKey(opts, request)

            if (cache.isPurgeRequest(server, opts, request))
                return cache.purge(server, opts, request, reply)

            let response = request.cacheable
                ? await cache.getCacheable(server, opts, request)
                : await proxy(server, opts, request)
            utils.ensureValidDateHeader(response, Date.now())
            if (!response.headers['x-speedis-cache-status']) {
                response.headers['x-speedis-cache-status'] = 'CACHE_STATUS_UNDEFINED from ' + os.hostname()
            }

            if (opts?.bff?.enabled) bff.transform(opts, bff.CLIENT_RESPONSE, response)

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
