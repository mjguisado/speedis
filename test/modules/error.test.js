import { suite, test } from 'node:test'
import assert from 'node:assert'
import { errorHandler } from '../../src/modules/error.js'

suite('Error Module', () => {

    suite('errorHandler', () => {

        test('should send error details when exposeErrors is true', (t) => {
            const mockReply = {
                statusCode: null,
                headers: {},
                body: null,
                code: function(code) {
                    this.statusCode = code
                    return this
                },
                header: function(name, value) {
                    this.headers[name] = value
                    return this
                },
                send: function(data) {
                    this.body = data
                    return this
                }
            }

            const result = errorHandler(mockReply, 500, 'Internal Server Error', true)

            assert.strictEqual(mockReply.statusCode, 500)
            assert.ok(mockReply.headers['date'])
            assert.strictEqual(mockReply.headers['content-type'], 'application/json')
            assert.deepStrictEqual(mockReply.body, { msg: 'Internal Server Error' })
        })

        test('should send error details with cause when exposeErrors is true', (t) => {
            const mockReply = {
                statusCode: null,
                headers: {},
                body: null,
                code: function(code) {
                    this.statusCode = code
                    return this
                },
                header: function(name, value) {
                    this.headers[name] = value
                    return this
                },
                send: function(data) {
                    this.body = data
                    return this
                }
            }

            const cause = new Error('Database connection failed')
            const result = errorHandler(mockReply, 503, 'Service Unavailable', true, cause)

            assert.strictEqual(mockReply.statusCode, 503)
            assert.ok(mockReply.headers['date'])
            assert.strictEqual(mockReply.headers['content-type'], 'application/json')
            assert.strictEqual(mockReply.body.msg, 'Service Unavailable')
            assert.ok(mockReply.body.cause.includes('Database connection failed'))
        })

        test('should not send error details when exposeErrors is false', (t) => {
            const mockReply = {
                statusCode: null,
                headers: {},
                body: null,
                code: function(code) {
                    this.statusCode = code
                    return this
                },
                header: function(name, value) {
                    this.headers[name] = value
                    return this
                },
                send: function(data) {
                    this.body = data
                    return this
                }
            }

            const result = errorHandler(mockReply, 404, 'Not Found', false)

            assert.strictEqual(mockReply.statusCode, 404)
            assert.ok(mockReply.headers['date'])
            assert.strictEqual(mockReply.headers['content-type'], undefined)
            assert.strictEqual(mockReply.body, undefined)
        })

        test('should not send error details when exposeErrors is false even with cause', (t) => {
            const mockReply = {
                statusCode: null,
                headers: {},
                body: null,
                code: function(code) {
                    this.statusCode = code
                    return this
                },
                header: function(name, value) {
                    this.headers[name] = value
                    return this
                },
                send: function(data) {
                    this.body = data
                    return this
                }
            }

            const cause = new Error('Some internal error')
            const result = errorHandler(mockReply, 500, 'Internal Server Error', false, cause)

            assert.strictEqual(mockReply.statusCode, 500)
            assert.ok(mockReply.headers['date'])
            assert.strictEqual(mockReply.headers['content-type'], undefined)
            assert.strictEqual(mockReply.body, undefined)
        })

        test('should handle different status codes correctly', (t) => {
            const mockReply = {
                statusCode: null,
                headers: {},
                body: null,
                code: function(code) {
                    this.statusCode = code
                    return this
                },
                header: function(name, value) {
                    this.headers[name] = value
                    return this
                },
                send: function(data) {
                    this.body = data
                    return this
                }
            }

            errorHandler(mockReply, 400, 'Bad Request', true)
            assert.strictEqual(mockReply.statusCode, 400)
            assert.strictEqual(mockReply.body.msg, 'Bad Request')
        })
    })
})

