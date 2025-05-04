import path from 'path'
import os from 'os'
import * as crypto from 'crypto'
import { generatePath, _fetch } from './origin.js'
import * as utils from '../utils/utils.js'
import * as bff from './bff.js'
import { errorHandler } from './error.js'

let purgeUrlPrefix

export function initCache(server, opts) {

    purgeUrlPrefix = path.join(opts.prefix, opts.cache.purgePath)

    const ongoingFetch = opts.cache.localRequestsCoalescing
        ? new Map()
        : null
    server.decorate('ongoingFetch', ongoingFetch)
    server.addHook('onClose', (server) => {
        if (server.ongoingFetch) server.ongoingFetch.clear()
    })    

    opts.cache.cacheables.forEach(cacheable => {
        try {
            cacheable.re = new RegExp(cacheable.urlPattern)
        } catch (error) {
            server.log.fatal(error,
                `Origin: ${opts.id}. urlPattern ${cacheable.urlPattern} is not a valid regular expresion.`)
            throw new Error(`Origin: ${opts.id}. The cache configuration is invalid.`, { cause: error })
        }
    })

    server.decorateRequest('cacheable')
    server.decorateRequest('cacheable_per_user')
    server.addHook('onRequest', async (request, reply) => {
        request.cacheable = false
        request.cacheable_per_user = false
        if ('GET' === request.method) {
            for (const cacheable of opts.cache.cacheables) {
                if (cacheable.re.test(request.raw.url)) {
                    request.cacheable = true
                    request.cacheable_per_user = cacheable.perUser
                    break
                }
            }
        }
    })

    server.addHook('preValidation', async (request, reply) => {
        if (request.cacheable_per_user && !request.session?.sub) {
            const msg = `Origin: ${opts.id}. This resource ${request.raw.url} is cacheable per user, but the user could not be determined.`
            server.log.error(msg)
            return errorHandler(reply, 401, msg, opts.exposeErrors)
        }
    })

}

export function isPurgeRequest(opts, request) {
    return opts.cache
        && request.method === "DELETE"
        && request.raw.url.startsWith(purgeUrlPrefix)
}

