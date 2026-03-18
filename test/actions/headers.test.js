import { describe, it, suite, test } from 'node:test'
import assert from 'node:assert'
import {
    setCacheControlByStatusCode,
    setHeaders,
    deleteHeaders,
    setLastModifiedAndDateHeaders
} from '../../src/actions/headers.js'

suite('Headers Actions', () => {

    suite('setHeaders', () => {

        test('should set single header', (t) => {
            const target = {
                headers: {}
            }

            const params = {
                'Content-Type': 'application/json'
            }

            setHeaders(target, params)

            assert.strictEqual(target.headers['content-type'], 'application/json')
        })

        test('should set multiple headers', (t) => {
            const target = {
                headers: {}
            }

            const params = {
                'Content-Type': 'text/html',
                'Cache-Control': 'max-age=3600',
                'X-Custom-Header': 'custom-value'
            }

            setHeaders(target, params)

            assert.strictEqual(target.headers['content-type'], 'text/html')
            assert.strictEqual(target.headers['cache-control'], 'max-age=3600')
            assert.strictEqual(target.headers['x-custom-header'], 'custom-value')
        })

        test('should overwrite existing headers', (t) => {
            const target = {
                headers: {
                    'content-type': 'text/plain'
                }
            }

            const params = {
                'Content-Type': 'application/json'
            }

            setHeaders(target, params)

            assert.strictEqual(target.headers['content-type'], 'application/json')
        })

        test('should convert header names to lowercase', (t) => {
            const target = {
                headers: {}
            }

            const params = {
                'X-UPPERCASE-HEADER': 'value'
            }

            setHeaders(target, params)

            assert.strictEqual(target.headers['x-uppercase-header'], 'value')
        })
    })

    suite('deleteHeaders', () => {

        test('should delete single header', (t) => {
            const target = {
                headers: {
                    'content-type': 'application/json',
                    'cache-control': 'max-age=3600'
                }
            }

            const params = {
                'Content-Type': true
            }

            deleteHeaders(target, params)

            assert.strictEqual(target.headers['content-type'], undefined)
            assert.strictEqual(target.headers['cache-control'], 'max-age=3600')
        })

        test('should delete multiple headers', (t) => {
            const target = {
                headers: {
                    'content-type': 'application/json',
                    'cache-control': 'max-age=3600',
                    'x-custom': 'value'
                }
            }

            const params = {
                'Content-Type': true,
                'X-Custom': true
            }

            deleteHeaders(target, params)

            assert.strictEqual(target.headers['content-type'], undefined)
            assert.strictEqual(target.headers['x-custom'], undefined)
            assert.strictEqual(target.headers['cache-control'], 'max-age=3600')
        })

        test('should handle case-insensitive header names', (t) => {
            const target = {
                headers: {
                    'content-type': 'application/json'
                }
            }

            const params = {
                'CONTENT-TYPE': true
            }

            deleteHeaders(target, params)

            assert.strictEqual(target.headers['content-type'], undefined)
        })

        test('should not throw when deleting non-existent header', (t) => {
            const target = {
                headers: {
                    'content-type': 'application/json'
                }
            }

            const params = {
                'Non-Existent': true
            }

            deleteHeaders(target, params)

            assert.strictEqual(target.headers['content-type'], 'application/json')
        })
    })

    suite('setLastModifiedAndDateHeaders', () => {

        test('should set both Last-Modified and Date headers', (t) => {
            const target = {
                headers: {}
            }

            setLastModifiedAndDateHeaders(target, {})

            assert.ok(target.headers['last-modified'])
            assert.ok(target.headers['date'])
        })

        test('should set headers to same value', (t) => {
            const target = {
                headers: {}
            }

            setLastModifiedAndDateHeaders(target, {})

            assert.strictEqual(target.headers['last-modified'], target.headers['date'])
        })

        test('should set valid UTC date string', (t) => {
            const target = {
                headers: {}
            }

            setLastModifiedAndDateHeaders(target, {})

            const date = new Date(target.headers['date'])
            assert.ok(!isNaN(date.getTime()))
        })

        test('should overwrite existing headers', (t) => {
            const target = {
                headers: {
                    'last-modified': 'old-date',
                    'date': 'old-date'
                }
            }

            setLastModifiedAndDateHeaders(target, {})

            assert.notStrictEqual(target.headers['last-modified'], 'old-date')
            assert.notStrictEqual(target.headers['date'], 'old-date')
        })
    })

describe('setCacheControlByStatusCode', () => {

    it('should set cache-control for specific status code', () => {
        const target = {
            statusCode: 404,
            headers: {}
        }
        const params = {
            statusCodeRules: {
                "200": "public, max-age=3600",
                "404": "public, max-age=60",
                "5xx": "no-cache"
            }
        }
        
        setCacheControlByStatusCode(target, params)
        
        assert.strictEqual(target.headers['cache-control'], 'public, max-age=60')
    })

    it('should set cache-control for status code range', () => {
        const target = {
            statusCode: 500,
            headers: {}
        }
        const params = {
            statusCodeRules: {
                "200": "public, max-age=3600",
                "404": "public, max-age=60",
                "5xx": "no-cache"
            }
        }
        
        setCacheControlByStatusCode(target, params)
        
        assert.strictEqual(target.headers['cache-control'], 'no-cache')
    })

    it('should not modify cache-control when no rule matches', () => {
        const target = {
            statusCode: 301,
            headers: {
                'cache-control': 'public, max-age=86400'
            }
        }
        const params = {
            statusCodeRules: {
                "200": "public, max-age=3600",
                "404": "public, max-age=60"
            }
        }

        setCacheControlByStatusCode(target, params)

        // Original cache-control should be preserved
        assert.strictEqual(target.headers['cache-control'], 'public, max-age=86400')
    })

    it('should prioritize specific over range', () => {
        const target = {
            statusCode: 404,
            headers: {}
        }
        const params = {
            statusCodeRules: {
                "404": "public, max-age=60",
                "4xx": "public, max-age=120"
            }
        }

        setCacheControlByStatusCode(target, params)

        assert.strictEqual(target.headers['cache-control'], 'public, max-age=60')
    })

    it('should use range when specific not found', () => {
        const target = {
            statusCode: 410,
            headers: {}
        }
        const params = {
            statusCodeRules: {
                "404": "public, max-age=60",
                "4xx": "public, max-age=120"
            }
        }

        setCacheControlByStatusCode(target, params)

        assert.strictEqual(target.headers['cache-control'], 'public, max-age=120')
    })

    it('should not set cache-control if no rule matches', () => {
        const target = {
            statusCode: 301,
            headers: {}
        }
        const params = {
            statusCodeRules: {
                "200": "public, max-age=3600",
                "404": "public, max-age=60"
            }
        }

        setCacheControlByStatusCode(target, params)

        assert.strictEqual(target.headers['cache-control'], undefined)
    })

    it('should handle 2xx range', () => {
        const target = {
            statusCode: 204,
            headers: {}
        }
        const params = {
            statusCodeRules: {
                "2xx": "public, max-age=3600"
            }
        }
        
        setCacheControlByStatusCode(target, params)
        
        assert.strictEqual(target.headers['cache-control'], 'public, max-age=3600')
    })

    it('should handle no-store directive', () => {
        const target = {
            statusCode: 403,
            headers: {}
        }
        const params = {
            statusCodeRules: {
                "403": "no-store",
                "401": "no-store"
            }
        }
        
        setCacheControlByStatusCode(target, params)
        
        assert.strictEqual(target.headers['cache-control'], 'no-store')
    })

    it('should do nothing if params is null', () => {
        const target = {
            statusCode: 200,
            headers: {}
        }
        
        setCacheControlByStatusCode(target, null)
        
        assert.strictEqual(target.headers['cache-control'], undefined)
    })

    it('should do nothing if statusCodeRules is missing', () => {
        const target = {
            statusCode: 200,
            headers: {}
        }
        const params = {}
        
        setCacheControlByStatusCode(target, params)
        
        assert.strictEqual(target.headers['cache-control'], undefined)
    })
})

})

