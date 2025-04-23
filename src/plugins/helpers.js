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