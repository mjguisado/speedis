import jp from 'jsonpath'
import { createHash } from 'crypto'

/**
 * BFF action for CacheKeyGeneration phase.
 *
 * Parses the request body (a Buffer containing JSON) and evaluates a list of
 * JSONPath expressions to extract values. All results are concatenated in the
 * order the expressions are declared and then hashed to produce a fingerprint
 * stored in target.bodyFingerprint.
 *
 * JSONPath expressions may select any JSON value: primitives (string, number,
 * boolean) are serialised with String(); objects and arrays are serialised with
 * JSON.stringify() to produce a deterministic representation. null values are
 * skipped. When an expression matches multiple nodes all of them are
 * concatenated before moving to the next expression.
 *
 * @param {object}   target                     - The Fastify request object.
 *                                                target.body must be a Buffer.
 * @param {object}   params                     - Action parameters ("with" field).
 * @param {string[]} params.jsonpaths                - JSONPath expressions to evaluate.
 * @param {object}   [params.hash]                   - Hash configuration sub-object.
 * @param {boolean}  [params.hash.enabled=true]      - Whether to apply the hash. When false
 *                                                     the raw concatenated string is stored
 *                                                     directly in target.bodyFingerprint.
 * @param {string}   [params.hash.algorithm="md5"]   - Hash algorithm (any value accepted by
 *                                                     Node.js crypto.createHash()).
 * @param {string}   [params.hash.encoding="hex"]    - Hash output encoding: "hex" or "base64".
 */
export function jsonpathBodyFingerprint(target, params) {
    if (!params?.jsonpaths?.length || !Buffer.isBuffer(target.body)) return

    const { enabled = false, algorithm = 'md5', encoding = 'hex' } = params.hash ?? {}

    // Parse the request body as JSON. Return without setting bodyFingerprint
    // if the body is empty or not valid JSON, so the cache key is generated
    // without a body component.
    let body
    try {
        body = JSON.parse(target.body.toString('utf-8'))
    } catch (_) {
        return
    }

    const parts = []

    for (const expression of params.jsonpaths) {
        let values
        try {
            // jp.query always returns an array of matched values (never throws
            // for valid JSONPath syntax against a parsed JSON object).
            values = jp.query(body, expression)
        } catch (_) {
            // Invalid JSONPath expression — skip silently.
            continue
        }

        if (!values || values.length === 0) continue

        for (const value of values) {
            // Skip null / undefined — they carry no discriminating information.
            if (value === null || value === undefined) continue

            if (typeof value === 'object') {
                // Objects and arrays: use JSON.stringify for a deterministic,
                // canonical string representation.
                parts.push(JSON.stringify(value))
            } else {
                // Primitives: string, number, boolean.
                parts.push(String(value))
            }
        }
    }

    if (parts.length === 0) return

    const concatenated = parts.join('')
    target.bodyFingerprint = enabled
        ? createHash(algorithm).update(concatenated).digest(encoding)
        : concatenated
}
