import { suite, test } from 'node:test'
import assert from 'node:assert'
import {
    parseCacheControlHeader,
    parseVaryHeader,
    calculateFreshnessLifetime,
    calculateAge,
    cleanUpHeader,
    ensureValidDateHeader,
    cloneAndTrimResponse,
    getOrigin
} from '../../src/utils/utils.js'

suite('Utils Module', () => {

    suite('parseCacheControlHeader', () => {

        test('should parse simple cache-control directives', (t) => {
            const entry = {
                headers: {
                    'cache-control': 'public, max-age=3600'
                }
            }

            const result = parseCacheControlHeader(entry)

            assert.strictEqual(result.public, null)
            assert.strictEqual(result['max-age'], '3600')
        })

        test('should parse cache-control with quoted values', (t) => {
            const entry = {
                headers: {
                    'cache-control': 'private="Set-Cookie", max-age=0'
                }
            }

            const result = parseCacheControlHeader(entry)

            assert.strictEqual(result.private, '"Set-Cookie"')
            assert.strictEqual(result['max-age'], '0')
        })

        test('should return empty object when no cache-control header', (t) => {
            const entry = {
                headers: {}
            }

            const result = parseCacheControlHeader(entry)

            assert.deepStrictEqual(result, {})
        })

        test('should return empty object when no headers', (t) => {
            const entry = {}

            const result = parseCacheControlHeader(entry)

            assert.deepStrictEqual(result, {})
        })

        test('should parse multiple directives', (t) => {
            const entry = {
                headers: {
                    'cache-control': 'public, max-age=3600, s-maxage=7200, must-revalidate'
                }
            }

            const result = parseCacheControlHeader(entry)

            assert.strictEqual(result.public, null)
            assert.strictEqual(result['max-age'], '3600')
            assert.strictEqual(result['s-maxage'], '7200')
            assert.strictEqual(result['must-revalidate'], null)
        })

        test('should parse no-cache and no-store', (t) => {
            const entry = {
                headers: {
                    'cache-control': 'no-cache, no-store'
                }
            }

            const result = parseCacheControlHeader(entry)

            assert.strictEqual(result['no-cache'], null)
            assert.strictEqual(result['no-store'], null)
        })
    })

    suite('parseVaryHeader', () => {

        test('should parse single vary header', (t) => {
            const entry = {
                headers: {
                    'vary': 'Accept-Encoding'
                }
            }

            const result = parseVaryHeader(entry)

            assert.deepStrictEqual(result, ['Accept-Encoding'])
        })

        test('should parse multiple vary headers and sort them', (t) => {
            const entry = {
                headers: {
                    'vary': 'User-Agent, Accept-Encoding'
                }
            }

            const result = parseVaryHeader(entry)

            // Should parse both values and sort them alphabetically
            assert.strictEqual(result.length, 2)
            assert.strictEqual(result[0], 'Accept-Encoding')
            assert.strictEqual(result[1], 'User-Agent')
        })

        test('should return empty array when no vary header', (t) => {
            const entry = {
                headers: {}
            }

            const result = parseVaryHeader(entry)

            assert.deepStrictEqual(result, [])
        })

        test('should handle wildcard vary', (t) => {
            const entry = {
                headers: {
                    'vary': '*'
                }
            }

            const result = parseVaryHeader(entry)

            assert.deepStrictEqual(result, ['*'])
        })
    })

    suite('calculateFreshnessLifetime', () => {

        test('should calculate from s-maxage directive', (t) => {
            const response = {
                headers: {
                    'cache-control': 's-maxage=7200, max-age=3600',
                    'date': new Date().toUTCString()
                }
            }

            const result = calculateFreshnessLifetime(response)

            assert.strictEqual(result, 7200)
        })

        test('should calculate from max-age when no s-maxage', (t) => {
            const response = {
                headers: {
                    'cache-control': 'max-age=3600',
                    'date': new Date().toUTCString()
                }
            }

            const result = calculateFreshnessLifetime(response)

            assert.strictEqual(result, 3600)
        })

        test('should calculate from Expires header when no cache-control', (t) => {
            const now = new Date()
            const expires = new Date(now.getTime() + 3600000) // 1 hour from now

            const response = {
                headers: {
                    'date': now.toUTCString(),
                    'expires': expires.toUTCString()
                }
            }

            const result = calculateFreshnessLifetime(response)

            // Should be approximately 3600 seconds (allow small variance)
            assert.ok(result >= 3599 && result <= 3601)
        })

        test('should return 0 when no freshness information', (t) => {
            const response = {
                headers: {
                    'date': new Date().toUTCString()
                }
            }

            const result = calculateFreshnessLifetime(response)

            assert.strictEqual(result, 0)
        })
    })

    suite('calculateAge', () => {

        test('should calculate age from Age header', (t) => {
            const now = Math.floor(Date.now() / 1000)
            const response = {
                headers: {
                    'age': '100',
                    'date': new Date().toUTCString()
                },
                requestTime: now,
                responseTime: now
            }

            const result = calculateAge(response)

            // Age should be at least 100
            assert.ok(result >= 100)
        })

        test('should calculate age without Age header', (t) => {
            const now = Math.floor(Date.now() / 1000)
            const response = {
                headers: {
                    'date': new Date((now - 10) * 1000).toUTCString()
                },
                requestTime: now,
                responseTime: now
            }

            const result = calculateAge(response)

            // Age should be at least 10 seconds
            assert.ok(result >= 10)
        })

        test('should handle invalid Age header', (t) => {
            const now = Math.floor(Date.now() / 1000)
            const response = {
                headers: {
                    'age': 'invalid',
                    'date': new Date().toUTCString()
                },
                requestTime: now,
                responseTime: now
            }

            const result = calculateAge(response)

            // Should default to 0 for invalid age
            assert.ok(result >= 0)
        })
    })

    suite('cleanUpHeader', () => {

        test('should remove connection header and related headers', (t) => {
            const entry = {
                headers: {
                    'connection': 'keep-alive, upgrade',
                    'keep-alive': 'timeout=5',
                    'upgrade': 'websocket',
                    'content-type': 'application/json'
                }
            }

            cleanUpHeader(entry, {})

            assert.strictEqual(entry.headers.connection, undefined)
            assert.strictEqual(entry.headers['keep-alive'], undefined)
            assert.strictEqual(entry.headers.upgrade, undefined)
            assert.strictEqual(entry.headers['content-type'], 'application/json')
        })

        test('should remove qualified no-cache headers', (t) => {
            const entry = {
                headers: {
                    'cache-control': 'no-cache="set-cookie"',
                    'set-cookie': 'session=abc123',
                    'content-type': 'text/html'
                }
            }

            const cacheDirectives = {
                'no-cache': '"set-cookie"'
            }

            cleanUpHeader(entry, cacheDirectives)

            // Should remove the set-cookie header as specified in no-cache directive
            assert.strictEqual(entry.headers['set-cookie'], undefined)
            assert.strictEqual(entry.headers['content-type'], 'text/html')
        })

        test('should remove qualified private headers', (t) => {
            const entry = {
                headers: {
                    'cache-control': 'private="authorization"',
                    'authorization': 'Bearer token',
                    'content-type': 'application/json'
                }
            }

            const cacheDirectives = {
                'private': '"authorization"'
            }

            cleanUpHeader(entry, cacheDirectives)

            // Should remove the authorization header as specified in private directive
            assert.strictEqual(entry.headers.authorization, undefined)
            assert.strictEqual(entry.headers['content-type'], 'application/json')
        })
    })

    suite('ensureValidDateHeader', () => {

        test('should add Date header when missing', (t) => {
            const response = {
                headers: {}
            }
            const responseTime = Date.now()

            ensureValidDateHeader(response, responseTime)

            assert.ok(response.headers.date)
            assert.ok(!isNaN(Date.parse(response.headers.date)))
        })

        test('should replace invalid Date header', (t) => {
            const response = {
                headers: {
                    'date': 'invalid-date'
                }
            }
            const responseTime = Date.now()

            ensureValidDateHeader(response, responseTime)

            assert.ok(response.headers.date)
            assert.ok(!isNaN(Date.parse(response.headers.date)))
        })

        test('should keep valid Date header', (t) => {
            const validDate = new Date().toUTCString()
            const response = {
                headers: {
                    'date': validDate
                }
            }
            const responseTime = Date.now()

            ensureValidDateHeader(response, responseTime)

            assert.strictEqual(response.headers.date, validDate)
        })
    })

    suite('cloneAndTrimResponse', () => {

        test('should clone response with all properties', (t) => {
            const response = {
                statusCode: 200,
                body: 'test body',
                headers: {
                    'content-type': 'text/plain',
                    'cache-control': 'max-age=3600'
                },
                requestTime: 1000,
                responseTime: 1100,
                ttl: 3600
            }

            const result = cloneAndTrimResponse(response)

            assert.strictEqual(result.statusCode, 200)
            assert.strictEqual(result.body, 'test body')
            assert.strictEqual(result.requestTime, 1000)
            assert.strictEqual(result.responseTime, 1100)
            assert.strictEqual(result.ttl, 3600)
            assert.deepStrictEqual(result.headers, response.headers)
            // Ensure it's a deep clone
            assert.notStrictEqual(result.headers, response.headers)
        })

        test('should default ttl to 0 when not present', (t) => {
            const response = {
                statusCode: 404,
                body: 'Not found',
                headers: {},
                requestTime: 1000,
                responseTime: 1100
            }

            const result = cloneAndTrimResponse(response)

            assert.strictEqual(result.ttl, 0)
        })
    })

    suite('getOrigin', () => {

        test('should extract origin from URL', (t) => {
            const mockServer = {}
            const request = {
                originalUrl: '/myorigin/path/to/resource'
            }

            const result = getOrigin(mockServer, request)

            assert.strictEqual(result, 'myorigin')
        })

        test('should return null for invalid URL', (t) => {
            const mockServer = {}
            const request = {
                originalUrl: '/'
            }

            const result = getOrigin(mockServer, request)

            assert.strictEqual(result, null)
        })

        test('should extract origin from complex URL', (t) => {
            const mockServer = {}
            const request = {
                originalUrl: '/api/v1/users/123?param=value'
            }

            const result = getOrigin(mockServer, request)

            assert.strictEqual(result, 'api')
        })
    })
})

