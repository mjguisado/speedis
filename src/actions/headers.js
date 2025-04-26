import { createHash } from "crypto"
import { calculateFreshnessLifetime } from '../utils/utils.js'

export function setHeaders(target, params) {
    for (var header in params) {
        target.headers[header.toLowerCase()] = params[header]
    }
}

export function deleteHeaders(target, params) {
    for (var header in params) {
        delete target.headers[header.toLowerCase()]
    }
}

export function setLastModifiedAndDateHeaders(target, params) {
    let now = new Date().toUTCString();
    target.headers["last-modified"] = now
    target.headers["date"] = now
}

/*
 * 
 * The `ttl` attribute is used to define the expiration time of a cache entry in Redis.
 * If `ttl` is set to 0, the cache entry will not expire.
 * 
 * The TTL of an entry should be calculated according to rules established by the standard.
 * See: https://tools.ietf.org/html/rfc7234#section-4.2.1
 *
 * This function is deprecated and will be removed in future versions.
 * 
 */
function setTTL(target, params) {
    /*
     * To avoid a large set of entries from expiring simultaneously,
     * the TTL can be randomly selected for each entry within a specific interval.
     * This helps prevent the simultaneous refresh of cache entries from 
     * causing overload on the origin.
     */
    // Why in case of an error or a redirection, the default TTL is not applied?
    // No debería ser aplicado sólo para los 200 y 204 .... o < 300?
    if (Object.prototype.hasOwnProperty.call(params, 'ttl')
        && target.statusCode !== 301
        && target.statusCode !== 302
        && target.statusCode !== 404
        && target.statusCode !== 410) {
        if (!Array.isArray(params.ttl)) {
            target.ttl = params.ttl
        } else {
            const min = params.ttl[0]
            const max = params.ttl[1]
            target.ttl = Math.floor(Math.random() * (max - min + 1) + min)
        }
    } else {
        target.ttl = calculateFreshnessLifetime(target)
    }
}
