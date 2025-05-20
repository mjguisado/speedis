import http from 'http'
import https from 'https'
import http2 from 'node:http2'

import os from 'os'
import { initOriginBreaker } from '../modules/originBreaker.js'
import { transform, ORIGIN_REQUEST, ORIGIN_RESPONSE } from './bff.js'
import * as utils from '../utils/utils.js'

export async function initOrigin(server, opts) {

    if (opts.origin.http2Options) {

        const http2Session = setupHttp2Session(server, opts)
        if (!server.http2Session) {
            // We register the hook only the first time
            server.addHook('onClose', (server) => {
                if (server.http2Session) server.http2Session.close()
            })
            server.decorate('http2Session', http2Session)
        } else {
            server.http2Session = http2Session
        }

    } else {

        /*
        * We ensure that header names are in lowercase for the following
        * comparisons, which are case-sensitive.
        * Node HTTP library sets all headers to lower case automatically.
        */
        let aux = null
        for (const header in opts.origin.http1xOptions.headers) {
            aux = opts.origin.http1xOptions.headers[header]
            delete opts.origin.http1xOptions.headers[header]
            opts.origin.http1xOptions.headers[header.toLowerCase()] = aux
        }

        // Agents are responsible for managing connections.
        let agent = null
        if (opts.origin.agentOptions) {
            // The default protocol is 'http:'
            agent = ('https:' === opts.origin.http1xOptions.protocol ? https : http)
                .Agent(opts.origin.agentOptions)
        }
        server.decorate('agent', agent)
        server.addHook('onClose', (server) => {
            if (server.agent) server.agent.destroy()
        })

    }

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

function setupHttp2Session(server, opts) {

    const http2Session = http2.connect(opts.origin.http2Options.authority)

    http2Session.on('error', (error) => {
        server.log.error(error, `Origin: ${opts.id}. HTTP2 session lost.`)
    })

    http2Session.on('close', async () => {
        server.log.info(`Origin: ${opts.id}. HTTP2 session closed.`)
    })

    http2Session.on('goaway', () => {
        server.log.info(`Origin: ${opts.id}. HTTP2 server go away.`)
        // The server does not want to accept any more streams.
        // http2Session.close()
    })

    return http2Session

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

    let requestOptions = {}
    if (!opts.origin.http2Options) {
        requestOptions = { ...opts.origin.http1xOptions }
        if (server.agent) requestOptions.agent = server.agent
    }

    requestOptions.path = generatePath(request)
    requestOptions.headers = request.headers

    if (request.session?.access_token) {
        requestOptions.headers['authorization'] = `Bearer ${request.session.access_token}`
    }

    if (opts.bff) transform(opts, ORIGIN_REQUEST, requestOptions)

    const fetch = server.originBreaker
        ? server.originBreaker.fire(server, opts, requestOptions, request.rawBody)
        : _fetch(server, opts, requestOptions, request.rawBody)

    // Fecth
    const response = await fetch

    // Unsure that we have a valid Date Header
    response.headers['x-speedis-cache-status'] = 'CACHE_NOT_ENABLED from ' + os.hostname()

    // Apply transformations to the response received from the origin
    response.path = requestOptions.path
    if (opts.bff) transform(opts, ORIGIN_RESPONSE, response)

    return response

}

export function _fetch(server, originOptions, requestOptions, body) {

    // We set the content-length header just for interoperability.
    // It's not required by the HTTP/2
    if (body && !requestOptions.headers['content-length']) {
        const bodyLength = Buffer.isBuffer(body)
            ? body.length
            : Buffer.byteLength(body)
        requestOptions.headers['content-length'] = bodyLength
    }

    return originOptions.origin.http2Options
        ? _fetchHttp2(server, originOptions, requestOptions, body)
        : _fetchHttp1x(originOptions, requestOptions, body)
}

function _fetchHttp1x(originOptions, requestOptions, body) {

    return new Promise((resolve, reject) => {

        // If we are using the Circuit Breaker the timeout is managed by it.
        // In other cases, we has to manage the timeout in the request.
        let signal, timeoutId = null
        // if (originOptions.origin.originTimeout && !requestOptions.signal) {
        if (originOptions.origin.originTimeout && !originOptions.origin.originBreaker){
            const abortController = new AbortController()
            timeoutId = setTimeout(() => {
                abortController.abort()
            }, originOptions.origin.originTimeout)
            signal = abortController.signal
            requestOptions.signal = signal
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

export function transformHeadersForHttp2(headers, options = {}) {

    const forbidden = [
        'connection',
        'upgrade',
        'http2-settings',
        'keep-alive',
        'proxy-connection',
        'transfer-encoding'
    ];
    const result = {};

    for (const [key, value] of Object.entries(headers)) {
        const lowerKey = key.toLowerCase();
        if (forbidden.includes(lowerKey)) continue;
        if (lowerKey === 'te' && value.trim().toLowerCase() !== 'trailers') continue;
        if (lowerKey === 'host') {
            result[':authority'] = value;
            continue;
        }
        // Optional: Split cookies into serveral headers
        if (lowerKey === 'cookie' && value.includes(';')) {
            value.split(';').map(c => c.trim()).forEach(cookie => {
                if (!result['cookie']) result['cookie'] = [];
                result['cookie'].push(cookie);
            });
            continue;
        }
        result[lowerKey] = value;
    }

    // Add pseudo-headers if ther included in options
    if (options.method) result[http2.constants.HTTP2_HEADER_METHOD] = options.method;
    if (options.path) result[http2.constants.HTTP2_HEADER_PATH] = options.path;
    if (options.scheme) result[http2.constants.HTTP2_HEADER_SCHEME] = options.scheme;
    if (options.authority && !result[http2.constants.HTTP2_HEADER_AUTHORITY]) 
        result[http2.constants.HTTP2_HEADER_AUTHORITY] = options.authority;

    return result;
}

function _fetchHttp2(server, originOptions, requestOptions, body) {

    return new Promise((resolve, reject) => {

        const headers = transformHeadersForHttp2(requestOptions.headers, {
            method: requestOptions.method,
            path: requestOptions.path
        })

        // https://nodejs.org/api/http2.html#sensitive-headers
        if (headers[http2.constants.HTTP2_HEADER_AUTHORIZATION]) {
            headers[http2.sensitiveHeaders] = [http2.constants.HTTP2_HEADER_AUTHORIZATION]
        }

        const clientHttp2Stream = server.http2Session.request(headers)
        clientHttp2Stream.setEncoding('utf8')

        const response = { body: '' }

        clientHttp2Stream.on('response', (headers) => {
            response.statusCode = headers[':status']
            response.headers = headers
            delete response.headers[':status']
        })

        clientHttp2Stream.on('data', (chunk) => {
            response.body += chunk
        })

        clientHttp2Stream.on('end', () => {
            if (timeoutId) clearTimeout(timeoutId)
            resolve(response)
        })

        clientHttp2Stream.on('error', (err) => {
            if (timeoutId) clearTimeout(timeoutId)
            reject(err)
        })

        if (body) clientHttp2Stream.write(body)
        clientHttp2Stream.end()

        let timeoutId = null
        if (originOptions.origin.originTimeout && !originOptions.origin.originBreaker) {
            timeoutId = setTimeout(() => {
                clientHttp2Stream.close(http2.constants.NGHTTP2_CANCEL)
                const error = new Error(`Origin: ${originOptions.id}. Timed out after ${originOptions.origin.originTimeout} ms.`)
                error.code = 'ETIMEDOUT'
                reject(error)
            }, originOptions.origin.originTimeout)
        }

    })
}



