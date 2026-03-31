import { suite, test } from 'node:test'
import assert from 'node:assert'
import { createHash } from 'crypto'
import { xpathBodyFingerprint } from '../../src/actions/xmlxpath.js'

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

const SOAP_NS = {
    soap: 'http://schemas.xmlsoap.org/soap/envelope/',
    wsse: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd'
}

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

suite('XML XPath Actions', () => {

    suite('xpathBodyFingerprint', () => {

        test('should set bodyFingerprint from a single XPath expression', (t) => {
            const target = makeTarget(SOAP_XML)
            xpathBodyFingerprint(target, {
                xpaths: ['//soap:Body/text()'],
                namespaces: SOAP_NS
            })
            assert.strictEqual(target.bodyFingerprint, md5hex('getProducts'))
        })

        test('should concatenate results from multiple XPath expressions in declaration order', (t) => {
            const target = makeTarget(SOAP_XML)
            // wsse:UsernameToken is declared first → its text comes first
            xpathBodyFingerprint(target, {
                xpaths: ['//wsse:UsernameToken/text()', '//soap:Body/text()'],
                namespaces: SOAP_NS
            })
            assert.strictEqual(target.bodyFingerprint, md5hex('admingetProducts'))
        })

        test('should concatenate multiple nodes returned by a single expression', (t) => {
            const xml = `<root><item>foo</item><item>bar</item></root>`
            const target = makeTarget(xml)
            xpathBodyFingerprint(target, { xpaths: ['//item/text()'] })
            assert.strictEqual(target.bodyFingerprint, md5hex('foobar'))
        })

        test('should extract element text content including descendants', (t) => {
            const xml = `<root><wrapper><child>hello</child> world</wrapper></root>`
            const target = makeTarget(xml)
            xpathBodyFingerprint(target, { xpaths: ['//wrapper'] })
            assert.strictEqual(target.bodyFingerprint, md5hex('hello world'))
        })

        test('should extract attribute value', (t) => {
            const xml = `<root><item id="42">value</item></root>`
            const target = makeTarget(xml)
            xpathBodyFingerprint(target, { xpaths: ['//item/@id'] })
            assert.strictEqual(target.bodyFingerprint, md5hex('42'))
        })

        test('should filter with XPath predicate on attribute value', (t) => {
            const xml = `<root><item type="basic">A</item><item type="premium">B</item></root>`
            const target = makeTarget(xml)
            xpathBodyFingerprint(target, { xpaths: ['//item[@type="premium"]/text()'] })
            assert.strictEqual(target.bodyFingerprint, md5hex('B'))
        })

        test('should select element by position', (t) => {
            const xml = `<root><param>first</param><param>second</param></root>`
            const target = makeTarget(xml)
            xpathBodyFingerprint(target, { xpaths: ['//param[2]/text()'] })
            assert.strictEqual(target.bodyFingerprint, md5hex('second'))
        })

        test('should match ignoring namespace prefix via local-name()', (t) => {
            const target = makeTarget(SOAP_XML)
            // No namespaces map needed when using local-name()
            xpathBodyFingerprint(target, {
                xpaths: ['//*[local-name()="Body"]/text()']
            })
            assert.strictEqual(target.bodyFingerprint, md5hex('getProducts'))
        })

        test('should accept a Buffer as target.body', (t) => {
            const target = makeTarget(SOAP_XML)
            assert.ok(Buffer.isBuffer(target.body))
            xpathBodyFingerprint(target, {
                xpaths: ['//soap:Body/text()'],
                namespaces: SOAP_NS
            })
            assert.ok(target.bodyFingerprint)
        })

        test('should use md5/hex by default', (t) => {
            const target = makeTarget(SOAP_XML)
            xpathBodyFingerprint(target, {
                xpaths: ['//soap:Body/text()'],
                namespaces: SOAP_NS
            })
            assert.match(target.bodyFingerprint, /^[0-9a-f]{32}$/)
        })

        test('should use custom algorithm and encoding', (t) => {
            const target = makeTarget(SOAP_XML)
            xpathBodyFingerprint(target, {
                xpaths: ['//soap:Body/text()'],
                namespaces: SOAP_NS,
                algorithm: 'sha256',
                encoding: 'base64'
            })
            const expected = createHash('sha256').update('getProducts').digest('base64')
            assert.strictEqual(target.bodyFingerprint, expected)
        })

        test('should ignore XPath expressions that match nothing', (t) => {
            const target = makeTarget(SOAP_XML)
            xpathBodyFingerprint(target, { xpaths: ['//nonexistent/text()'] })
            assert.strictEqual(target.bodyFingerprint, null)
        })

        test('should skip invalid XPath expressions silently', (t) => {
            const xml = `<root><item>text</item></root>`
            const target = makeTarget(xml)
            // '///invalid' is not valid XPath; the valid expression should still work
            xpathBodyFingerprint(target, { xpaths: ['///invalid', '//item/text()'] })
            assert.strictEqual(target.bodyFingerprint, md5hex('text'))
        })

        test('should ignore invalid XML silently and not set bodyFingerprint', (t) => {
            const target = makeTarget('this is not xml <<>>')
            xpathBodyFingerprint(target, { xpaths: ['//item/text()'] })
            assert.strictEqual(target.bodyFingerprint, null)
        })

        test('should do nothing when params is null', (t) => {
            const target = makeTarget(SOAP_XML)
            xpathBodyFingerprint(target, null)
            assert.strictEqual(target.bodyFingerprint, null)
        })

        test('should do nothing when params.xpaths is empty', (t) => {
            const target = makeTarget(SOAP_XML)
            xpathBodyFingerprint(target, { xpaths: [] })
            assert.strictEqual(target.bodyFingerprint, null)
        })

        test('should do nothing when body is not a Buffer', (t) => {
            const target = { body: '<root><item>text</item></root>', bodyFingerprint: null }
            xpathBodyFingerprint(target, { xpaths: ['//item/text()'] })
            assert.strictEqual(target.bodyFingerprint, null)
        })
    })
})