// See: https://developer.mozilla.org/en-US/docs/Web/HTTP/Resources_and_specifications
export async function getCacheable(server, opts, request) {

    let response = {}

    // If Redis is unavailable and we can’t reach the origin when the 
    // cache is down, we return a 503.
    if (server.redisBreaker &&
        server.redisBreaker.opened &&
        opts.redis.disableOriginOnRedisOutage) {
        const msg = `Origin: ${opts.id}. Redis is temporarily unavailable. Please try again later.`
        server.log.error(msg)
        response.statusCode = 503
        response.headers = {
            date: new Date().toUTCString(),
            'content-type': 'application/json',
            'x-speedis-cache-status': 'CACHE_REDIS_OUTAGE from ' + os.hostname()
        }
        if (opts.exposeErrors) { response.body = { msg: msg } }
        return response
    }

    let remoteResponse = null
    try {
        let tries = 1
        remoteResponse = await _get(server, opts, request)
        // If the previous _get execution returned -1, it means
        // that distributed Requests Coalescing is enabled and 
        // it couldn't acquire the lock to make a request to the
        // origin. Therefore, the opts.cache.distributedRequestsCoalescingOptions
        // should exist, with all its attributes being mandatory.   
        while (remoteResponse === -1
            && tries < opts.cache.distributedRequestsCoalescingOptions.retryCount
            && !server.redisBreaker.opened) {
            let delay = opts.cache.distributedRequestsCoalescingOptions.retryDelay +
                Math.round(Math.random() * opts.cache.distributedRequestsCoalescingOptions.retryJitter)
            await new Promise(resolve => setTimeout(resolve, delay))
            remoteResponse = await _get(server, opts, request)
            tries++
        }
        if (remoteResponse === -1) {
            const msg = `Origin: ${opts.id}. Cache is temporarily unavailable due to lock acquisition failure. Please try again later.`
            server.log.error(msg)
            response.statusCode = 503
            response.headers = {
                date: new Date().toUTCString(),
                'content-type': 'application/json',
                'x-speedis-cache-status': 'CACHE_NO_LOCK from ' + os.hostname()
            }
            if (opts.exposeErrors) { response.body = { msg: msg } }
            return response
        }
    } catch (error) {
        const msg =
            `Origin: ${opts.id}. Failed to retrieve the requested resource. ` +
            `RID: ${request.id}. Method: ${request.method}. URL: ${request.raw.url}`
        server.log.error(error, msg)
        response.statusCode = 500
        response.headers = {
            date: new Date().toUTCString(),
            'content-type': 'application/json',
            'x-speedis-cache-status': 'CACHE_ERROR_500 from ' + os.hostname()
        }
        if (opts.exposeErrors) { response.body = { msg: msg } }
        return response
    }

    // We have a response from the cache or the origin.
    // Check if we have received a conditional request.
    /*
    https://www.rfc-editor.org/rfc/rfc9110#name-etag
    ETag       = entity-tag
    entity-tag = [ weak ] opaque-tag
    weak       = %s"W/"
    opaque-tag = DQUOTE *etagc DQUOTE
    etagc      = %x21 / %x23-7E / obs-text
      ; VCHAR except double quotes, plus obs-text
    entity-tag = (W/)*\x22([\x21\x23-\x7E\x80-\xFF])*\x22
    weak       = W/
    opaque-tag = \x22([\x21\x23-\x7E\x80-\xFF])*\x22
    etag       = [\x21\x23-\x7E\x80-\xFF]
    */
    const eTagRE = /(?:W\/)*\x22(?:[\x21\x23-\x7E\x80-\xFF])*\x22/g
    let etags = []
    let lastModified = null
    for (let header in request.headers) {
        switch (header) {
            case 'if-none-match':
                etags = request.headers[header].match(eTagRE)
                etags = etags !== null ? etags : []
                break
            case 'if-modified-since':
                lastModified = request.headers[header]
                break
        }
    }

    // See: https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.2
    let ifNoneMatchCondition = true
    if (etags.length > 0) {
        if (etags.length === 1 && etags[0] === '"*"') {
            if (response?.statusCode === 200) {
                ifNoneMatchCondition = false
            }
        } else if (remoteResponse.headers?.etag) {
            let weakCacheEtag = remoteResponse.headers.etag.startsWith('W/')
                ? remoteResponse.headers.etag.substring(2) : remoteResponse.headers.etag
            for (let index = 0; index < etags.length; index++) {
                // A recipient MUST use the weak comparison function when
                // comparing entity tags for If-None-Match
                // https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.3.2
                let weakRequestETag = etags[index].startsWith('W/')
                    ? etags[index].substring(2) : etags[index]
                if (weakRequestETag === weakCacheEtag) {
                    ifNoneMatchCondition = false
                    break
                }
            }
        }
    }

    response.headers = {
        date: new Date().toUTCString(),
        'x-speedis-cache-status': remoteResponse.headers['x-speedis-cache-status']
    }
    if (!ifNoneMatchCondition) {
        response.statusCode = 304
        return response
    } else {
        // See: https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.3
        let ifModifiedSinceCondition = true
        if (!Object.prototype.hasOwnProperty.call(request.headers, 'if-none-match')) {
            let requestlmd = lastModified
                ? Date.parse(lastModified)
                : NaN
            let cachelmd = remoteResponse.headers['last-modified']
                ? Date.parse(remoteResponse.headers['last-modified'])
                : NaN
            if (!Number.isNaN(requestlmd) && !Number.isNaN(cachelmd) && cachelmd <= requestlmd) {
                ifModifiedSinceCondition = false
            }
        }
        if (!ifModifiedSinceCondition) {
            response.statusCode = 304
            return response
        } else {
            remoteResponse.headers['date'] = response.headers['date']
            return remoteResponse
        }
    }
}

