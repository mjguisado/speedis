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

    // When Local Requests Coalescing is enabled, this variable 
    // stores the promises associated with ongoing origin server requests.
    const ongoingFetch = opts.cache.localRequestsCoalescing
        ? new Map()
        : null
    server.decorate('ongoingFetch', ongoingFetch)
    server.addHook('onClose', (server) => {
        if (server.ongoingFetch) server.ongoingFetch.clear()
    })

    // To improve performance, we compile the regular 
    // expressions used to determine whether a URL is cacheable.
    opts.cache.cacheables.forEach(cacheable => {
        try {
            cacheable.re = new RegExp(cacheable.urlPattern)
        } catch (error) {
            server.log.fatal(error,
                `Origin: ${opts.id}. urlPattern ${cacheable.urlPattern} is not a valid regular expresion.`)
            throw new Error(`Origin: ${opts.id}. The cache configuration is invalid.`, { cause: error })
        }
    })

    // Each time a request is received, this hook checks whether it 
    // is cacheable and, if so, whether the response should be cached 
    // separately for each user.
    server.decorateRequest('cacheable')
    server.decorateRequest('cacheable_per_user')
    server.addHook('onRequest', async (request, reply) => {
        request.cacheable = false
        request.cacheable_per_user = false

        // Only the safe methods are cacheables
        // https://developer.mozilla.org/en-US/docs/Glossary/Safe/HTTP
        if (['GET', 'HEAD'].includes(request.method)) {
            for (const cacheable of opts.cache.cacheables) {
                if (cacheable.re.test(request.raw.url)) {
                    request.cacheable = true
                    request.cacheable_per_user = cacheable.perUser
                    break
                }
            }
        }
    })

    // This hook verifies that cacheable per-user requests include the user’s ID.
    // This ID is set by a hook in the OAuth2 module.
    server.addHook('preValidation', async (request, reply) => {
        if (request.cacheable_per_user && !request.session?.sub) {
            const msg = `Origin: ${opts.id}. This resource ${request.raw.url} is cacheable per user, but the user could not be determined.`
            server.log.error(msg)
            return errorHandler(reply, 401, msg, opts.exposeErrors)
        }
    })

}

// This function checks whether the request corresponds to a cache purge operation.
export function isPurgeRequest(opts, request) {
    return opts.cache
        && request.method === "DELETE"
        && request.raw.url.startsWith(purgeUrlPrefix)
}

