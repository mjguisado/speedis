import { createHash } from "crypto"
import { calculateFreshnessLifetime } from '../utils/utils.js'
import jp from 'jsonpath';

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

export function setETagHeader(target, params) {
    target.headers["etag"] = createHash("md5").update(JSON.stringify(target.body)).digest("hex")
}

export function replaceAllInBody(target, params) {
    for (var param in params) {
        target.body.replace[param] = params[param];
    }
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

export function deleteJsonPaths(target, params) {
    let body = null;
    try {
        body = JSON.parse(target.body)
    } catch (error) {
        console.error(`Error parsing JSON: ${error.message}`);
        return;
    }
    if (Object.prototype.hasOwnProperty.call(params, 'jsonpaths')) {
        params.jsonpaths.forEach(path => {
            try {
                jp.paths(body, path).forEach(p => {
                    let ref = body;
                    for (let i = 1; i < p.length - 1; i++) {
                        ref = ref[p[i]];
                        if (!ref) return;
                    }
                    delete ref[p[p.length - 1]];
                })
            } catch (error) {
                console.error(`Error deleting JSON elements: ${error.message}`);                
            }
        })
    }
    if (body) target.body = JSON.stringify(body)
}

export function keepJsonPaths(target, params) {
    let result = {};
    let body = null;
    try {
        body = JSON.parse(target.body)
    } catch (error) {
        console.error(`Error parsing JSON: ${error.message}`);
        return;
    }
    if (Object.prototype.hasOwnProperty.call(params, 'jsonpaths')) {
        params.jsonpaths.forEach(path => {
            try {
                jp.paths(body, path).forEach(p => {
                    let value = jp.value(body, jp.stringify(p));
                    let ref = result;
                    let pathArray = p.slice(1)
                    for (let i = 0; i < pathArray.length - 1; i++) {
                        ref = ref[pathArray[i]] = ref[pathArray[i]] || {};
                    }
                    ref[pathArray[pathArray.length - 1]] = value;
                })
            } catch (error) {
                console.error(`Error keeping JSON elements: ${error.message}`);                
            }
        })
    }
    target.body = JSON.stringify(result)
}