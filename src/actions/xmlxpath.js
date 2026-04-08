import { DOMParser } from '@xmldom/xmldom'
import xpath from 'xpath'
import { createHash } from 'crypto'

/**
 * BFF action for CacheKeyGeneration phase.
 *
 * Parses the request body (a Buffer containing XML) into a DOM tree and
 * evaluates a list of XPath 1.0 expressions to extract text. All results
 * are concatenated in the order the expressions are declared and then hashed
 * to produce a fingerprint stored in target.bodyFingerprint.
 *
 * XPath expressions may select element nodes, text nodes, attribute nodes or
 * return a string value directly. For node results the full text content of
 * each node is used. When an expression matches multiple nodes all of them
 * are concatenated before moving to the next expression.
 *
 * @param {object}   target                     - The Fastify request object.
 *                                                target.body must be a Buffer.
 * @param {object}   params                     - Action parameters ("with" field).
 * @param {string[]} params.xpaths              - XPath 1.0 expressions to evaluate.
 * @param {object}   [params.namespaces]        - Prefix-to-URI map for namespace
 *                                                resolution, e.g.:
 *                                                { "soap": "http://schemas.xmlsoap.org/soap/envelope/" }
 * @param {object}   [params.hash]                    - Hash configuration sub-object.
 * @param {boolean}  [params.hash.enabled=true]       - Whether to apply the hash. When false
 *                                                      the raw concatenated string is stored
 *                                                      directly in target.bodyFingerprint.
 * @param {string}   [params.hash.algorithm="md5"]    - Hash algorithm (any value accepted by
 *                                                      Node.js crypto.createHash()).
 * @param {string}   [params.hash.encoding="hex"]     - Hash output encoding: "hex" or "base64".
 */
export function xpathBodyFingerprint(target, params) {
    if (!params?.xpaths?.length || !Buffer.isBuffer(target.body)) return

    const { enabled = false, algorithm = 'md5', encoding = 'hex' } = params.hash ?? {}

    // Parse XML into a DOM tree, suppressing all parser errors silently.
    const parser = new DOMParser({ onError: () => {} })

    let doc
    try {
        doc = parser.parseFromString(target.body.toString('utf-8'), 'text/xml')
    } catch (_) {
        return
    }

    // A document with no root element or a <parsererror> root means the XML
    // was invalid. Return without setting bodyFingerprint.
    if (!doc?.documentElement) return
    if (doc.documentElement.tagName === 'parsererror') return

    // Build the XPath selector, optionally with namespace resolution.
    const select = params.namespaces
        ? xpath.useNamespaces(params.namespaces)
        : xpath.select

    const parts = []

    for (const expression of params.xpaths) {
        let nodes
        try {
            nodes = select(expression, doc)
        } catch (_) {
            // Invalid XPath expression — skip silently.
            continue
        }

        if (nodes === undefined || nodes === null) continue

        // xpath.select may return a primitive (string, number, boolean)
        // when the expression is a function call like string() or count().
        if (!Array.isArray(nodes)) {
            parts.push(String(nodes))
            continue
        }

        for (const node of nodes) {
            parts.push(nodeText(node))
        }
    }

    if (parts.length === 0) return

    const concatenated = parts.join('')
    target.bodyFingerprint = enabled
        ? createHash(algorithm).update(concatenated).digest(encoding)
        : concatenated
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the text representation of a DOM node.
 *
 * - Element  (nodeType 1): full text content including descendants.
 * - Attribute(nodeType 2): attribute value.
 * - Text     (nodeType 3): character data.
 * - CDATA    (nodeType 4): character data.
 *
 * @param {Node} node
 * @returns {string}
 */
function nodeText(node) {
    switch (node.nodeType) {
        case 1: return node.textContent ?? ''   // Element
        case 2: return node.value       ?? ''   // Attribute
        case 3: return node.nodeValue   ?? ''   // Text
        case 4: return node.nodeValue   ?? ''   // CDATA
        default: return String(node)
    }
}
