import http from 'http'
import https from 'https'
import os from 'os'
import { initOriginBreaker } from '../modules/originBreaker.js'
import { transform, ORIGIN_REQUEST, ORIGIN_RESPONSE } from './bff.js'
import * as utils from '../utils/utils.js'

export async function initOrigin(server, opts) {

    /*
     * We ensure that header names are in lowercase for the following
     * comparisons, which are case-sensitive.
     * Node HTTP library sets all headers to lower case automatically.
     */
    let aux = null
    for (const header in opts.origin.httpxOptions.headers) {
        aux = opts.origin.httpxOptions.headers[header]
        delete opts.origin.httpxOptions.headers[header]
        opts.origin.httpxOptions.headers[header.toLowerCase()] = aux
    }

    // Agents are responsible for managing connections.
    let agent = null
    if (opts.origin.agentOptions) {
        // The default protocol is 'http:'
        agent = ('https:' === opts.origin.httpxOptions.protocol ? https : http)
            .Agent(opts.origin.agentOptions)
    }
    server.decorate('agent', agent)

    // This plugin will add the request.rawBody.
    // It will get the data using the preParsing hook.
    await server.register(import('fastify-raw-body'), {
        encoding: false
    })

    const originBreaker = opts.origin.originBreaker
        ? initOriginBreaker(server, opts)
        : null
    server.decorate('originBreaker', originBreaker)

    server.decorateRequest("urlKey", null)

}

export function generatePath(request) {
    const prefix = request.routeOptions.url.replace("/*", "")
    return request.url.replace(prefix, "")
}


export function generateUrlKey(opts, request, fieldNames = utils.parseVaryHeader(request)) {
    let path = generatePath(request)
    const [base, queryString] = path.split("?")
    if (queryString) {
        const params = new URLSearchParams(queryString)
        if (opts.cache?.ignoredQueryParams) {
            opts.cache.ignoredQueryParams.forEach(param => params.delete(param))
        }
        if (params.size > 0) {
            if (opts.cache?.sortQueryParams) {
                const sortedParams = [...params.entries()]
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([key, value]) => `${key}=${value}`)
                    .join("&")
                path = `${base}?${sortedParams.toString()}`
            } else {
                path = `${base}?${params.toString()}`
            }
        } else {
            path = base
        }
    }

    let urlKey = opts.cache?.includeOriginIdInUrlKey 
        ? opts.id 
        : ''
    if (request.cacheable_per_user) {
        urlKey += (urlKey.length > 0 ? ':' : '') + request.session.sub
    }
    urlKey += path.replaceAll('/', ':')
    if (urlKey.startsWith(':')) urlKey = urlKey.slice(1)

    // See: https://www.rfc-editor.org/rfc/rfc9111.html#name-calculating-cache-keys-with
    fieldNames.forEach(fieldName => {
        if (fieldName === '*') urlKey += ':*'
        else if (Object.prototype.hasOwnProperty.call(request.headers, fieldName)) {
            urlKey += ':' + fieldName
                + ':' + ((request.headers[fieldName]) ? request.headers[fieldName] : '')
        }
    })
    request.urlKey = urlKey
}

export async function proxy(server, opts, request) {

    const requestOptions = { ...opts.origin.httpxOptions }
    requestOptions.method = request.method
    requestOptions.path = generatePath(request)
    requestOptions.headers = request.headers
    if (server.agent) requestOptions.agent = server.agent
    if (request.session?.access_token) {
        requestOptions.headers['authorization'] = `Bearer ${request.session.access_token}`
    }

    if (opts.bff) transform(opts, ORIGIN_REQUEST, requestOptions)

    const fetch = server.originBreaker
        ? server.originBreaker.fire(opts, requestOptions, request.rawBody)
        : _fetch(opts, requestOptions, request.rawBody)

    // Fecth
    const response = await fetch

    // Unsure that we have a valid Date Header
    response.headers['x-speedis-cache-status'] = 'CACHE_NOT_ENABLED from ' + os.hostname()

    // Apply transformations to the response received from the origin
    response.path = requestOptions.path
    if (opts.bff) transform(opts, ORIGIN_RESPONSE, response)

    return response

}

export function _fetch(originOptions, requestOptions, body) {

    return new Promise((resolve, reject) => {

        // If we are using the Circuit Breaker the timeout is managed by it.
        // In other cases, we has to manage the timeout in the request.
        let signal, timeoutId = null
        if (originOptions.origin.originTimeout && !requestOptions.signal) {
            const abortController = new AbortController()
            timeoutId = setTimeout(() => {
                abortController.abort()
            }, originOptions.origin.originTimeout)
            signal = abortController.signal
            requestOptions.signal = signal
        }

        if (body && !requestOptions.headers['Content-Length']) {
            const bodyLength = Buffer.isBuffer(body)
                ? body.length
                : Buffer.byteLength(body)
            requestOptions.headers['Content-Length'] = bodyLength
        }

        const request = (requestOptions.protocol === 'https:' ? https : http)
            .request(requestOptions, (res) => {
                let rawData = ''
                res.on('data', chunk => { rawData += chunk })
                res.on('end', () => {
                    if (timeoutId) clearTimeout(timeoutId)
                    resolve({ statusCode: res.statusCode, headers: res.headers, body: rawData })
                })
            })

        request.on('error', (err) => {
            if (signal && signal.aborted) {
                const error = new Error(`Origin: ${originOptions.id}. Timed out after ${originOptions.origin.originTimeout} ms.`, { cause: err })
                error.code = 'ETIMEDOUT'
                reject(error)
            } else {
                reject(err)
            }
        })

        // Enviar body si existe
        if (body) request.write(body)

        request.end()

    })

}
