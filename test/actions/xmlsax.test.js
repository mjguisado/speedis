import { suite, test } from 'node:test'
import assert from 'node:assert'
import { createHash } from 'crypto'
import { xmlBodyFingerprint } from '../../src/actions/xmlsax.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTarget(xmlString) {
    return { body: Buffer.from(xmlString, 'utf-8'), bodyFingerprint: null }
}

function md5hex(str) {
    return createHash('md5').update(str).digest('hex')
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SOAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
  <soap:Header>
    <wsse:Security>
      <wsse:UsernameToken>admin</wsse:UsernameToken>
    </wsse:Security>
  </soap:Header>
  <soap:Body>getProducts</soap:Body>
</soap:Envelope>`

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

suite('XML Actions', () => {

    suite('xmlBodyFingerprint', () => {

        test('should set bodyFingerprint from a single element', (t) => {
            const target = makeTarget(SOAP_XML)
            xmlBodyFingerprint(target, { elements: ['soap:Body'] })
            assert.strictEqual(target.bodyFingerprint, md5hex('getProducts'))
        })

        test('should set bodyFingerprint from multiple elements concatenated in document order', (t) => {
            const target = makeTarget(SOAP_XML)
            // wsse:UsernameToken appears before soap:Body in the document
            xmlBodyFingerprint(target, { elements: ['wsse:UsernameToken', 'soap:Body'] })
            assert.strictEqual(target.bodyFingerprint, md5hex('admingetProducts'))
        })

        test('should concatenate multiple occurrences of the same element', (t) => {
            const xml = `<root><item>foo</item><item>bar</item></root>`
            const target = makeTarget(xml)
            xmlBodyFingerprint(target, { elements: ['item'] })
            assert.strictEqual(target.bodyFingerprint, md5hex('foobar'))
        })

        test('should accept a Buffer as target.body', (t) => {
            const target = makeTarget(SOAP_XML)
            assert.ok(Buffer.isBuffer(target.body), 'precondition: body must be a Buffer')
            xmlBodyFingerprint(target, { elements: ['soap:Body'] })
            assert.ok(target.bodyFingerprint)
        })

        test('should use md5/hex by default', (t) => {
            const target = makeTarget(SOAP_XML)
            xmlBodyFingerprint(target, { elements: ['soap:Body'] })
            // md5 hex is always 32 hex characters
            assert.match(target.bodyFingerprint, /^[0-9a-f]{32}$/)
        })

        test('should use custom algorithm when specified', (t) => {
            const target = makeTarget(SOAP_XML)
            xmlBodyFingerprint(target, { elements: ['soap:Body'], algorithm: 'sha256', encoding: 'hex' })
            const expected = createHash('sha256').update('getProducts').digest('hex')
            assert.strictEqual(target.bodyFingerprint, expected)
        })

        test('should use custom encoding when specified', (t) => {
            const target = makeTarget(SOAP_XML)
            xmlBodyFingerprint(target, { elements: ['soap:Body'], algorithm: 'md5', encoding: 'base64' })
            const expected = createHash('md5').update('getProducts').digest('base64')
            assert.strictEqual(target.bodyFingerprint, expected)
        })

        test('should ignore elements not present in the XML', (t) => {
            const target = makeTarget(SOAP_XML)
            xmlBodyFingerprint(target, { elements: ['nonexistent:Element'] })
            // No match → fingerprint must remain null (not set)
            assert.strictEqual(target.bodyFingerprint, null)
        })

        test('should be case-sensitive when matching element names', (t) => {
            const xml = `<root><Item>value</Item></root>`
            const target = makeTarget(xml)
            // 'item' (lowercase) must NOT match 'Item'
            xmlBodyFingerprint(target, { elements: ['item'] })
            assert.strictEqual(target.bodyFingerprint, null)
        })

        test('should capture text from nested elements inside a target element', (t) => {
            const xml = `<root><wrapper><child>hello</child> world</wrapper></root>`
            const target = makeTarget(xml)
            // 'wrapper' text = "hello" (from child) + " world" (direct text node)
            xmlBodyFingerprint(target, { elements: ['wrapper'] })
            assert.strictEqual(target.bodyFingerprint, md5hex('hello world'))
        })

        test('should handle CDATA sections', (t) => {
            const xml = `<root><data><![CDATA[raw & content]]></data></root>`
            const target = makeTarget(xml)
            xmlBodyFingerprint(target, { elements: ['data'] })
            assert.strictEqual(target.bodyFingerprint, md5hex('raw & content'))
        })

        test('should ignore invalid XML silently and not set bodyFingerprint', (t) => {
            const target = makeTarget('this is not xml <<>>')
            xmlBodyFingerprint(target, { elements: ['soap:Body'] })
            assert.strictEqual(target.bodyFingerprint, null)
        })

        test('should do nothing when params is null', (t) => {
            const target = makeTarget(SOAP_XML)
            xmlBodyFingerprint(target, null)
            assert.strictEqual(target.bodyFingerprint, null)
        })

        test('should do nothing when params.elements is empty', (t) => {
            const target = makeTarget(SOAP_XML)
            xmlBodyFingerprint(target, { elements: [] })
            assert.strictEqual(target.bodyFingerprint, null)
        })

        test('should do nothing when body is not a Buffer', (t) => {
            const target = { body: '<root><item>text</item></root>', bodyFingerprint: null }
            xmlBodyFingerprint(target, { elements: ['item'] })
            assert.strictEqual(target.bodyFingerprint, null)
        })

        test('should handle nested same-name elements without mixing their texts', (t) => {
            // Outer <section> contains inner <section>. Both are target elements.
            // Inner closes first → results = ["inner", "outer inner"]
            const xml = `<root><section>outer <section>inner</section></section></root>`
            const target = makeTarget(xml)
            xmlBodyFingerprint(target, { elements: ['section'] })
            // Inner: "inner", Outer: "outer inner"  → concat = "innerouter inner"
            assert.strictEqual(target.bodyFingerprint, md5hex('innerouter inner'))
        })
    })
})
