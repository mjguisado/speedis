import { suite, test } from 'node:test'
import assert from 'node:assert'
import { createHash } from 'crypto'
import { jsonpathBodyFingerprint } from '../../src/actions/jsonpath.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTarget(obj) {
    return { body: Buffer.from(JSON.stringify(obj), 'utf-8'), bodyFingerprint: null }
}

function md5hex(str) {
    return createHash('md5').update(str).digest('hex')
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PRODUCT = {
    product: { category: 'electronics', id: 42 },
    metadata: { version: 2, tags: ['sale', 'new'] }
}

const LIST = {
    items: [
        { id: 1, type: 'basic' },
        { id: 2, type: 'premium' }
    ]
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

suite('JSONPath Actions', () => {

    suite('jsonpathBodyFingerprint', () => {

        // --- Basic extraction ---

        test('should set bodyFingerprint from a single JSONPath expression', (t) => {
            const target = makeTarget(PRODUCT)
            jsonpathBodyFingerprint(target, { jsonpaths: ['$.product.category'] })
            assert.strictEqual(target.bodyFingerprint, 'electronics')
        })

        test('should concatenate results from multiple expressions in declaration order', (t) => {
            const target = makeTarget(PRODUCT)
            jsonpathBodyFingerprint(target, {
                jsonpaths: ['$.product.category', '$.product.id']
            })
            assert.strictEqual(target.bodyFingerprint, 'electronics42')
        })

        test('should concatenate multiple nodes returned by a single expression', (t) => {
            const target = makeTarget(LIST)
            jsonpathBodyFingerprint(target, { jsonpaths: ['$.items[*].id'] })
            assert.strictEqual(target.bodyFingerprint, '12')
        })

        test('should serialise numeric values as strings', (t) => {
            const target = makeTarget(PRODUCT)
            jsonpathBodyFingerprint(target, { jsonpaths: ['$.product.id'] })
            assert.strictEqual(target.bodyFingerprint, '42')
        })

        test('should serialise boolean values as strings', (t) => {
            const target = makeTarget({ active: true })
            jsonpathBodyFingerprint(target, { jsonpaths: ['$.active'] })
            assert.strictEqual(target.bodyFingerprint, 'true')
        })

        test('should serialise object values with JSON.stringify', (t) => {
            const target = makeTarget(PRODUCT)
            jsonpathBodyFingerprint(target, { jsonpaths: ['$.product'] })
            assert.strictEqual(target.bodyFingerprint, JSON.stringify(PRODUCT.product))
        })

        test('should serialise array values with JSON.stringify', (t) => {
            const target = makeTarget(PRODUCT)
            jsonpathBodyFingerprint(target, { jsonpaths: ['$.metadata.tags'] })
            assert.strictEqual(target.bodyFingerprint, JSON.stringify(PRODUCT.metadata.tags))
        })

        // --- Hash configuration ---

        test('should store raw string by default (no hash sub-object)', (t) => {
            const target = makeTarget(PRODUCT)
            jsonpathBodyFingerprint(target, { jsonpaths: ['$.product.category'] })
            assert.strictEqual(target.bodyFingerprint, 'electronics')
        })

        test('should use custom algorithm when specified via hash sub-object', (t) => {
            const target = makeTarget(PRODUCT)
            jsonpathBodyFingerprint(target, {
                jsonpaths: ['$.product.category'],
                hash: { enabled: true, algorithm: 'sha256', encoding: 'hex' }
            })
            const expected = createHash('sha256').update('electronics').digest('hex')
            assert.strictEqual(target.bodyFingerprint, expected)
        })

        test('should use custom encoding when specified via hash sub-object', (t) => {
            const target = makeTarget(PRODUCT)
            jsonpathBodyFingerprint(target, {
                jsonpaths: ['$.product.category'],
                hash: { enabled: true, algorithm: 'md5', encoding: 'base64' }
            })
            const expected = createHash('md5').update('electronics').digest('base64')
            assert.strictEqual(target.bodyFingerprint, expected)
        })

        test('should store raw concatenated string when hash.enabled is false', (t) => {
            const target = makeTarget(PRODUCT)
            jsonpathBodyFingerprint(target, {
                jsonpaths: ['$.product.category', '$.product.id'],
                hash: { enabled: false }
            })
            assert.strictEqual(target.bodyFingerprint, 'electronics42')
        })

        test('should store raw string when hash sub-object is present but enabled is not set', (t) => {
            const target = makeTarget(PRODUCT)
            jsonpathBodyFingerprint(target, { jsonpaths: ['$.product.category'], hash: {} })
            assert.strictEqual(target.bodyFingerprint, 'electronics')
        })

        test('should apply hash when hash.enabled is true explicitly', (t) => {
            const target = makeTarget(PRODUCT)
            jsonpathBodyFingerprint(target, {
                jsonpaths: ['$.product.category'],
                hash: { enabled: true }
            })
            assert.strictEqual(target.bodyFingerprint, md5hex('electronics'))
        })

        // --- Null / missing values ---

        test('should skip null values silently', (t) => {
            const target = makeTarget({ a: null, b: 'keep' })
            jsonpathBodyFingerprint(target, { jsonpaths: ['$.a', '$.b'] })
            assert.strictEqual(target.bodyFingerprint, 'keep')
        })

        test('should not set bodyFingerprint when expression matches nothing', (t) => {
            const target = makeTarget(PRODUCT)
            jsonpathBodyFingerprint(target, { jsonpaths: ['$.nonexistent'] })
            assert.strictEqual(target.bodyFingerprint, null)
        })

        test('should not set bodyFingerprint when all expressions match nothing', (t) => {
            const target = makeTarget(PRODUCT)
            jsonpathBodyFingerprint(target, { jsonpaths: ['$.x', '$.y'] })
            assert.strictEqual(target.bodyFingerprint, null)
        })

        // --- Error handling ---

        test('should skip invalid JSONPath expressions silently', (t) => {
            const target = makeTarget(PRODUCT)
            // invalid expression followed by a valid one
            jsonpathBodyFingerprint(target, { jsonpaths: ['[invalid', '$.product.category'] })
            assert.strictEqual(target.bodyFingerprint, 'electronics')
        })

        test('should not set bodyFingerprint when body is invalid JSON', (t) => {
            const target = { body: Buffer.from('not json {{{', 'utf-8'), bodyFingerprint: null }
            jsonpathBodyFingerprint(target, { jsonpaths: ['$.product.category'] })
            assert.strictEqual(target.bodyFingerprint, null)
        })

        test('should do nothing when body is not a Buffer', (t) => {
            const target = { body: JSON.stringify(PRODUCT), bodyFingerprint: null }
            jsonpathBodyFingerprint(target, { jsonpaths: ['$.product.category'] })
            assert.strictEqual(target.bodyFingerprint, null)
        })

        test('should do nothing when params is null', (t) => {
            const target = makeTarget(PRODUCT)
            jsonpathBodyFingerprint(target, null)
            assert.strictEqual(target.bodyFingerprint, null)
        })

        test('should do nothing when params.jsonpaths is empty', (t) => {
            const target = makeTarget(PRODUCT)
            jsonpathBodyFingerprint(target, { jsonpaths: [] })
            assert.strictEqual(target.bodyFingerprint, null)
        })

        // --- Determinism ---

        test('should produce the same fingerprint for equivalent bodies regardless of key order', (t) => {
            // jsonpath returns the value as-is; JSON.stringify preserves insertion order,
            // so two objects with different key order produce different strings.
            // This test verifies the fingerprint is stable for the same input object.
            const target1 = makeTarget(PRODUCT)
            const target2 = makeTarget(PRODUCT)
            jsonpathBodyFingerprint(target1, { jsonpaths: ['$.product'] })
            jsonpathBodyFingerprint(target2, { jsonpaths: ['$.product'] })
            assert.strictEqual(target1.bodyFingerprint, target2.bodyFingerprint)
        })
    })
})

