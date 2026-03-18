import { suite, test } from 'node:test'
import assert from 'node:assert'
import { deleteJsonPaths, keepJsonPaths } from '../../src/actions/json.js'

suite('JSON Actions', () => {

    suite('deleteJsonPaths', () => {

        test('should delete simple path from JSON', (t) => {
            const target = {
                body: JSON.stringify({
                    name: 'John',
                    email: 'john@example.com',
                    password: 'secret123'
                })
            }

            const params = {
                jsonpaths: ['$.password']
            }

            deleteJsonPaths(target, params)

            const result = JSON.parse(target.body)
            assert.strictEqual(result.name, 'John')
            assert.strictEqual(result.email, 'john@example.com')
            assert.strictEqual(result.password, undefined)
        })

        test('should delete nested path from JSON', (t) => {
            const target = {
                body: JSON.stringify({
                    user: {
                        name: 'Jane',
                        credentials: {
                            password: 'secret',
                            apiKey: 'key123'
                        }
                    }
                })
            }

            const params = {
                jsonpaths: ['$.user.credentials.password']
            }

            deleteJsonPaths(target, params)

            const result = JSON.parse(target.body)
            assert.strictEqual(result.user.name, 'Jane')
            assert.strictEqual(result.user.credentials.apiKey, 'key123')
            assert.strictEqual(result.user.credentials.password, undefined)
        })

        test('should delete multiple paths from JSON', (t) => {
            const target = {
                body: JSON.stringify({
                    id: 1,
                    name: 'Product',
                    internalCode: 'ABC123',
                    price: 99.99,
                    cost: 50.00
                })
            }

            const params = {
                jsonpaths: ['$.internalCode', '$.cost']
            }

            deleteJsonPaths(target, params)

            const result = JSON.parse(target.body)
            assert.strictEqual(result.id, 1)
            assert.strictEqual(result.name, 'Product')
            assert.strictEqual(result.price, 99.99)
            assert.strictEqual(result.internalCode, undefined)
            assert.strictEqual(result.cost, undefined)
        })

        test('should delete array elements matching path', (t) => {
            const target = {
                body: JSON.stringify({
                    users: [
                        { name: 'Alice', password: 'pass1' },
                        { name: 'Bob', password: 'pass2' }
                    ]
                })
            }

            const params = {
                jsonpaths: ['$..password']
            }

            deleteJsonPaths(target, params)

            const result = JSON.parse(target.body)
            assert.strictEqual(result.users[0].name, 'Alice')
            assert.strictEqual(result.users[0].password, undefined)
            assert.strictEqual(result.users[1].name, 'Bob')
            assert.strictEqual(result.users[1].password, undefined)
        })

        test('should handle invalid JSON gracefully', (t) => {
            const target = {
                body: 'invalid json'
            }

            const params = {
                jsonpaths: ['$.password']
            }

            // Should not throw
            deleteJsonPaths(target, params)

            // Body should remain unchanged
            assert.strictEqual(target.body, 'invalid json')
        })

        test('should handle non-existent paths gracefully', (t) => {
            const target = {
                body: JSON.stringify({
                    name: 'Test'
                })
            }

            const params = {
                jsonpaths: ['$.nonexistent.path']
            }

            deleteJsonPaths(target, params)

            const result = JSON.parse(target.body)
            assert.strictEqual(result.name, 'Test')
        })

        test('should do nothing when params has no jsonpaths', (t) => {
            const originalBody = JSON.stringify({ name: 'Test' })
            const target = {
                body: originalBody
            }

            const params = {}

            deleteJsonPaths(target, params)

            assert.strictEqual(target.body, originalBody)
        })
    })

    suite('keepJsonPaths', () => {

        test('should keep only specified simple path', (t) => {
            const target = {
                body: JSON.stringify({
                    name: 'John',
                    email: 'john@example.com',
                    password: 'secret123',
                    age: 30
                })
            }

            const params = {
                jsonpaths: ['$.name', '$.email']
            }

            keepJsonPaths(target, params)

            const result = JSON.parse(target.body)
            assert.strictEqual(result.name, 'John')
            assert.strictEqual(result.email, 'john@example.com')
            assert.strictEqual(result.password, undefined)
            assert.strictEqual(result.age, undefined)
        })

        test('should keep nested paths', (t) => {
            const target = {
                body: JSON.stringify({
                    user: {
                        name: 'Jane',
                        email: 'jane@example.com',
                        credentials: {
                            password: 'secret',
                            apiKey: 'key123'
                        }
                    },
                    metadata: {
                        created: '2024-01-01'
                    }
                })
            }

            const params = {
                jsonpaths: ['$.user.name', '$.user.email']
            }

            keepJsonPaths(target, params)

            const result = JSON.parse(target.body)
            assert.strictEqual(result.user.name, 'Jane')
            assert.strictEqual(result.user.email, 'jane@example.com')
            assert.strictEqual(result.user.credentials, undefined)
            assert.strictEqual(result.metadata, undefined)
        })

        test('should keep array elements matching path', (t) => {
            const target = {
                body: JSON.stringify({
                    users: [
                        { name: 'Alice', age: 25, password: 'pass1' },
                        { name: 'Bob', age: 30, password: 'pass2' }
                    ]
                })
            }

            const params = {
                jsonpaths: ['$..name']
            }

            keepJsonPaths(target, params)

            const result = JSON.parse(target.body)
            assert.ok(result.users)
            assert.strictEqual(result.users[0].name, 'Alice')
            assert.strictEqual(result.users[1].name, 'Bob')
        })

        test('should handle invalid JSON gracefully', (t) => {
            const target = {
                body: 'invalid json'
            }

            const params = {
                jsonpaths: ['$.name']
            }

            // Should not throw
            keepJsonPaths(target, params)

            // Body should remain unchanged
            assert.strictEqual(target.body, 'invalid json')
        })

        test('should create empty object when no paths match', (t) => {
            const target = {
                body: JSON.stringify({
                    name: 'Test',
                    value: 123
                })
            }

            const params = {
                jsonpaths: ['$.nonexistent']
            }

            keepJsonPaths(target, params)

            const result = JSON.parse(target.body)
            assert.deepStrictEqual(result, {})
        })

        test('should do nothing when params has no jsonpaths', (t) => {
            const target = {
                body: JSON.stringify({ name: 'Test' })
            }

            const params = {}

            keepJsonPaths(target, params)

            const result = JSON.parse(target.body)
            assert.deepStrictEqual(result, {})
        })

        test('should preserve structure when keeping deep paths', (t) => {
            const target = {
                body: JSON.stringify({
                    level1: {
                        level2: {
                            level3: {
                                value: 'deep',
                                other: 'data'
                            }
                        }
                    }
                })
            }

            const params = {
                jsonpaths: ['$.level1.level2.level3.value']
            }

            keepJsonPaths(target, params)

            const result = JSON.parse(target.body)
            assert.strictEqual(result.level1.level2.level3.value, 'deep')
            assert.strictEqual(result.level1.level2.level3.other, undefined)
        })
    })
})

