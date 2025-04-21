import { jwtDecode } from "jwt-decode"

export async function storeSession(server, tokens) {
    try {
        const tokenWithLongestLifespan =  jwtDecode(
            tokens.refresh_token?tokens.refresh_token:tokens.access_token
        )
        const id_session = tokenWithLongestLifespan.sid
        const expiration = tokenWithLongestLifespan.exp
        server.redisBreaker
            ? await server.redisBreaker.fire('hSet', [id_session, tokens])
            : await server.redis.hSet(id_session, tokens)
        server.redisBreaker
            ? await server.redisBreaker.fire('expireAt', [id_session, expiration])
            : await server.redis.expireAt(id_session, expiration)
        return id_session
    } catch (error) {
        server.log.error(`Error while storing the session.`, { cause: error })
        throw error
    }
}