export async function _get(server, opts, request) {

    // We create options for an HTTP/S request to the required path
    // based on the default ones that must not be modified.
    const requestOptions = { ...opts.origin.httpxOptions }
    requestOptions.path = generatePath(request)
    if (server.agent) requestOptions.agent = server.agent

    const clientCacheDirectives = utils.parseCacheControlHeader(request)
    const fieldNames = utils.parseVaryHeader(request)

    let cachedResponse = null
    try {
        cachedResponse = server.redisBreaker
            ? await server.redisBreaker.fire('json.get', [request.urlKey])
            : await server.redis.json.get(request.urlKey)
    } catch (error) {
        server.log.warn(error,
            `Origin: ${opts.id}. Error querying the cache entry in Redis. ` +
            `RID: ${request.id}. URL Key: ${request.urlKey}.`)
    }

    let cachedCacheDirectives = null

    if (cachedResponse) {

        // Apply transformations to the entry fetched from the cache
        cachedResponse.path = requestOptions.path
        if (opts.bff) bff.transform(opts, bff.CACHE_RESPONSE, cachedResponse)

        // See: https://www.rfc-editor.org/rfc/rfc9111.html#name-calculating-freshness-lifet
        const freshnessLifetime = utils.calculateFreshnessLifetime(cachedResponse)

        // See: https://www.rfc-editor.org/rfc/rfc9111.html#name-calculating-age
        const currentAge = utils.calculateAge(cachedResponse)

        // We calculate whether the cache entry is fresh or stale.
        let responseIsFresh = (currentAge <= freshnessLifetime)

        // See: https://www.rfc-editor.org/rfc/rfc9111.html#cache-request-directive.max-age
        if (Object.prototype.hasOwnProperty.call(clientCacheDirectives, 'max-age')) {
            const maxAge = parseInt(clientCacheDirectives['max-age'])
            if (!Number.isNaN(maxAge) && currentAge > maxAge) {
                responseIsFresh = false
            }
        }
        // See: https://www.rfc-editor.org/rfc/rfc9111.html#cache-request-directive.min-fresh
        if (Object.prototype.hasOwnProperty.call(clientCacheDirectives, 'min-fresh')) {
            const minFresh = parseInt(clientCacheDirectives['min-fresh'])
            const fresh = freshnessLifetime - currentAge
            if (!Number.isNaN(minFresh) && fresh < minFresh) {
                responseIsFresh = false
            }
        }
        // See: https://www.rfc-editor.org/rfc/rfc9111.html#cache-request-directive.max-stale
        if (Object.prototype.hasOwnProperty.call(clientCacheDirectives, 'max-stale')) {
            const maxStale = parseInt(clientCacheDirectives['max-stale'])
            const fresh = freshnessLifetime - currentAge
            if (!Number.isNaN(maxStale) && -maxStale <= fresh) {
                responseIsFresh = true
            }
        }

        /*
        * See: https://www.rfc-editor.org/rfc/rfc9111.html#name-no-cache
        * See: https://www.rfc-editor.org/rfc/rfc9111.html#name-no-cache-2
        * See: https://www.rfc-editor.org/rfc/rfc9111.html#cache-request-directive.no-store
        * Note that if a request containing the no-store directive is
        * satisfied from a cache, the no-store request directive does
        * not apply to the already stored response.
        */
        cachedCacheDirectives = utils.parseCacheControlHeader(cachedResponse)

        if (responseIsFresh
            && !Object.prototype.hasOwnProperty.call(clientCacheDirectives, 'no-cache')
            && (!Object.prototype.hasOwnProperty.call(cachedCacheDirectives, 'no-cache')
                // The qualified form of the no-cache response directive
                || cachedCacheDirectives['no-cache'] !== null)
            // https://www.rfc-editor.org/rfc/rfc9111.html#name-calculating-cache-keys-with
            // A stored response with a Vary header field value containing a member "*" always fails to match
            && !fieldNames.includes('*')) {
            utils.setCacheStatus('CACHE_HIT', cachedResponse)
            cachedResponse.headers['age'] = utils.calculateAge(cachedResponse)
            return cachedResponse
        } else {
            // We need to revalidate the response.
            if (Object.prototype.hasOwnProperty.call(cachedResponse.headers, 'etag')) {
                requestOptions.headers['if-none-match'] = cachedResponse.headers['etag']
            }
            if (Object.prototype.hasOwnProperty.call(cachedResponse.headers, 'last-modified')) {
                requestOptions.headers['if-modified-since'] = cachedResponse.headers['last-modified']
            }
        }

    }

    // If localRequestsCoalescing is enabled, only the first request
    // will contact the origin to prevent overloading it.
    let amITheFetcher = false

    // Make the request to the origin
    let originResponse = null
    let requestTime = null
    let responseTime = null
    let lockKey, lockValue
    let locked = false

    try {

        // Verify if there is an ongoing fetch operation
        let fetch = null
        if (opts.cache.localRequestsCoalescing) {
            fetch = server.ongoingFetch.get(request.urlKey)
        }

        if (!fetch) {
            // https://redis.io/docs/latest/develop/use/patterns/distributed-locks/#correct-implementation-with-a-single-instance
            if (opts.cache.distributedRequestsCoalescing) {
                lockKey = `${request.urlKey}.lock`
                lockValue = `${process.pid}:${opts.id}:${request.id}:` + crypto.randomBytes(4).toString("hex")
                locked = await _adquireLock(server, opts, lockKey, lockValue)
            }

            if (opts.cache.distributedRequestsCoalescing && !locked) {
                // At this point, we should have acquired a lock to make a request to
                // the origin, but we haven’t. So, we return -1 to indicate that the
                // entire function should be retried, as another thread could have
                // modified the cache entry in the meantime.
                return -1
            }

            if (request.session?.access_token) {
                requestOptions.headers['authorization'] = `Bearer ${request.session.access_token}`
            }
            // Apply transformations to the request before sending it to the origin
            if (opts.bff) bff.transform(opts, bff.ORIGIN_REQUEST, requestOptions)

            if (server.originBreaker) {
                fetch = server.originBreaker.fire(opts, requestOptions, request.body)
            } else {
                fetch = _fetch(opts, requestOptions, request.body)
            }
            if (opts.cache.localRequestsCoalescing) server.ongoingFetch.set(request.urlKey, fetch)
            amITheFetcher = true
        }

        // The current value of the clock at the host at the time the
        // request resulting in the stored response was made.
        requestTime = Date.now() / 1000 | 0

        // Fecth
        originResponse = await fetch

        // The current value of the clock at the host at the time the
        // response was received.
        responseTime = Date.now()

        // Apply transformations to the response received from the origin
        originResponse.path = requestOptions.path
        if (opts.bff) bff.transform(opts, bff.ORIGIN_RESPONSE, originResponse)

        // Unsure that we have a valid Date Header
        utils.ensureValidDateHeader(originResponse, responseTime)

        // We reduce precision once it’s no longer needed to ensure the Date header.
        responseTime = responseTime / 1000 | 0

        // We set the attributes involved in calculating the
        // age of the content.
        originResponse.requestTime = requestTime
        originResponse.responseTime = responseTime

    } catch (error) {

        if (opts.cache.distributedRequestsCoalescing && locked) 
            await _releaseLock(server, opts, lockKey, lockValue)
        if (amITheFetcher && opts.cache.localRequestsCoalescing) server.ongoingFetch.delete(request.urlKey)
        delete requestOptions.agent

        server.log.error(error,
            `Origin ${opts.id}. Error requesting to the origin. ` +
            `RID: ${request.id}. Method: ${request.method}. URL: ${request.raw.url}`)

        /*
        * If I was trying to refresh a cache entry,
        * I may consider serving the stale content.
        */
        // https://www.rfc-editor.org/rfc/rfc9111.html#cache-response-directive.must-revalidate
        if (cachedResponse
            && !Object.prototype.hasOwnProperty.call(cachedCacheDirectives, 'must-revalidate')
            && !Object.prototype.hasOwnProperty.call(cachedCacheDirectives, 'proxy-revalidate')) {
            server.log.warn(
                `Origin: ${opts.id}. Serving stale content from cache. ` +
                `RID: ${request.id}. URL Key: ${request.urlKey}.`
            )
            utils.setCacheStatus('CACHE_HIT_NOT_REVALIDATED_STALE', cachedResponse)
            cachedResponse.headers['age'] = utils.calculateAge(cachedResponse)
            return cachedResponse
        } else {
            const generatedResponse = {
                headers: {
                    date: new Date().toUTCString()
                }
            }
            utils.setCacheStatus(
                cachedResponse ? 'CACHE_HIT_NOT_REVALIDATED' : 'CACHE_FAILED_MISS',
                generatedResponse
            )
            switch (error.code) {
                case 'ETIMEDOUT':
                    generatedResponse.statusCode = 504
                    break
                case 'EOPENBREAKER':
                    generatedResponse.statusCode = 503
                    if (originBreaker.options.resetTimeout) {
                        generatedResponse.headers['retry-after'] = originBreaker.retryAfter
                    }
                    break
                default:
                    generatedResponse.statusCode = 500
                    break
            }
            return generatedResponse
        }
    }

    if (amITheFetcher && opts.cache.localRequestsCoalescing) {
        server.ongoingFetch.delete(request.urlKey)
    }

    // We parse the Cache-Control header to extract cache directives.
    const originCacheDirectives = utils.parseCacheControlHeader(originResponse)

    let writeCache = amITheFetcher
        && !Object.prototype.hasOwnProperty.call(clientCacheDirectives, 'no-store')
        && isCacheable(originResponse, originCacheDirectives)
    // See: https://www.rfc-editor.org/rfc/rfc9111.html#name-no-store
    // See: https://www.rfc-editor.org/rfc/rfc9111.html#name-storing-responses-in-caches

    // We generate a cache entry from the response.
    const cacheEntry = utils.cloneAndTrimResponse(originResponse)
    utils.cleanUpHeader(cacheEntry, originCacheDirectives)

    // The HTTP 304 status code, “Not Modified,” tells the client that the
    // requested resource hasn't changed since the last access
    // See: https://www.rfc-editor.org/rfc/rfc9111.html#freshening.responses
    // See: https://www.rfc-editor.org/rfc/rfc9111.html#name-freshening-responses-with-h
    if (originResponse.statusCode === 304) {

        // We set the attributes involved in calculating the age of the content.
        cachedResponse.requestTime = cacheEntry.requestTime
        cachedResponse.responseTime = cacheEntry.responseTime
        // See: https://www.rfc-editor.org/rfc/rfc9111#name-updating-stored-header-fiel
        for (let header in cacheEntry.headers) {
            if ('content-length' !== header) {
                cachedResponse.headers[header] = cacheEntry.headers[header]
            }
        }

        if (writeCache) {
            try {
                // Apply transformations to the cache entry before storing it in the cache.
                if (opts.bff) bff.transform(opts, bff.CACHE_REQUEST, cachedResponse)

                // Update the cache
                const ttl = parseInt(cachedResponse.ttl)
                const payload = {
                    requestTime: cachedResponse.requestTime,
                    responseTime: cachedResponse.responseTime,
                    headers: cachedResponse.headers
                }
                server.redisBreaker
                    ? await server.redisBreaker.fire('json.merge', [request.urlKey, '$', payload])
                    : await server.redis.json.merge(request.urlKey, '$', payload)
                // Set the TTL for the cache entry           
                if (!Number.isNaN(ttl) && ttl > 0) {
                    server.redisBreaker
                        ? await server.redisBreaker.fire('expire', [request.urlKey, ttl])
                        : await server.redis.expire(request.urlKey, ttl)
                }
            } catch (error) {
                server.log.warn(error,
                    `Origin: ${opts.id}. Error while updating the cache. ` +
                    `RID: ${request.id}. URL Key: ${request.urlKey}.`)
            }
        }
    } else {

        if (writeCache) {
            // Apply transformations to the cache entry before storing it in the cache.
            if (opts.bff) bff.transform(opts, bff.CACHE_REQUEST, cacheEntry)
            const ttl = parseInt(cacheEntry.ttl)
            try {
                server.redisBreaker
                    ? await server.redisBreaker.fire('json.set', [request.urlKey, '$', cacheEntry])
                    : await server.redis.json.set(request.urlKey, '$', cacheEntry)
                // Set the TTL for the cache entry           
                if (!Number.isNaN(ttl) && ttl > 0) {
                    server.redisBreaker
                        ? await server.redisBreaker.fire('expire', [request.urlKey, ttl])
                        : await server.redis.expire(request.urlKey, ttl)
                }
            } catch (error) {
                server.log.warn(error,
                    `Origin: ${opts.id}. Error while storing in the cache. ` +
                    `RID: ${request.id}. URL Key: ${request.urlKey}.`)
            }
        }

    }

    /*
    * If the origin server response included Cache-Control: no-store,
    * it should not have been stored in the cache at all.
    * If, by mistake, it was stored, you must delete it immediately.
    *
    * If the origin server response included Cache-Control: private,
    * a shared caches should not store it in the cache at all.
    * If a shared cache has already stored the response by mistake,
    * it is recommended to delete it to comply with the directive.
    */
    if (Object.prototype.hasOwnProperty.call(originCacheDirectives, 'no-store')
        // The unqualified form of the private response directive
        || (Object.prototype.hasOwnProperty.call(originCacheDirectives, 'private')
            && originCacheDirectives['private'] === null)) {
        try {
            server.redisBreaker
                ? await server.redisBreaker.fire('unlink', [request.urlKey])
                : await server.redis.unlink(request.urlKey)
        } catch (error) {
            server.log.warn(error,
                `Origin: ${opts.id}. Error while removing private/no-store entry in the cache. ` +
                `RID: ${request.id}. URL Key: ${request.urlKey}.`)
        }
    }

    // In this point the Cache Entry has been updated or deleted in Redis.
    if (opts.cache.distributedRequestsCoalescing && locked) 
        await _releaseLock(server, opts, lockKey, lockValue)

    // See: https://www.rfc-editor.org/rfc/rfc9111.html#cache-request-directive.only-if-cached
    if (Object.prototype.hasOwnProperty.call(clientCacheDirectives, 'only-if-cached')
        && cachedResponse == null) {
        const generatedResponse = {
            statusCode: 504,
            headers: {
                'date': new Date().toUTCString()
            }
        }
        utils.setCacheStatus('CACHE_MISS', generatedResponse)
        return generatedResponse
    }

    if (originResponse.statusCode === 304) {
        utils.setCacheStatus('CACHE_HIT_REVALIDATED_304', cachedResponse)
        return utils.cloneAndTrimResponse(cachedResponse)
    } else {
        utils.setCacheStatus(
            cachedResponse ? 'CACHE_HIT_REVALIDATED' : 'CACHE_MISS', originResponse
        )
        return utils.cloneAndTrimResponse(originResponse)
    }

}

