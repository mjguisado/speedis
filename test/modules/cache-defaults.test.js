import { suite, test, before, after } from 'node:test'
import fastify from 'fastify'
import Ajv from 'ajv'
import { initCache } from '../../src/modules/cache.js'
import { initOriginConfigValidator } from '../../src/modules/originConfigValidator.js'

// ---------------------------------------------------------------------------
// These tests verify that cacheSettings.methods is always defined for every
// cacheable entry after initCache runs, regardless of how the user configured
// defaultCacheSettings. The runtime check `methods.includes(request.method)`
// would throw if methods were undefined.
// ---------------------------------------------------------------------------

function validateOrigin(originConfig) {
    const ajv = new Ajv({ useDefaults: true })
    const validator = initOriginConfigValidator(ajv)
    if (!validator(originConfig)) {
        throw new Error('Invalid origin config: ' + JSON.stringify(validator.errors))
    }
    return originConfig
}

async function buildAndInit(originConfig) {
    const server = fastify({ logger: false })
    initCache(server, originConfig)
    return server
}

const baseOrigin = () => ({
    id: 'test',
    prefix: '/test',
    origin: {
        http1xOptions: { protocol: 'http:', host: '127.0.0.1', port: 19999 }
    },
    redis: {
        redisOptions: { url: 'redis://127.0.0.1:6399' }
    }
})

suite('Cache – methods default and fallback', () => {

    test('defaultCacheSettings omitted → schema injects ["GET","HEAD","POST"]', async (t) => {
        const cfg = validateOrigin({
            ...baseOrigin(),
            cache: {
                cacheables: [{ urlPattern: '/foo' }]
            }
        })

        t.assert.deepStrictEqual(
            cfg.cache.defaultCacheSettings.methods,
            ['GET', 'HEAD', 'POST']
        )

        const server = await buildAndInit(cfg)
        try {
            t.assert.deepStrictEqual(
                cfg.cache.cacheables[0].cacheSettings.methods,
                ['GET', 'HEAD', 'POST']
            )
        } finally {
            await server.close()
        }
    })

    test('defaultCacheSettings: {} → runtime fallback applies methods', async (t) => {
        const cfg = validateOrigin({
            ...baseOrigin(),
            cache: {
                defaultCacheSettings: {},
                cacheables: [{ urlPattern: '/foo' }]
            }
        })

        const server = await buildAndInit(cfg)
        try {
            t.assert.deepStrictEqual(
                cfg.cache.cacheables[0].cacheSettings.methods,
                ['GET', 'HEAD', 'POST']
            )
        } finally {
            await server.close()
        }
    })

    test('defaultCacheSettings without methods (only ttl) → runtime fallback applies methods', async (t) => {
        const cfg = validateOrigin({
            ...baseOrigin(),
            cache: {
                defaultCacheSettings: { ttl: 60 },
                cacheables: [{ urlPattern: '/foo' }]
            }
        })

        const server = await buildAndInit(cfg)
        try {
            t.assert.deepStrictEqual(
                cfg.cache.cacheables[0].cacheSettings.methods,
                ['GET', 'HEAD', 'POST']
            )
            // Preserves the other field declared by the user
            t.assert.strictEqual(cfg.cache.cacheables[0].cacheSettings.ttl, 60)
        } finally {
            await server.close()
        }
    })

    test('per-cacheable methods overrides default', async (t) => {
        const cfg = validateOrigin({
            ...baseOrigin(),
            cache: {
                cacheables: [
                    { urlPattern: '/soap', cacheSettings: { methods: ['POST'] } },
                    { urlPattern: '/foo' }
                ]
            }
        })

        const server = await buildAndInit(cfg)
        try {
            // /soap → only POST
            t.assert.deepStrictEqual(
                cfg.cache.cacheables[0].cacheSettings.methods,
                ['POST']
            )
            // /foo → inherits ["GET","HEAD","POST"] from default
            t.assert.deepStrictEqual(
                cfg.cache.cacheables[1].cacheSettings.methods,
                ['GET', 'HEAD', 'POST']
            )
        } finally {
            await server.close()
        }
    })

    test('per-cacheable cacheSettings without methods inherits defaultCacheSettings.methods', async (t) => {
        const cfg = validateOrigin({
            ...baseOrigin(),
            cache: {
                defaultCacheSettings: { methods: ['GET'], ttl: 10 },
                cacheables: [
                    { urlPattern: '/foo', cacheSettings: { ttl: 600 } }
                ]
            }
        })

        const server = await buildAndInit(cfg)
        try {
            t.assert.deepStrictEqual(
                cfg.cache.cacheables[0].cacheSettings.methods,
                ['GET']
            )
            t.assert.strictEqual(cfg.cache.cacheables[0].cacheSettings.ttl, 600)
        } finally {
            await server.close()
        }
    })
})
