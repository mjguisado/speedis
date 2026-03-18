import { suite, test } from 'node:test'
import assert from 'node:assert'
import { _normalizeSimpleObject, _normalizeComplexObject } from '../../src/modules/variantTracker.js'

suite('VariantTracker Module', () => {

    suite('_normalizeSimpleObject', () => {

        test('should normalize object with sorted keys', (t) => {
            const input = {
                z: 'last',
                a: 'first',
                m: 'middle'
            }

            const result = _normalizeSimpleObject(input)

            const keys = Object.keys(result)
            assert.deepStrictEqual(keys, ['a', 'm', 'z'])
            assert.strictEqual(result.a, 'first')
            assert.strictEqual(result.m, 'middle')
            assert.strictEqual(result.z, 'last')
        })

        test('should normalize nested objects with sorted keys', (t) => {
            const input = {
                user: {
                    name: 'John',
                    age: 30,
                    email: 'john@example.com'
                },
                settings: {
                    theme: 'dark',
                    language: 'en'
                }
            }

            const result = _normalizeSimpleObject(input)

            assert.deepStrictEqual(Object.keys(result), ['settings', 'user'])
            assert.deepStrictEqual(Object.keys(result.user), ['age', 'email', 'name'])
            assert.deepStrictEqual(Object.keys(result.settings), ['language', 'theme'])
        })

        test('should normalize arrays preserving order', (t) => {
            const input = {
                items: [
                    { z: 3, a: 1 },
                    { b: 2, a: 1 }
                ]
            }

            const result = _normalizeSimpleObject(input)

            assert.strictEqual(result.items.length, 2)
            assert.deepStrictEqual(Object.keys(result.items[0]), ['a', 'z'])
            assert.deepStrictEqual(Object.keys(result.items[1]), ['a', 'b'])
        })

        test('should handle primitive values', (t) => {
            assert.strictEqual(_normalizeSimpleObject('string'), 'string')
            assert.strictEqual(_normalizeSimpleObject(123), 123)
            assert.strictEqual(_normalizeSimpleObject(true), true)
            assert.strictEqual(_normalizeSimpleObject(null), null)
        })

        test('should handle empty objects', (t) => {
            const result = _normalizeSimpleObject({})
            assert.deepStrictEqual(result, {})
        })

        test('should handle empty arrays', (t) => {
            const result = _normalizeSimpleObject([])
            assert.deepStrictEqual(result, [])
        })

        test('should handle deeply nested structures', (t) => {
            const input = {
                level1: {
                    z: 'z',
                    a: {
                        nested: {
                            z: 'deep',
                            a: 'value'
                        }
                    }
                }
            }

            const result = _normalizeSimpleObject(input)

            assert.deepStrictEqual(Object.keys(result.level1), ['a', 'z'])
            assert.deepStrictEqual(Object.keys(result.level1.a.nested), ['a', 'z'])
        })
    })

    suite('_normalizeComplexObject', () => {

        test('should normalize object with sorted keys', (t) => {
            const input = {
                z: 'last',
                a: 'first',
                m: 'middle'
            }

            const result = _normalizeComplexObject(input)

            const keys = Object.keys(result)
            assert.deepStrictEqual(keys, ['a', 'm', 'z'])
        })

        test('should normalize nested objects', (t) => {
            const input = {
                user: {
                    name: 'Jane',
                    id: 42
                }
            }

            const result = _normalizeComplexObject(input)

            assert.deepStrictEqual(Object.keys(result.user), ['id', 'name'])
        })

        test('should normalize arrays of objects', (t) => {
            const input = [
                { z: 1, a: 2 },
                { b: 3, a: 4 }
            ]

            const result = _normalizeComplexObject(input)

            assert.deepStrictEqual(Object.keys(result[0]), ['a', 'z'])
            assert.deepStrictEqual(Object.keys(result[1]), ['a', 'b'])
        })

        test('should handle null values', (t) => {
            const result = _normalizeComplexObject(null)
            assert.strictEqual(result, null)
        })

        test('should handle primitive values', (t) => {
            assert.strictEqual(_normalizeComplexObject('test'), 'test')
            assert.strictEqual(_normalizeComplexObject(100), 100)
            assert.strictEqual(_normalizeComplexObject(false), false)
        })
    })
})