async function _adquireLock(server, opts, lockKey, lockValue) {
    let lockTTL
    // In JavaScript, when comparing a number with undefined, 
    // the engine converts undefined to NaN (Not a Number)
    // Any comparison involving NaN is always false.
    // This is a core rule in JavaScript.
    if (opts.cache.distributedRequestsCoalescingOptions?.lockTTL > 0) {
        lockTTL = opts.cache.distributedRequestsCoalescingOptions?.lockTTL
    } else if (opts.origin.originTimeout > 0) {
        lockTTL = Math.round(opts.origin.originTimeout * 1.2)
    } else {
        lockTTL = Math.round(Math.random() * 10000)
    }

    let locked = false
    try {
        let lockResponse = server.redisBreaker
            ? await server.redisBreaker.fire('set', [lockKey, lockValue, { NX: true, PX: lockTTL }])
            : await server.redis.set(lockKey, lockValue, { NX: true, PX: lockTTL })
        locked = ('OK' === lockResponse)
    } catch (error) {
        server.log.warn(error,
            `Origin: ${opts.id}. Error acquiring the lock. ` +
            `RID: ${request.id}. Lock key: ${lockKey}. Lock value: ${lockValue}. Lock TTL: ${lockTTL}.`)
    } finally {
        return locked
    }
}

