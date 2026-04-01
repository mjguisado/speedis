import { createClient } from 'redis'
import CircuitBreaker from 'opossum'

export async function initRedis(server, opts) {

    let client = null

    // Connecting to Redis
    // See: https://redis.io/docs/latest/develop/clients/nodejs/produsage/#handling-reconnections
    // See: https://github.com/redis/node-redis/blob/master/docs/v5.md#unstable-commands
    client = createClient({
        ...opts.redis.redisOptions,
        RESP: 3,
        unstableResp3: true
    })
    client.on('error', error => {
        server.log.error(error, `Origin: ${opts.id}. Redis connection lost.`)
    })
    try {
        await client.connect()
        server.log.info(`Origin: ${opts.id}. Redis connection established.`)
    } catch (error) {
        throw new Error(`Origin: ${opts.id}. Unable to connect to Redis during startup.`, { cause: error })
    }

    /**
     * Wraps a Redis client (or sub-module) so that any command call will automatically
     * have a timeout enforced via AbortController and client.withAbortSignal().
     * Sub-modules (json, ft, etc.) are wrapped recursively using path tracking so that
     * the signal is correctly propagated through the root client.
     * The scanIterator method is handled specially using Promise.race per iteration,
     * as it returns an async iterator rather than a Promise.
     *
     * @param {object} target - The Redis client or sub-module to wrap.
     * @param {number} timeout - Timeout in milliseconds.
     * @param {string[]} path - Internal: tracks the property path for sub-module navigation.
     * @returns {object} - Proxy object with timeout behavior.
     */
    function wrapRedisWithTimeout(target, timeout, path = []) {

        return new Proxy(target, {

            get(proxyTarget, prop, receiver) {

                const original = Reflect.get(proxyTarget, prop, receiver)

                // If the property is a non-configurable and non-writable data property,
                // the Proxy MUST return the exact original value or it will break invariants.
                const desc = Object.getOwnPropertyDescriptor(proxyTarget, prop)
                if (desc && !desc.configurable && !desc.writable && 'value' in desc) {
                    return original
                }

                // If it's a non-null object (sub-module like json, ft), wrap recursively,
                // tracking the property path so we can navigate to it on a timed client.
                if (original !== null && typeof original === 'object') {
                    return wrapRedisWithTimeout(original, timeout, [...path, String(prop)])
                }

                // If it's not a function, return as-is.
                if (typeof original !== 'function') return original

                // Special case: scanIterator returns an async iterator and cannot be
                // wrapped with withAbortSignal directly. Use Promise.race per iteration.
                if (prop === 'scanIterator') {
                    return (...args) => {
                        const it = original.apply(proxyTarget, args)[Symbol.asyncIterator]()
                        return {
                            [Symbol.asyncIterator]() { return this },
                            next(...nextArgs) {
                                return Promise.race([
                                    it.next(...nextArgs),
                                    new Promise((_, reject) =>
                                        setTimeout(() => reject(
                                            new Error(`Origin: ${opts.id}. Redis scanIterator.next() timed out after ${timeout} ms.`)
                                        ), timeout)
                                    )
                                ])
                            },
                            return(...nextArgs) {
                                return it.return ? it.return(...nextArgs) : Promise.resolve({ done: true, value: undefined })
                            },
                            throw(err) {
                                return it.throw ? it.throw(err) : Promise.reject(err)
                            }
                        }
                    }
                }

                // For all other functions: use client.withAbortSignal() for timeout.
                // Navigate to the correct sub-module using the tracked path.
                return (...args) => {
                    const ac = new AbortController()
                    const t = setTimeout(() => ac.abort(), timeout)

                    let timedTarget = client.withAbortSignal(ac.signal)
                    for (const key of path) {
                        timedTarget = timedTarget[key]
                    }

                    const result = timedTarget[prop].apply(timedTarget, args)

                    if (result && typeof result.then === 'function') {
                        return result.finally(() => clearTimeout(t))
                    }

                    clearTimeout(t)
                    return result
                }
            }
        })

    }

    /**
     * Executes a Redis command with support for both standard and RedisJSON operations.
     * This function serves as an abstraction layer to integrate with a Circuit Breaker
     * implemented using Opossum, in order to monitor and manage Redis availability.
     * When redisTimeout is configured, each command uses an AbortController via
     * client.withAbortSignal() to enforce the timeout.
     *
     * @param {string} command - The Redis command to execute (e.g., 'json.get', 'json.set', 'set', 'get', etc.).
     * @param {Array<string|number>} args - The list of arguments for the Redis command.
     * @returns {Promise<any>} The result of the Redis command execution.
     */
    function _sendCommandToRedis(command, args) {
        let timedClient = client
        let t = undefined

        if (opts.redis.redisTimeout) {
            const ac = new AbortController()
            t = setTimeout(() => ac.abort(), opts.redis.redisTimeout)
            timedClient = client.withAbortSignal(ac.signal)
        }

        const finalize = (promise) => t ? promise.finally(() => clearTimeout(t)) : promise

        switch (command.toLowerCase()) {
            case 'evalsha':
                return finalize(timedClient.evalSha(...args))
            case 'expire':
                return finalize(timedClient.expire(...args))
            case 'expireat':
                return finalize(timedClient.expireAt(...args))
            case 'get':
                return finalize(timedClient.get(...args))
            case 'json.get':
                return finalize(timedClient.json.get(...args))
            case 'json.merge':
                return finalize(timedClient.json.merge(...args))
            case 'json.set':
                return finalize(timedClient.json.set(...args))
            case 'ft.search':
                return finalize(timedClient.ft.search(...args))
            case 'script exists':
                return finalize(timedClient.scriptExists(...args))
            case 'script load':
                return finalize(timedClient.scriptLoad(...args))
            case 'set':
                return finalize(timedClient.set(...args))
            case 'unlink':
                return finalize(timedClient.unlink(...args))
            case 'zincrby':
                return finalize(timedClient.zIncrBy(...args))
            default:
                throw new Error(`Origin: ${opts.id}. Redis command ${command} not supported.`)
        }
    }

    if (opts.redis.redisBreaker) {

        let redisBreakerOptions = opts.redis.redisBreakerOptions
        // Name of the Circuit Breaker
        redisBreakerOptions['name'] = `redis-${opts.id}`
        // Speedis implements its own coalescing mechanism so we disable the one from the circuit breaker.
        redisBreakerOptions['coalesce'] = false
        // Speedis itself implements a cache mechanism so we disable the one from the circuit breaker.
        redisBreakerOptions['cache'] = false
        // Timeout is now managed via AbortController in _sendCommandToRedis, not by Opossum.

        // Redis Breaker instance
        const redisBreaker = new CircuitBreaker(_sendCommandToRedis, redisBreakerOptions)
        redisBreaker.on('open', () => {
            // We will use this value to set the Retry-After header
            let retryAfter = new Date()
            retryAfter.setSeconds(retryAfter.getSeconds() + redisBreaker.options.resetTimeout / 1000)
            redisBreaker['retryAfter'] = retryAfter.toUTCString()
            server.log.error(`Origin ${opts.id}. Redis Breaker OPEN: No commands will be execute.`)
        })
        redisBreaker.on('halfOpen', () => {
            server.log.warn(`Origin ${opts.id}. Redis Breaker HALF OPEN: Commands are being tested.`)
        })
        redisBreaker.on('close', () => {
            server.log.info(`Origin ${opts.id}. Redis Breaker CLOSED: Commands are being executed normally.`)
        })
        server.decorate('redisBreaker', redisBreaker)
    
    }
    if (opts.redis.redisTimeout) {
        server.decorate('redis', wrapRedisWithTimeout(client, opts.redis.redisTimeout))
    } else {
        server.decorate('redis', client)
    }
    server.addHook('onClose', (server) => {
        if (server.redis) server.redis.quit()
    })

}