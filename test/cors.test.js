import { suite, test, before, after } from 'node:test'
import fastify from 'fastify'
import speedisPlugin from '../src/plugins/speedis.js'

// ---------------------------------------------------------------------------
// Helper – build a minimal speedisPlugin instance with optional CORS config.
// ---------------------------------------------------------------------------
async function buildServer(corsConfig) {
    const server = fastify({ logger: false })
    const pluginOpts = {
        id: 'test',
        prefix: '/test',
        metrics: false,
        exposeErrors: true,
        origin: {
            http1xOptions: {
                protocol: 'http:',
                host: '127.0.0.1',
                port: 19999   // intentionally unreachable – CORS tests never proxy
            }
        }
    }
    if (corsConfig !== undefined) pluginOpts.cors = corsConfig
    server.register(speedisPlugin, pluginOpts)
    server.decorate('plugins', new Map([['test', '/test']]))
    await server.ready()
    return server
}

// ---------------------------------------------------------------------------
// Suite 1 – CORS disabled (no cors property)
// ---------------------------------------------------------------------------
suite('CORS – disabled (no cors config)', () => {
    let server
    before(async () => { server = await buildServer(undefined) })
    after(async () => server.close())

    test('regular GET request has no CORS headers', async (t) => {
        t.plan(2)
        const res = await server.inject({
            method: 'GET', url: '/test/anything',
            headers: { origin: 'https://app.example.com' }
        })
        // Speedis will proxy and likely get a connection error (ECONNREFUSED) → 502/504.
        // What matters is that no CORS header is present.
        t.assert.strictEqual(res.headers['access-control-allow-origin'], undefined)
        t.assert.strictEqual(res.headers['vary'], undefined)
    })

    test('OPTIONS preflight has no CORS headers', async (t) => {
        t.plan(1)
        const res = await server.inject({
            method: 'OPTIONS', url: '/test/anything',
            headers: {
                origin: 'https://app.example.com',
                'access-control-request-method': 'GET'
            }
        })
        t.assert.strictEqual(res.headers['access-control-allow-origin'], undefined)
    })
})

// ---------------------------------------------------------------------------
// Suite 2 – CORS explicitly disabled via enabled:false
// ---------------------------------------------------------------------------
suite('CORS – explicitly disabled (enabled: false)', () => {
    let server
    before(async () => { server = await buildServer({ enabled: false, origin: true }) })
    after(async () => server.close())

    test('regular GET has no CORS headers even though origin:true is set', async (t) => {
        t.plan(1)
        const res = await server.inject({
            method: 'GET', url: '/test/anything',
            headers: { origin: 'https://app.example.com' }
        })
        t.assert.strictEqual(res.headers['access-control-allow-origin'], undefined)
    })
})

// ---------------------------------------------------------------------------
// Suite 3 – CORS enabled, all origins (origin: true)
// ---------------------------------------------------------------------------
suite('CORS – origin: true (allow all)', () => {
    let server
    before(async () => { server = await buildServer({ origin: true }) })
    after(async () => server.close())

    test('GET with Origin header receives Access-Control-Allow-Origin', async (t) => {
        t.plan(1)
        const res = await server.inject({
            method: 'GET', url: '/test/anything',
            headers: { origin: 'https://app.example.com' }
        })
        t.assert.strictEqual(res.headers['access-control-allow-origin'], 'https://app.example.com')
    })

    test('OPTIONS preflight returns 204 with CORS headers', async (t) => {
        t.plan(3)
        const res = await server.inject({
            method: 'OPTIONS', url: '/test/anything',
            headers: {
                origin: 'https://app.example.com',
                'access-control-request-method': 'GET'
            }
        })
        t.assert.strictEqual(res.statusCode, 204)
        t.assert.strictEqual(res.headers['access-control-allow-origin'], 'https://app.example.com')
        t.assert.ok(res.headers['access-control-allow-methods'])
    })

    test('GET without Origin header does not add CORS headers', async (t) => {
        t.plan(1)
        const res = await server.inject({ method: 'GET', url: '/test/anything' })
        t.assert.strictEqual(res.headers['access-control-allow-origin'], undefined)
    })
})

// ---------------------------------------------------------------------------
// Suite 4 – CORS enabled, single specific origin
// ---------------------------------------------------------------------------
suite('CORS – single specific origin', () => {
    let server
    before(async () => {
        server = await buildServer({ origin: 'https://app.example.com' })
    })
    after(async () => server.close())

    test('allowed origin receives Access-Control-Allow-Origin', async (t) => {
        t.plan(1)
        const res = await server.inject({
            method: 'GET', url: '/test/anything',
            headers: { origin: 'https://app.example.com' }
        })
        t.assert.strictEqual(res.headers['access-control-allow-origin'], 'https://app.example.com')
    })

    // When origin is a string, @fastify/cors always sets Access-Control-Allow-Origin
    // to the configured value (no server-side request-origin comparison is done).
    // Browser enforcement: the browser rejects the response when the response header
    // value does not match the actual request Origin.
    test('disallowed origin gets configured ACAO (not its own origin – browser will reject)', async (t) => {
        t.plan(2)
        const res = await server.inject({
            method: 'GET', url: '/test/anything',
            headers: { origin: 'https://evil.example.com' }
        })
        // Header IS present with the configured allowed origin …
        t.assert.strictEqual(res.headers['access-control-allow-origin'], 'https://app.example.com')
        // … but it does NOT match the request origin, so browsers will block access.
        t.assert.notStrictEqual(res.headers['access-control-allow-origin'], 'https://evil.example.com')
    })
})

