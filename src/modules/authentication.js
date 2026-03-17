import { decodeProtectedHeader, jwtVerify, jwtDecrypt, createRemoteJWKSet } from 'jose'
import { createHash } from 'crypto'
import { errorHandler } from './error.js'

/**
 * Initialize authentication module for extracting user identifiers from requests.
 * This is PASSIVE authentication - it extracts user info but doesn't manage login flows.
 * 
 * @param {Object} server - Fastify server instance
 * @param {Object} opts - Origin configuration options
 */
export function initAuthentication(server, opts) {
    if ('Bearer' === opts.origin.authentication.scheme &&
        opts.origin.authentication.bearer.verifyJwtSignature) {
        // The originValidation ensure that is bearer.verifyJwtSignature is true
        // then bearer.jwksUri is required.
        try {
            const authJwks = createRemoteJWKSet(
                new URL(opts.origin.authentication.bearer.jwksUri)
            )
            server.decorate('authJwks', authJwks)
            server.log.info(`Origin: ${opts.id}. JWKS initialized from ${opts.origin.authentication.bearer.jwksUri}`)
        } catch (error) {
            server.log.error(error, `Origin: ${opts.id}. Failed to initialize JWKS from ${opts.origin.authentication.bearer.jwksUri}`)
            throw new Error(`Origin: ${opts.id}. Failed to initialize JWKS.`, { cause: error })
        }
    }
}

/**
 * Extract user identifier from request according to authentication scheme
 * @param {*} server - Fastify server instance
 * @param {*} opts - Origin configuration options
 * @param {*} request - HTTP request
 */
export async function getUserId(server, opts, request) {

    if (!request.headers['authorization']) {
        throw new Error('Missing Authorization header.')
    }

    const [scheme, credentials] = request.headers['authorization'].split(' ')
    if (!scheme || !credentials) {
        throw new Error('Invalid Authorization header format.')
    }

    let userId = null
    switch (scheme) {
        case 'Basic':
            userId = extractUserIdFromBasic(credentials)
            break
        case 'Bearer':
            userId = await extractUserIdFromBearer(server, opts, credentials)
            break
        default:
            throw new Error(`Unsupported authentication scheme: ${scheme}`)
    }

    // Apply transformations to the user ID
    return opts.origin.authentication.idTransformation ?
        transformUserId(userId, opts.origin.authentication.idTransformation)
        : userId
}

/**
 * Extract user identifier from Basic authentication
 */
function extractUserIdFromBasic(credentials) {
    try {
        const decoded = Buffer.from(credentials, 'base64').toString('utf-8')
        const [userId] = decoded.split(':')
        if (!userId) {
            throw new Error('Invalid Basic authentication credentials.')
        }
        return userId
    } catch (error) {
        throw new Error('Failed to decode Basic authentication credentials.')
    }
}

/**
 * Extract user identifier from Bearer token (JWT)
 */
async function extractUserIdFromBearer(server, opts, token) {

    // JWE - JSON Web Encryption - RFC 7516
    // https://datatracker.ietf.org/doc/html/rfc7516

    // A JSON Web Encryption (JWE) token is a way to transmit data securely 
    // by encrypting the payload. Unlike a JWT (which is typically just signed),
    // a JWE ensures that only the intended recipient can read the contents.

    // JWE consists of five base64url-encoded parts, separated by dots (.):
    //   1. Protected Header - contains metadata like token type and encryption algorithm (Base64URL encoded JSON)
    //   2. Encrypted Key - contains the encrypted content encryption key (Base64URL encoded data)
    //   3. Initialization Vector - contains the random bytes used to initialize the encryption algorithm (Base64URL encoded data)
    //   4. Ciphertext - contains the encrypted payload (Base64URL encoded data)
    //   5. Authentication Tag - contains the authentication tag used to verify the integrity of the ciphertext (Base64URL encoded data)

    let workingToken = token
    let parts = workingToken.split('.')
    if (parts.length === 5) {
        if (opts.origin.authentication.bearer.decryptionKey) {
            const { plaintext } = await jwtDecrypt(
                workingToken,
                opts.origin.authentication.bearer.decryptionKey
            )
            workingToken = new TextDecoder().decode(plaintext)
            parts = workingToken.split('.')
        } else {
            throw new Error('Decryption key is required for JWE tokens.')
        }
    }

    // JWS - JSON Web Signature - RFC 7515
    // https://datatracker.ietf.org/doc/html/rfc7515

    // A JSON Web Token (JWT) is a compact, URL-safe means of representing claims to be transferred between two parties.

    // A typical JWT has three parts, separated by dots (.):
    //   1. Header – contains metadata like token type and signing algorithm (Base64URL encoded JSON)
    //   2. Payload – contains the actual claims or data (Base64URL encoded JSON)
    //   3. Signature – ensures the token hasn’t been tampered with

    if (parts.length === 3) {
        let payload = {}
        const header = decodeProtectedHeader(workingToken)
        if (header.alg === 'none') {
            if (opts.origin.authentication.bearer.allowUnsigned) {
                payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'))
            } else {
                throw new Error('Unsigned JWTs are not allowed.')
            }
        } else {
            if (opts.origin.authentication.bearer.verifyJwtSignature) {
                // Verify JWT signature using JWKS
                const { payload: verifiedPayload } = await jwtVerify(workingToken, server.authJwks, {
                    algorithms: ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512']
                })
                payload = verifiedPayload
            } else {
                payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'))
            }
        }

        if (!Object.prototype.hasOwnProperty.call(payload, opts.origin.authentication.bearer.claim)) {
            throw new Error(`Claim '${opts.origin.authentication.bearer.claim}' not found in JWT payload.`)
        } else {
            return payload[opts.origin.authentication.bearer.claim]
        }
    } else {
        throw new Error('Invalid JWT format.')
    }
}

/**
 * Transform user identifier according to configuration
 */
function transformUserId(userId, config) {
    let transformed = userId
    // Apply hash transformation if configured
    if (config.hash && config.hash.enabled) {
        const hash = createHash(config.hash.algorithm)
        hash.update(userId)
        transformed = hash.digest(config.hash.hex ? 'hex' : 'base64')
    }
    return config.prefix + transformed + config.suffix
}
