import { describe, it } from 'node:test'
import assert from 'node:assert'
import { setCacheControlByStatusCode } from '../../src/actions/headers.js'

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