// ---------------------------------------------------------------------------
// Suite 5 – CORS enabled, array of allowed origins
// ---------------------------------------------------------------------------
suite('CORS – array of allowed origins', () => {
    let server
    before(async () => {
        server = await buildServer({
            origin: ['https://app.example.com', 'https://admin.example.com']
        })
    })
    after(async () => server.close())

    test('first allowed origin is reflected', async (t) => {
        t.plan(1)
        const res = await server.inject({
            method: 'GET', url: '/test/anything',
            headers: { origin: 'https://app.example.com' }
        })
        t.assert.strictEqual(res.headers['access-control-allow-origin'], 'https://app.example.com')
    })

    test('second allowed origin is reflected', async (t) => {
        t.plan(1)
        const res = await server.inject({
            method: 'GET', url: '/test/anything',
            headers: { origin: 'https://admin.example.com' }
        })
        t.assert.strictEqual(res.headers['access-control-allow-origin'], 'https://admin.example.com')
    })

    test('origin not in the list is rejected', async (t) => {
        t.plan(1)
        const res = await server.inject({
            method: 'GET', url: '/test/anything',
            headers: { origin: 'https://evil.example.com' }
        })
        t.assert.strictEqual(res.headers['access-control-allow-origin'], undefined)
    })
})

// ---------------------------------------------------------------------------
// Suite 6 – CORS with credentials support
// ---------------------------------------------------------------------------
suite('CORS – credentials', () => {
    let server
    before(async () => {
        server = await buildServer({
            origin: 'https://app.example.com',
            credentials: true
        })
    })
    after(async () => server.close())

    test('Access-Control-Allow-Credentials is true for allowed origin', async (t) => {
        t.plan(2)
        const res = await server.inject({
            method: 'GET', url: '/test/anything',
            headers: { origin: 'https://app.example.com' }
        })
        t.assert.strictEqual(res.headers['access-control-allow-origin'], 'https://app.example.com')
        t.assert.strictEqual(res.headers['access-control-allow-credentials'], 'true')
    })
})

// ---------------------------------------------------------------------------
// Suite 7 – CORS with exposed headers
// ---------------------------------------------------------------------------
suite('CORS – exposedHeaders', () => {
    let server
    before(async () => {
        server = await buildServer({
            origin: true,
            exposedHeaders: ['X-Speedis-Cache-Status', 'X-Custom-Header']
        })
    })
    after(async () => server.close())

    test('Access-Control-Expose-Headers contains configured headers', async (t) => {
        t.plan(2)
        const res = await server.inject({
            method: 'GET', url: '/test/anything',
            headers: { origin: 'https://app.example.com' }
        })
        t.assert.ok(res.headers['access-control-expose-headers'])
        t.assert.ok(
            res.headers['access-control-expose-headers']
                .includes('X-Speedis-Cache-Status'),
            'exposed headers should include X-Speedis-Cache-Status'
        )
    })
})

// ---------------------------------------------------------------------------
// Suite 8 – CORS with maxAge (preflight cache)
// ---------------------------------------------------------------------------
suite('CORS – maxAge', () => {
    let server
    before(async () => {
        server = await buildServer({ origin: true, maxAge: 3600 })
    })
    after(async () => server.close())

    test('preflight response includes Access-Control-Max-Age', async (t) => {
        t.plan(1)
        const res = await server.inject({
            method: 'OPTIONS', url: '/test/anything',
            headers: {
                origin: 'https://app.example.com',
                'access-control-request-method': 'GET'
            }
        })
        t.assert.strictEqual(res.headers['access-control-max-age'], '3600')
    })
})

// ---------------------------------------------------------------------------
// Suite 9 – optionsSuccessStatus: 200 (legacy browser compatibility)
// ---------------------------------------------------------------------------
suite('CORS – optionsSuccessStatus: 200', () => {
    let server
    before(async () => {
        server = await buildServer({ origin: true, optionsSuccessStatus: 200 })
    })
    after(async () => server.close())

    test('preflight returns 200 instead of 204', async (t) => {
        t.plan(1)
        const res = await server.inject({
            method: 'OPTIONS', url: '/test/anything',
            headers: {
                origin: 'https://app.example.com',
                'access-control-request-method': 'GET'
            }
        })
        t.assert.strictEqual(res.statusCode, 200)
    })
})
