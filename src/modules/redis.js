import { createClient, SchemaFieldTypes } from 'redis'
import { SESSION_INDEX_NAME, SESSION_PREFIX } from '../plugins/session.js'
import CircuitBreaker from 'opossum'

export async function initRedis(server, opts) {

    let client = null;

    // Connecting to Redis
    // See: https://redis.io/docs/latest/develop/clients/nodejs/produsage/#handling-reconnections
    client = createClient(opts.redis.redisOptions)
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
            // Documentation: https://redis.io/commands/ft.create/
            await client.ft.create(
                SESSION_INDEX_NAME,
                {
                    sub: SchemaFieldTypes.TAG,
                    iat: {
                        type: SchemaFieldTypes.NUMERIC,
                        SORTABLE: true
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
        const handler = {
            get(target, prop, receiver) {
                const original = target[prop]
                // Module JSON is a special case, we need to wrap its methods
                if ('object' === typeof original && ('json' === prop || 'ft' === prop)) {
                    return wrapRedisWithTimeout(original, timeout)
                }
                if (typeof original !== 'function') return original
                return (...args) => {
                    const command = Promise.race([
                        original.apply(target, args),
                        new Promise((_, reject) =>
                            setTimeout(() => reject(
                                new Error(`Origin: ${opts.id}. Redis command ${prop} timed out after ${timeout} ms.`)
                            ), timeout)
                        )
                    ])
                    return command
                }
            }
        }
        return new Proxy(client, handler)
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