// See: https://developer.mozilla.org/en-US/docs/Web/HTTP/Resources_and_specifications
export async function getCacheable(server, opts, request) {

    let response = {}

    // If Redis is unavailable and we shouldn't reach the origin 
    // when the cache is down, we return a 503.
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

    // https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Conditional_requests
    // https://www.rfc-editor.org/rfc/rfc9111.html#name-handling-a-received-validat
    // https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.2

    // Extract the validators
    // https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Conditional_requests#validators
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
    let ifModifiedSince = null
    if (request.headers['if-none-match']) {
        etags = request.headers['if-none-match'].match(eTagRE)
        etags = etags !== null ? etags : []
    } else if (request.headers['if-modified-since']) {
        ifModifiedSince = request.headers['if-modified-since']
    }

    // Note that an If-None-Match header field with a list value containing "*" 
    // and other values (including other instances of "*") is syntactically 
    // invalid (therefore not allowed to be generated) and furthermore 
    // is unlikely to be interoperable.
    if (etags.includes('"*"') && etags.length > 1) {
        const msg =
            `Origin: ${opts.id}. The If-None-Match header field with a list value containing "*" and other values is syntactically invalid and not allowed. ` +
            `RID: ${request.id}. Method: ${request.method}. URL: ${request.raw.url}`
        server.log.error(msg)
        response.statusCode = 400
        response.headers = {
            date: new Date().toUTCString(),
            'content-type': 'application/json',
            'x-speedis-cache-status': 'CACHE_ERROR_400 from ' + os.hostname()
        }
        if (opts.exposeErrors) { response.body = { msg: msg } }
        return response
    }

    // A request containing an If-None-Match header field indicates that 
    // the client wants to validate one or more of its own stored 
    // responses in comparison to the stored response chosen 
    // by the cache.
    let ifNoneMatchCondition = true
    if (etags.length > 0) {
        // To evaluate a received If-None-Match header field:
        if (etags[0] === '"*"') {
            // If the field value is "*", the condition is false if the 
            // origin server has a current representation for the target resource.
            if (remoteResponse.headers['x-speedis-cache-status'] &&
                (
                    remoteResponse.headers['x-speedis-cache-status'].startsWith('CACHE_HIT from') ||
                    remoteResponse.headers['x-speedis-cache-status'].startsWith('CACHE_HIT_REVALIDATED_304 from')
                )
            ) { ifNoneMatchCondition = false }
        } else if (remoteResponse.headers.etag) {
            // If the field value is a list of entity tags, the condition is false
            // if one of the listed tags matches the entity tag of the selected 
            // representation.
            let weakCacheEtag = remoteResponse.headers.etag.startsWith('W/')
                ? remoteResponse.headers.etag.substring(2)
                : remoteResponse.headers.etag
            for (let index = 0; index < etags.length; index++) {
                // A recipient MUST use the weak comparison function when
                // comparing entity tags for If-None-Match
                // https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.3.2
                let weakRequestETag = etags[index].startsWith('W/')
                    ? etags[index].substring(2)
                    : etags[index]
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
    }

    // See: https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.3   
    // A recipient MUST ignore the If-Modified-Since header if the request includes
    // an If-None-Match header. Note: ifModifiedSince is only set when the request 
    // does not include an If-None-Match header.
    // ... or the request method is neither GET nor HEAD. ( checked before )
    if (ifModifiedSince) {
        // ...or its value is not a valid single HTTP-date (requestLMD will be set to null)
        // Note: it this last case requestlmd will be set to NaN
        const requestlmd = Date.parse(ifModifiedSince)

        // https://www.rfc-editor.org/rfc/rfc9111.html#section-4.3.2
        // If a request contains an If-Modified-Since header field and the Last-Modified 
        // header field is not present in a stored response, a cache SHOULD use the 
        // stored response's Date field value (or, if no Date field is present, 
        // the time that the stored response was received) to evaluate the conditional.
        let cachelmd = NaN
        if (remoteResponse.headers['last-modified']) {
            cachelmd = Date.parse(remoteResponse.headers['last-modified'])
        } else if (remoteResponse.headers['date']) {
            cachelmd = Date.parse(remoteResponse.headers['date'])
        } else if (remoteResponse.responseTime) {
            cachelmd = remoteResponse.responseTime * 1000
        }

        if (!Number.isNaN(requestlmd) && !Number.isNaN(cachelmd) && cachelmd <= requestlmd) {
            response.statusCode = 304
            return response
        }

    }

    remoteResponse.headers['date'] = response.headers['date']
    return remoteResponse

}

export async function _get(server, opts, request) {

    // We create options for an HTTP/S request to the required path
    // based on the default ones that must not be modified.
    const requestOptions = { ...opts.origin.httpxOptions }
    if (server.agent) requestOptions.agent = server.agent

    // To make the request to the origin server, we remove from 
    // the received URL the prefix that was used to route the request
    // to this instance of the plugin
    requestOptions.path = generatePath(request)

    // Check if there is an entry stored in the cache.
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

    const requestCacheDirectives = utils.parseCacheControlHeader(request)
    const fieldNames = utils.parseVaryHeader(request)
    let cachedCacheDirectives = null

    if (cachedResponse) {

        cachedResponse.path = requestOptions.path

        // Apply transformations to the entry fetched from the cache
        if (opts.bff) bff.transform(opts, bff.CACHE_RESPONSE, cachedResponse)

        // See: https://www.rfc-editor.org/rfc/rfc9111.html#name-calculating-freshness-lifet
        const freshnessLifetime = utils.calculateFreshnessLifetime(cachedResponse)

        // See: https://www.rfc-editor.org/rfc/rfc9111.html#name-calculating-age
        const currentAge = utils.calculateAge(cachedResponse)

        const fresh = freshnessLifetime - currentAge

        // We calculate whether the cache entry is fresh or stale.
        let responseIsFresh = fresh >= 0

        // See: https://www.rfc-editor.org/rfc/rfc9111.html#cache-request-directive.max-age
        const maxAge = parseInt(requestCacheDirectives['max-age'])
        if (!Number.isNaN(maxAge) && currentAge > maxAge) {
            responseIsFresh = false
        }
        // See: https://www.rfc-editor.org/rfc/rfc9111.html#cache-request-directive.min-fresh
        const minFresh = parseInt(requestCacheDirectives['min-fresh'])
        if (!Number.isNaN(minFresh) && fresh < minFresh) {
            responseIsFresh = false
        }
        // See: https://www.rfc-editor.org/rfc/rfc9111.html#cache-request-directive.max-stale
        const maxStale = parseInt(requestCacheDirectives['max-stale'])
        if (!Number.isNaN(maxStale) && -maxStale <= fresh) {
            responseIsFresh = true
        }

        /*
        * See: https://www.rfc-editor.org/rfc/rfc9111.html#name-no-cache
        * See: https://www.rfc-editor.org/rfc/rfc9111.html#name-no-cache-2
        * See: https://www.rfc-editor.org/rfc/rfc9111.html#cache-request-directive.no-store
        * 
        * Note that if a request containing the no-store directive is satisfied
        * from a cache, the no-store request directive does not apply to the 
        * already stored response.
        */
        cachedCacheDirectives = utils.parseCacheControlHeader(cachedResponse)
        if (responseIsFresh
            && !Object.prototype.hasOwnProperty.call(requestCacheDirectives, 'no-cache')
            && (!Object.prototype.hasOwnProperty.call(cachedCacheDirectives, 'no-cache')
                // The qualified form of the no-cache response directive
                || cachedCacheDirectives['no-cache'] !== null)
            // https://www.rfc-editor.org/rfc/rfc9111.html#name-calculating-cache-keys-with
            // A stored response with a Vary header field value containing a member "*" always fails to match
            && !fieldNames.includes('*')) {
            // The response stored in the cache is valid.
            cachedResponse.headers['x-speedis-cache-status'] = 'CACHE_HIT from ' + os.hostname()
            // The presence of an Age header field implies that the response was not generated 
            // or validated by the origin server for this request.
            cachedResponse.headers['age'] = currentAge
            return cachedResponse
        } else {
            // We need to revalidate the response.
            if (Object.prototype.hasOwnProperty.call(cachedResponse.headers, 'etag')) {
                requestOptions.headers['if-none-match'] = cachedResponse.headers['etag']
            } else if (Object.prototype.hasOwnProperty.call(cachedResponse.headers, 'last-modified')) {
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
    let lockKey = null
    let lockValue = null
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

        if (amITheFetcher && opts.cache.localRequestsCoalescing) 
            server.ongoingFetch.delete(request.urlKey)

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
            // There is a response stored in the cache, and we tried to refresh it  
            // using a conditional request to the origin, which failed.  
            // The stale response IS being reused.
            cachedResponse.headers['x-speedis-cache-status'] = 'CACHE_HIT_NOT_REVALIDATED_STALE from ' + os.hostname()
            cachedResponse.headers['age'] = utils.calculateAge(cachedResponse)
            return cachedResponse
        } else {
            const generatedResponse = {
                headers: {
                    date: new Date().toUTCString()
                }
            }
            if (cachedResponse) {
                // There is a response stored in the cache, and we tried to refresh it  
                // using a conditional request to the origin, which failed.  
                // The stale response IS NOT being reused.                
                generatedResponse.headers['x-speedis-cache-status'] = 'CACHE_HIT_NOT_REVALIDATED from ' + os.hostname()
            } else {
                // There is no response stored in the cache, and we tried to request it  
                // to the origin, which failed.  
                generatedResponse.headers['x-speedis-cache-status'] = 'CACHE_FAILED_MISS from ' + os.hostname()
            }
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
        // See: https://www.rfc-editor.org/rfc/rfc9111.html#name-no-store
        && !Object.prototype.hasOwnProperty.call(requestCacheDirectives, 'no-store')
        // See: https://www.rfc-editor.org/rfc/rfc9111.html#name-storing-responses-in-caches
        && isStorableResponse(originResponse, originCacheDirectives)

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
    if (Object.prototype.hasOwnProperty.call(requestCacheDirectives, 'only-if-cached')
        && cachedResponse == null) {
        return generatedResponse = {
            statusCode: 504,
            headers: {
                'date': new Date().toUTCString(),
                'x-speedis-cache-status': 'CACHE_MISS from ' + os.hostname()
            }
        }
    }

    if (originResponse.statusCode === 304) {
        // There is a response stored in the cache, and it has been refreshed 
        // using a conditional request to the origin, which replied with a 304.
        cachedResponse.headers['x-speedis-cache-status'] = 'CACHE_HIT_REVALIDATED_304 from ' + os.hostname()
        return utils.cloneAndTrimResponse(cachedResponse)
    } else {
        if (cachedResponse) {
            // There is a response stored in the cache, and it has been refreshed 
            // using a conditional request to the origin, which replied with a 200.
            originResponse.headers['x-speedis-cache-status'] = 'CACHE_HIT_REVALIDATED from ' + os.hostname()
        } else {
            // There is no response stored in the cache.
            originResponse.headers['x-speedis-cache-status'] = 'CACHE_MISS from ' + os.hostname()
        }
        return utils.cloneAndTrimResponse(originResponse)
    }

}

/**
 * Acquire a lock to make a request to the origin server.
 */
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
/**
 * Releases the lock acquired to make a request to the origin server.
 */
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

/**
 * This function checks whether the response received from the origin is 
 * can be stored in the cache according to the HTTP/1.1 specification, 
 * specifically RFC 9111.
 * https://www.rfc-editor.org/rfc/rfc9111.html#name-storing-responses-in-caches
 * @param {*} originResponse 
 * @param {*} originCacheDirectives 
 * @returns 
 */
function isStorableResponse(originResponse, originCacheDirectives) {
    let isTheResponseCacheable =
        // The request method is always GET & HEAD
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
            // The qualified form of the private response directive
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