// Remove the key only if it exists and the value stored at the  key
// is exactly the one I expect to be
const releaseLockScript = `
    if redis.call("get",KEYS[1]) == ARGV[1] then
      return redis.call("unlink",KEYS[1])
    else
      return 0
    end
  `
const releaseLockScriptSHA1 = crypto.createHash('sha1').update(releaseLockScript).digest('hex')
async function _releaseLock(server, opts, lockKey, lockValue) {
    try {
        const exists = server.redisBreaker
            ? await server.redisBreaker.fire('script exists', [releaseLockScriptSHA1])
            : await server.redis.scriptExists(releaseLockScriptSHA1)
        if (!exists[0]) {
            server.redisBreaker
                ? await server.redisBreaker.fire('script load', [releaseLockScript])
                : await server.redis.scriptLoad(releaseLockScript)
        }
        server.redisBreaker
            ? await server.redisBreaker.fire('evalsha', [
                releaseLockScriptSHA1,
                {
                    keys: [lockKey],
                    arguments: [lockValue]
                }
            ])
            : await server.redis.evalSha(
                releaseLockScriptSHA1,
                {
                    keys: [lockKey],
                    arguments: [lockValue]
                }
            )
    } catch (error) {
        server.log.warn(error,
            `Origin: ${opts.id}. Error releasing the lock. ` +
            `RID: ${request.id}. Lock key: ${lockKey}. Lock value: ${lockValue}.`)
    }
}

