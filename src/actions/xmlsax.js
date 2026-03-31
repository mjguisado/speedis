import sax from 'sax'
import { createHash } from 'crypto'

/**
 * BFF action for CacheKeyGeneration phase.
 *
 * Parses the request body (a Buffer containing XML) using a synchronous SAX
 * parser and extracts the text content of the specified elements. All extracted
 * texts are concatenated in document order and hashed to produce a fingerprint
 * stored in target.bodyFingerprint.
 *
 * @param {object} target  - The Fastify request object. target.body is a Buffer.
 * @param {object} params  - Action parameters from the "with" field in config.
 * @param {string[]} params.elements  - Qualified names of the XML elements to
 *                                      extract (e.g. ["soap:Body", "wsse:UsernameToken"]).
 * @param {string}   [params.algorithm="md5"]  - Hash algorithm (any value
 *                                               supported by Node.js crypto).
 * @param {string}   [params.encoding="hex"]   - Hash output encoding ("hex" or "base64").
 */
export function xmlBodyFingerprint(target, params) {
    if (!params?.elements?.length || !Buffer.isBuffer(target.body)) return

    const elements = params.elements
    const algorithm = params.algorithm ?? 'md5'
    const encoding = params.encoding ?? 'hex'

    // captureStack: array of { name: string, text: string }
    // Each entry represents an open target element currently being captured.
    const captureStack = []

    // results: texts extracted from each closed target element, in document order.
    const results = []

    const parser = sax.parser(
        true,   // strict mode: tag names are case-sensitive and returned as-is
        {}      // no namespace resolution → qualified names are preserved (e.g. "soap:Body")
    )

    parser.onopentag = (node) => {
        if (elements.includes(node.name)) {
            captureStack.push({ name: node.name, text: '' })
        }
    }

    parser.ontext = (text) => {
        // Append text to every element currently being captured.
        // This accumulates text from the element itself and all its descendants.
        for (const entry of captureStack) {
            entry.text += text
        }
    }

    parser.oncdata = (cdata) => {
        // Treat CDATA sections the same as regular text nodes.
        for (const entry of captureStack) {
            entry.text += cdata
        }
    }

    parser.onclosetag = (name) => {
        if (elements.includes(name)) {
            // Find the most recent open capture entry for this element name.
            for (let i = captureStack.length - 1; i >= 0; i--) {
                if (captureStack[i].name === name) {
                    results.push(captureStack[i].text)
                    captureStack.splice(i, 1)
                    break
                }
            }
        }
    }

    parser.onerror = () => {
        // Ignore XML errors silently and reset the parser so it can continue.
        parser.error = null
        parser.resume()
    }

    try {
        parser.write(target.body.toString('utf-8')).close()
    } catch (_) {
        // If the parser throws despite the error handler, return without setting
        // bodyFingerprint so the cache key is generated without a body component.
        return
    }

    if (results.length === 0) return

    target.bodyFingerprint = createHash(algorithm)
        .update(results.join(''))
        .digest(encoding)
}
