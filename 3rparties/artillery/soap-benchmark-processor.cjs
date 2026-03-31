'use strict'

// ---------------------------------------------------------------------------
// SOAP payload generators
//
// Each function returns a complete SOAP envelope whose body content depends
// on the `requestId` variable (from uuids.csv).  Three sizes are provided
// so the benchmark can compare SAX vs XPath parsing under different loads:
//
//   small  ~300 B  – single getProduct call
//   medium ~2 KB   – getProductList with 15 items
//   large  ~15 KB  – getProductList with 150 items
// ---------------------------------------------------------------------------

const SOAP_NS  = 'xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"'
const PROD_NS  = 'xmlns:ns="http://example.com/products"'
const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>'

function soapEnvelope(bodyContent) {
    return `${XML_DECL}<soap:Envelope ${SOAP_NS} ${PROD_NS}><soap:Body>${bodyContent}</soap:Body></soap:Envelope>`
}

function productItem(index) {
    const categories = ['electronics', 'clothing', 'furniture', 'sports', 'books']
    return (
        `<ns:product>` +
        `<ns:id>ITEM-${String(index).padStart(3, '0')}</ns:id>` +
        `<ns:name>Product ${index}</ns:name>` +
        `<ns:price>${(9.99 + index * 1.5).toFixed(2)}</ns:price>` +
        `<ns:stock>${50 + (index % 200)}</ns:stock>` +
        `<ns:category>${categories[index % categories.length]}</ns:category>` +
        `</ns:product>`
    )
}

function generateSmallSoap(requestId) {
    const body =
        `<ns:getProduct>` +
        `<ns:requestId>${requestId}</ns:requestId>` +
        `<ns:productId>PROD-001</ns:productId>` +
        `</ns:getProduct>`
    return soapEnvelope(body)
}

function generateMediumSoap(requestId) {
    const items = Array.from({ length: 15 }, (_, i) => productItem(i + 1)).join('')
    const body =
        `<ns:getProductList>` +
        `<ns:requestId>${requestId}</ns:requestId>` +
        `<ns:products>${items}</ns:products>` +
        `</ns:getProductList>`
    return soapEnvelope(body)
}

function generateLargeSoap(requestId) {
    const items = Array.from({ length: 150 }, (_, i) => productItem(i + 1)).join('')
    const body =
        `<ns:getProductList>` +
        `<ns:requestId>${requestId}</ns:requestId>` +
        `<ns:products>${items}</ns:products>` +
        `</ns:getProductList>`
    return soapEnvelope(body)
}

// ---------------------------------------------------------------------------
// Artillery beforeScenario hooks
// Each hook sets context.vars.soapBody so the YAML scenario can use it in
// the POST body template: `body: "{{ soapBody }}"`.
// ---------------------------------------------------------------------------

function setSmallSoapBody(context, events, done) {
    context.vars.soapBody = generateSmallSoap(context.vars.requestId)
    return done()
}

function setMediumSoapBody(context, events, done) {
    context.vars.soapBody = generateMediumSoap(context.vars.requestId)
    return done()
}

function setLargeSoapBody(context, events, done) {
    context.vars.soapBody = generateLargeSoap(context.vars.requestId)
    return done()
}

module.exports = {
    setSmallSoapBody,
    setMediumSoapBody,
    setLargeSoapBody,
}
