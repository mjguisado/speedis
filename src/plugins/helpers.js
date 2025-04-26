import { jwtDecode } from "jwt-decode"

export const SESSION_INDEX_NAME = 'idx:sessions'
export const SESSION_PREFIX = 'sessions:'

export async function storeSession(server, tokens) {
    try {
        const accessToken  = jwtDecode(tokens.access_token)
        const refreshToken = jwtDecode(tokens.refresh_token)
        tokens.sub = refreshToken.sub
        tokens.iat = refreshToken.iat
        const sessionKey = SESSION_PREFIX + refreshToken.sid
        server.redisBreaker
            ? await server.redisBreaker.fire('hSet', [sessionKey, tokens])
            : await server.redis.hSet(sessionKey, tokens)
        server.redisBreaker
            ? await server.redisBreaker.fire('expireAt', [sessionKey,refreshToken.exp])
            : await server.redis.expireAt(sessionKey, refreshToken.exp)
        return refreshToken.sid
    } catch (error) {
        server.log.error(`Error while storing the session.`, { cause: error })
        throw error
    }
}

export async function getSession(server, request, sessionIdCookieName) {
    let tokens = {}
    // Checks if the cookie header is present
    if (request.headers?.cookie) {
        // Parse the Cookie header
        const cookies = request.headers?.cookie
            .split(';')
            .map(cookie => cookie.trim().split('='))
            .reduce((acc, [key, value]) => {
                acc[key] = decodeURIComponent(value)
                return acc
            }, {})
        if (cookies[sessionIdCookieName]) {
            // Retrieve session information from Redis
            const id_session = cookies[sessionIdCookieName]
            const sessionKey = SESSION_PREFIX + id_session
            tokens = server.redisBreaker
                ? await server.redisBreaker.fire('hGetAll', [sessionKey])
                : await server.redis.hGetAll(sessionKey)
        }
    }
    return Object.keys(tokens).length > 0
        ? tokens
        : false
}

export function errorHandler(reply, code, msg, exposeErrors, cause) {
    let details = { msg: msg }
    if (cause) details.cause = cause.toString()
    reply
        .code(code)
        .header('date', new Date().toUTCString())
    if (exposeErrors) {
        reply.header('content-type', 'application/json')
        reply.send(details)
    } else {
        reply.send()
    }
    return reply
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

export function isPurgeRequest(opts, request, purgeUrlPrefix) {
    return opts.cache
        && request.method === "DELETE"
        && request.raw.url.startsWith(purgeUrlPrefix)
}
