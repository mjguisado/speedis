import path from 'path'
import * as crypto from 'crypto'
import { isPurgeRequest } from './cache.js'
import { generatePath } from './origin.js'
import { transform, VARIANTS_TRACKER } from './bff.js'

export function initVariantsTracker(server, opts) {

    const trakedUrlPatterns = []
    opts.variantsTracker.urlPatterns.forEach(trakedUrlPattern => {
        try {
            trakedUrlPatterns.push(new RegExp(trakedUrlPattern))
        } catch (error) {
            server.log.fatal(error,
                `Origin: ${opts.id}. urlPattern ${trakedUrlPattern} is not a valid regular expresion.`)
            throw new Error(`Origin: ${opts.id}. The variant tracker configuration is invalid.`, { cause: error })
        }
    })

    server.decorateReply("fingerprint", null)

    // https://fastify.dev/docs/latest/Reference/Reply/#senddata
    server.addHook('onSend', async (request, reply, payload) => {

        if (isPurgeRequest(server, opts, request)
            || (opts.oauth2 &&
                request.raw.url.startsWith(path.join(opts.prefix, opts.oauth2.prefix)))
        ) return

        let urlTracked = false
        for (const urlPattern of trakedUrlPatterns) {
            if (urlPattern.test(request.raw.url)) {
                urlTracked = true
                break
            }
        }

        if (urlTracked) {
            // Transformations are performed using actions that work with targets 
            // of type request or response. Therefore, we build a response that 
            // can hold the data to be transformed.
            const mockResponse = {
                path: generatePath(request),
                statusCode: reply.statusCode,
                headers: reply.getHeaders(),
                body: payload
            }
            if (opts.bff) transform(opts, VARIANTS_TRACKER, mockResponse)

            const typeOfBody = typeof mockResponse.body
            // https://fastify.dev/docs/latest/Reference/Reply/#type-of-the-final-payload
            if ("string" === typeOfBody) {
                if (reply.getHeader('content-type')?.toLowerCase().includes('application/json')) {
                    try {
                        const json = JSON.parse(mockResponse.body)
                        const normalized = _normalizeSimpleObject(json)
                        mockResponse.body = JSON.stringify(normalized)
                    } catch (error) {
                        server.log.error(error,
                            `Origin: ${opts.id}. URL ${request.raw.url}. An error occurred while normalizing the JSON ${mockResponse.body}.`)
                    }
                }
                reply.fingerprint = crypto.createHash("md5").update(mockResponse.body).digest("hex")
                reply.header("etag", 'W/"' + reply.fingerprint + '"')
            } else {
                server.log.warn(`Origin: ${opts.id}. URL ${request.raw.url} has a not supported type of body ${typeOfBody}.`)
            }
        }
    })

    // The onResponse hook is executed when a response has been sent, 
    // so you will not be able to send more data to the client. 
    // It can however be useful for sending data to external services, 
    // for example, to gather statistics.
    server.addHook('onResponse', async (request, reply) => {
        if (reply.fingerprint) {
            const counters = 'vary:' + request.urlKey
            try {
                server.redisBreaker
                    ? await server.redisBreaker.fire('zIncrBy', [counters, 1, reply.fingerprint])
                    : await server.redis.zIncrBy(counters, 1, reply.fingerprint)
            } catch (error) {
                const msg = `Origin: ${opts.id}. An error occurred while counting the variants ${counters} - ${reply.fingerprint}.`
                server.log.warn(error, msg)
            }
        }
    })

}

export function _normalizeComplexObject(obj) {
    if (Array.isArray(obj)) {
        return obj.map(_normalizeComplexObject)
    } else if (obj !== null && typeof obj === 'object') {
        return Object.keys(obj).sort().reduce((result, key) => {
            result[key] = _normalizeComplexObject(obj[key])
            return result
        }, {})
    }
    return obj
}

export function _normalizeSimpleObject(obj) {
    if (Array.isArray(obj)) {
        return obj.map(_normalizeSimpleObject)
    } else if (obj !== null && typeof obj === 'object') {
        const normalized = {}
        for (const key of Object.keys(obj).sort()) {
            normalized[key] = _normalizeSimpleObject(obj[key])
        }
        return normalized
    }
    return obj
}