// See: https://www.rfc-editor.org/rfc/rfc9111.html#name-storing-responses-in-caches
function isCacheable(originResponse, originCacheDirectives) {
    let isTheResponseCacheable =
        // The request method is always GET
        // The response status code is final
        originResponse.statusCode >= 200
        // This cache doesn't understands Partial Content
        && originResponse.statusCode !== 206
        // This cache understands 304 Not Modified
        // && originResponse.statusCode !== 304

        // TODOD: Implements support for the must-understand cache directive
        // In this context, a cache has "understood" a request method or a
        // response status code if it recognizes it and implements all
        // specified caching-related behavior.
        // https://www.rfc-editor.org/rfc/rfc9111.html#cache-response-directive.must-understand

        // See: https://www.rfc-editor.org/rfc/rfc9111.html#name-no-store-2
        && !Object.prototype.hasOwnProperty.call(originCacheDirectives, 'no-store')
        // See: https://www.rfc-editor.org/rfc/rfc9111.html#name-private
        && (!Object.prototype.hasOwnProperty.call(originCacheDirectives, 'private')
            // // The qualified form of the private response directive
            || originCacheDirectives['private'] !== null
        )
        && (!Object.prototype.hasOwnProperty.call(originResponse.headers, 'authorization')
            || Object.prototype.hasOwnProperty.call(originCacheDirectives, 'must-revalidate')
            || Object.prototype.hasOwnProperty.call(originCacheDirectives, 'public')
            || Object.prototype.hasOwnProperty.call(originCacheDirectives, 's-maxage')
        )
        && (Object.prototype.hasOwnProperty.call(originCacheDirectives, 'public')
            || Object.prototype.hasOwnProperty.call(originResponse.headers, 'expires')
            || Object.prototype.hasOwnProperty.call(originCacheDirectives, 'max-age')
            || Object.prototype.hasOwnProperty.call(originCacheDirectives, 's-maxage')
            //  || a cache extension that allows it to be cached
            //  || a status code that is defined as heuristically cacheable
        )
    return isTheResponseCacheable
}

export async function purge(server, opts, request, reply) {

    const toTrash = opts.cache.purgePath.slice(1) + ':'
    const cacheEviction = request.urlKey.replace(toTrash, "")
    const now = new Date().toUTCString()

    try {
        let result = 0
        // See: https://antirez.com/news/93
        if (cacheEviction.indexOf('*') > -1) {
            // See: https://github.com/redis/node-redis/blob/master/docs/scan-iterators.md
            // See: https://github.com/redis/node-redis/blob/master/docs/v4-to-v5.md#scan-iterators
            for await (const entry of server.redis.scanIterator({
                MATCH: cacheEviction,
                COUNT: 100
            })) {
                result += await server.redis.unlink((entry))
            }
        } else {
            result = await server.redis.unlink(cacheEviction)
        }
        if (result) {
            return reply.code(204).headers({ date: now }).send()
        } else {
            return reply.code(404).headers({ date: now }).send()
        }
    } catch (error) {
        const msg =
            `Origin: ${opts.id}. Error purging the cache in Redis. ` +
            `RID: ${request.id}. URL Key pattern: ${cacheEviction}.`
        server.log.error(error, msg)
        return errorHandler(reply, 500, msg, opts.exposeErrors, error)
    }
}
