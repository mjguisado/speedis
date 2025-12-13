import { createClient, SCHEMA_FIELD_TYPE } from 'redis'
import { SESSION_INDEX_NAME, SESSION_PREFIX } from '../plugins/session.js'
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

    if (opts.oauth2) {
        // The index creation process can take a considerable amount of time, 
        // which is why it is created using the Redis client before setting 
        // the per-operation timeouts.
        try {
            // https://redis.io/docs/latest/develop/clients/nodejs/queryjson/#add-the-index
            await client.ft.create( SESSION_INDEX_NAME,
                {
                    'sub': {
                        type: SCHEMA_FIELD_TYPE.TAG,
                    },
                    'iat': {
                        type: SCHEMA_FIELD_TYPE.NUMERIC,
                        SORTABLE: true,
                    }
                },
                {
                    ON: 'HASH',
                    PREFIX: SESSION_PREFIX
                }
            )
        } catch (error) {
            if (error.message === 'Index already exists') {
                server.log.info(`Origin: ${opts.id}. Index exists already, skipped creation.`)
            } else {
                // Something went wrong, perhaps RediSearch isn't installed...
                throw new Error(`Origin: ${opts.id}. Session index creation failed.`, { cause: error })
            }
        }
    }

    /**
     * Wraps a Redis client so that any command you call on it will automatically have a timeout.
     * If the Redis command takes too long it will reject with a timeout error.
     *
     * @param {object} client - The original Redis client object.
     * @param {number} timeout - Optional. The maximum time (in milliseconds) to wait for a Redis command to complete before timing out. Defaults to 1000ms
     * @returns {object} - Proxy object that behaves just like the original Redis client, but with a timeout behavior added to each command.
     */
    function wrapRedisWithTimeout(client, timeout) {

        return new Proxy(client, {

            get(target, prop, receiver) {

                // Always retrieve the real value from the target while respecting Proxy invariants.
                const original = Reflect.get(target, prop, receiver)

                // If the property is a non-configurable and non-writable data property,
                // the Proxy MUST return the exact original value or it will break invariants.
                // For example: json or ft modules
                const desc = Object.getOwnPropertyDescriptor(target, prop)
                if (desc && !desc.configurable && !desc.writable && 'value' in desc) {
                    return original 
                }                 
                
                // If it's not a function, just return the property as-is.
                if (typeof original !== 'function') return original

                // Wrap function calls to add timeout behavior.
                return (...args) => {

                    // Execute the actual Redis command.
                    let result = original.apply(target, args)

                    // Case 1: The Redis command returns a Promise → wrap in Promise.race() for timeout.
                    if (result && typeof result.then === 'function') {
                        return Promise.race([
                            result,
                            new Promise((_, reject) =>
                                setTimeout(() => reject(
                                    new Error(`Origin: ${opts.id}. Redis command ${prop} timed out after ${timeout} ms.`)
                                ), timeout)
                            )
                        ])
                    }

                    // Case 2: The Redis command returns an async iterator (e.g., SCAN).
                    // We wrap the iterator's next() method with a timeout as well.
                    if (result && typeof result === 'object' && typeof result[Symbol.asyncIterator] === 'function') {
                        const it = result[Symbol.asyncIterator]()
                        return {
                            [Symbol.asyncIterator]() { return this },
                            next(...args) {
                                return Promise.race([
                                    it.next(...args),
                                    new Promise((_, reject) =>
                                        setTimeout(() => reject(
                                            new Error(`Origin: ${opts.id}. Redis iterator ${prop}.next() timed out after ${timeout} ms.`)
                                        ), timeout)
                                    )
                                ])
                            },                          
                            return(...args) {
                                return it.return ? it.return(...args) : Promise.resolve({ done: true, value: undefined })
                            },
                            throw(err) {
                                return it.throw ? it.throw(err) : Promise.reject(err)
                            }
                        }
                    }

                    // Case 3: Non-promise, non-iterator result → simply return it.
                    return result

                }
            }
        })
        
    }

    /**
     * Executes a Redis command with support for both standard and RedisJSON operations.
     * This function serves as an abstraction layer to integrate with a Circuit Breaker
     * implemented using Opossum, in order to monitor and manage Redis availability.
     *
     * @function _sendCommandToRedis
     * @param {string} command - The Redis command to execute (e.g., 'json.get', 'json.set', 'set', 'get', etc.).
     * @param {Array<string|number>} args - The list of arguments for the Redis command.
     * @returns {Promise<any>} The result of the Redis command execution.
     */
    function _sendCommandToRedis(command, args, options) {
        switch (command.toLowerCase()) {
            case 'evalsha':
                return client.evalSha(...args, options)
            case 'expire':
                return client.expire(...args, options)
            case 'expireat':
                return client.expireAt(...args, options)
            case 'get':
                return client.get(...args, options)
            case 'hset':
                return client.hSet(...args, options)
            case 'hgetall':
                return client.hGetAll(...args, options)
            case 'json.get':
                return client.json.get(...args, options)
            case 'json.merge':
                return client.json.merge(...args, options)
            case 'json.set':
                return client.json.set(...args, options)
            case 'ft.search':
                return client.ft.search(...args, options)
            case 'script exists':
                return client.scriptExists(...args, options)
            case 'script load':
                return client.scriptLoad(...args, options)
            case 'set':
                return client.set(...args, options)
            case 'unlink':
                return client.unlink(...args, options)
            case 'zincrby':
                return client.zIncrBy(...args, options)
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
        // Timeout for the Circuit Breaker
        if (opts.redis.redisTimeout) {
            redisBreakerOptions['timeout'] = opts.redis.redisTimeout
        }

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