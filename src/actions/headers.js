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
    let now = new Date().toUTCString()
    target.headers["last-modified"] = now
    target.headers["date"] = now
}

/**
 * Sets the Cache-Control header based on the HTTP status code of the response.
 *
 * This function allows different caching behaviors for different status codes.
 * It supports:
 * - Specific status codes (e.g., "200", "404", "403")
 * - Status code ranges (e.g., "2xx", "4xx", "5xx")
 *
 * Priority order: specific code > range
 *
 * If no rule matches, the original Cache-Control header from the origin is preserved.
 *
 * @param {Object} target - The response object containing statusCode and headers
 * @param {Object} params - Configuration object with statusCodeRules
 * @param {Object} params.statusCodeRules - Map of status codes/ranges to Cache-Control values
 *
 * @example
 * // Configuration in bff.transformations:
 * {
 *   "phase": "OriginResponse",
 *   "uses": "headers:setCacheControlByStatusCode",
 *   "with": {
 *     "statusCodeRules": {
 *       "200": "public, max-age=3600",
 *       "404": "public, max-age=60",
 *       "403": "no-store",
 *       "5xx": "no-cache"
 *     }
 *   }
 * }
 */
export function setCacheControlByStatusCode(target, params) {
    if (!params || !params.statusCodeRules) {
        return
    }

    const statusCode = target.statusCode
    const rules = params.statusCodeRules

    let cacheControl = null

    // 1. Try to find specific status code rule (e.g., "200", "404")
    cacheControl = rules[statusCode.toString()]

    // 2. If not found, try to find range rule (e.g., "2xx", "4xx", "5xx")
    if (!cacheControl) {
        const range = `${Math.floor(statusCode / 100)}xx`
        cacheControl = rules[range]
    }

    // 3. Apply the cache-control header only if a rule was found
    if (cacheControl) {
        target.headers['cache-control'] = cacheControl
    }
    // If no rule matches, the original Cache-Control from origin is preserved
}

