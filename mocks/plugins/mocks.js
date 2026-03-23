import { decodeProtectedHeader, jwtVerify, compactDecrypt, createRemoteJWKSet } from 'jose'

export default async function (server, opts) {

    // Inicializar JWKS si se requiere verificación de firma
    if (opts?.authentication.bearer?.verifyJwtSignature && opts?.authentication.bearer?.jwksUri) {
        try {
            const authJwks = createRemoteJWKSet(new URL(opts?.authentication.bearer.jwksUri))
            server.decorate('authJwks', authJwks)
            server.log.info(`JWKS initialized from ${opts?.authentication.bearer.jwksUri}`)
        } catch (error) {
            server.log.error(error, `Failed to initialize JWKS from ${opts?.authentication.bearer.jwksUri}`)
            throw new Error('Failed to initialize JWKS.', { cause: error })
        }
    }

   /**
     * Valida el token de autorización y los scopes requeridos
     * Soporta esquemas: Basic y Bearer
     * @param {Object} request - Fastify request object
     * @param {Object} reply - Fastify reply object
     * @param {Object} options - Opciones de autenticación (opcional)
     * @param {Array} options.requiredScopes - Scopes requeridos para Bearer tokens
     * @param {Object} options.bearer - Configuración específica para Bearer tokens
     * @returns {Object|null} Error object o null si es exitoso
     */
    async function validateAuthorization(request, reply, options = {}) {
        // Merge de opciones: las pasadas por parámetro sobrescriben las del plugin
        const mergedOptions = {
            requiredScopes: options.requiredScopes || [],
            bearer: {
                ...opts.authentication.bearer,
                ...(options.bearer || {})
            }
        }

        const authHeader = request.headers['authorization']

        if (!authHeader) {
            reply.code(401)
            return reply.send({
                error: 'unauthorized',
                error_description: 'Missing Authorization header'
            })
        }

        const parts = authHeader.split(' ')
        if (parts.length !== 2) {
            reply.code(401)
            return reply.send({
                error: 'invalid_authorization',
                error_description: 'Invalid Authorization header format. Expected: <scheme> <credentials>'
            })
        }

        const [scheme, credentials] = parts

        switch (scheme) {
            case 'Basic':
                return await validateBasicAuth(request, reply, credentials)
            case 'Bearer':
                return await validateBearerAuth(request, reply, credentials, mergedOptions)
            default:
                reply.code(401)
                return reply.send({
                    error: 'unsupported_scheme',
                    error_description: `Unsupported authentication scheme: ${scheme}. Supported schemes: Basic, Bearer`
                })
        }
    }

    /**
     * Valida autenticación Basic
     * @param {Object} request - Fastify request object
     * @param {Object} reply - Fastify reply object
     * @param {string} credentials - Base64 encoded credentials
     * @returns {Promise<Object|null>} Error object o null si es exitoso
     */
    async function validateBasicAuth(request, reply, credentials) {
        try {
            const decoded = Buffer.from(credentials, 'base64').toString('utf-8')
            const [userId, password] = decoded.split(':')

            if (!userId) {
                reply.code(401)
                return reply.send({
                    error: 'invalid_credentials',
                    error_description: 'Invalid Basic authentication credentials.'
                })
            }

            // Añadir información del usuario al request
            request.authPayload = {
                userId: userId,
                scheme: 'Basic'
            }

            server.log.debug(`Basic auth validated for user: ${userId}`)
            return null // Autorización exitosa

        } catch (error) {
            server.log.error(error, 'Error decoding Basic credentials')
            reply.code(401)
            return reply.send({
                error: 'invalid_credentials',
                error_description: 'Failed to decode Basic authentication credentials.'
            })
        }
    }

    /**
     * Valida autenticación Bearer (JWT/JWE)
     * @param {Object} request - Fastify request object
     * @param {Object} reply - Fastify reply object
     * @param {string} token - Bearer token
     * @param {Object} options - Opciones mergeadas de autenticación
     * @returns {Object|null} Error object o null si es exitoso
     */
    async function validateBearerAuth(request, reply, token, options) {
        const { requiredScopes, bearer: bearerConfig } = options

        try {
            let workingToken = token
            let parts = workingToken.split('.')

            // ========================================
            // JWE - JSON Web Encryption (5 partes)
            // ========================================
            if (parts.length === 5) {
                if (bearerConfig.decryptionKey) {
                    const { plaintext } = await compactDecrypt(
                        workingToken,
                        bearerConfig.decryptionKey
                    )
                    workingToken = new TextDecoder().decode(plaintext)
                    parts = workingToken.split('.')
                } else {
                    reply.code(401)
                    return reply.send({
                        error: 'invalid_token',
                        error_description: 'Decryption key is required for JWE tokens.'
                    })
                }
            }

            // ========================================
            // JWT - JSON Web Token (3 partes)
            // ========================================
            if (parts.length === 3) {
                let payload = {}
                const header = decodeProtectedHeader(workingToken)

                // Token sin firmar (alg: none)
                if (header.alg === 'none') {
                    if (bearerConfig.allowUnsigned) {
                        payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'))
                    } else {
                        reply.code(401)
                        return reply.send({
                            error: 'invalid_token',
                            error_description: 'Unsigned JWTs are not allowed.'
                        })
                    }
                } else {
                    // Token firmado
                    if (bearerConfig.verifyJwtSignature) {
                        // Verificar firma usando JWKS
                        const { payload: verifiedPayload } = await jwtVerify(workingToken, server.authJwks, {
                            algorithms: ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512']
                        })
                        payload = verifiedPayload
                    } else {
                        // No verificar firma, solo decodificar
                        payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'))
                    }
                }

                server.log.debug(`Token payload: ${JSON.stringify(payload)}`)

                // Validar expiración
                if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
                    reply.code(401)
                    return reply.send({
                        error: 'invalid_token',
                        error_description: 'Token has expired'
                    })
                }

                // Validar scopes requeridos
                if (requiredScopes && requiredScopes.length > 0) {
                    const tokenScopes = payload.scope ? payload.scope.split(' ') : []
                    const hasRequiredScopes = requiredScopes.every(scope =>
                        tokenScopes.includes(scope)
                    )

                    if (!hasRequiredScopes) {
                        reply.code(403)
                        return reply.send({
                            error: 'insufficient_scope',
                            error_description: `Required scopes: ${requiredScopes.join(', ')}. Token scopes: ${tokenScopes.join(', ')}`,
                            required_scopes: requiredScopes,
                            token_scopes: tokenScopes
                        })
                    }
                }

                // Añadir información del token al request
                request.authPayload = {
                    ...payload,
                    userId: payload[bearerConfig.claim] || payload.sub,
                    scheme: 'Bearer'
                }

                return null // Autorización exitosa

            } else {
                reply.code(401)
                return reply.send({
                    error: 'invalid_token',
                    error_description: 'Invalid JWT format.'
                })
            }

        } catch (error) {
            server.log.error(error, 'Error validating Bearer token')
            reply.code(401)
            return reply.send({
                error: 'invalid_token',
                error_description: error.message || 'Malformed token'
            })
        }
    }

    async function common(request, reply) {

        server.log.debug(`REQUEST: Id: ${request.id} - Method: ${request.method} - Url: ${request.url} - Headers: ${JSON.stringify(request.headers)} - Body: ${request.body}`)

        if (request.query['delay']) {
            let delay = parseInt(request.query['delay'])
            if (!Number.isNaN(delay) && delay > 0) {
                await new Promise(resolve => setTimeout(resolve, delay))
            }
        }

        reply.code(200)
        
        if ("HEAD" ===request.method || "GET" === request.method) {
            
            let headers = {}
            
            if (request.query['cc'])   headers['cache-control'] = request.query['cc']
            if (request.params.uuid)   headers['etag'] = `W/"${request.params.uuid}"`
            if (request.query['vary']) headers['vary'] = request.query['vary']

            headers['x-mocks-custom-header-1'] = 'x-mocks-custom-header-1'
            headers['x-mocks-custom-header-2'] = 'x-mocks-custom-header-2'
            headers['x-mocks-custom-header-3'] = 'x-mocks-custom-header-3'
            
            if (request.headers) {
                for (const [key, value] of Object.entries(request.headers)) {
                    if (key.startsWith('x-mocks-')) {
                        headers[key.replace('x-mocks-', '')] = value
                    }
                }
            }

            headers['last-modified'] = new Date().toUTCString()

            reply.headers(headers)

        }

    }

    /**
     * Lógica para endpoint /items/:uuid
     */
    function handleItems(request) {
        return {
            id: request.params.uuid,
            name: `Item ${request.params.uuid}`
        }
    }

    /**
     * Lógica para endpoint /status/:statusCode/:uuid
     */
    function handleStatus(request, reply) {
        const statusCode = parseInt(request.params.statusCode)

        // Validar que el statusCode sea un número válido
        if (Number.isNaN(statusCode) || statusCode < 100 || statusCode > 599) {
            reply.code(400)
            return {
                error: 'invalid_status_code',
                error_description: 'Status code must be a number between 100 and 599'
            }
        }

        // Sobrescribir el código de estado
        reply.code(statusCode)

        // Devolver un body apropiado según el código de estado
        if (statusCode >= 200 && statusCode < 300) {
            return {
                id: request.params.uuid,
                statusCode: statusCode,
                message: `Success response with status ${statusCode}`
            }
        } else if (statusCode >= 400 && statusCode < 500) {
            return {
                error: `error_${statusCode}`,
                error_description: `Client error with status ${statusCode}`,
                statusCode: statusCode
            }
        } else if (statusCode >= 500 && statusCode < 600) {
            return {
                error: `error_${statusCode}`,
                error_description: `Server error with status ${statusCode}`,
                statusCode: statusCode
            }
        } else {
            return {
                statusCode: statusCode,
                message: `Response with status ${statusCode}`
            }
        }
    }

    // ========================================
    // RUTAS PÚBLICAS (sin autenticación)
    // ========================================
    server.all('/public/items/:uuid', async (request, reply) => {
        await common(request, reply)
        return reply.send(handleItems(request))
    })

    // Endpoint genérico para devolver cualquier código de estado
    // Uso: /public/status/:statusCode/:uuid?cc=public,max-age=60
    server.all('/public/status/:statusCode/:uuid', async (request, reply) => {
        await common(request, reply)
        return reply.send(handleStatus(request, reply))
    })

    const users = [
        {
            "id": 1,
            "user": {
                "name": "Alice",
                "email": "alice@example.com",
                "phones": [
                    { "type": "mobile", "number": "123-456-7890" },
                    { "type": "work", "number": "111-222-3333" }
                ],
                "address": {
                    "city": "New York",
                    "zip": "10001"
                }
            },
            "metadata": {
                "createdAt": "2024-03-30T10:15:30Z",
                "updatedAt": "2024-03-31T11:00:00Z"
            }
        },
        {
            "id": 2,
            "user": {
                "name": "Bob",
                "email": "bob@example.com",
                "phones": [
                    { "type": "mobile", "number": "234-567-8901" },
                    { "type": "work", "number": "222-333-4444" }
                ],
                "address": {
                    "city": "Los Angeles",
                    "zip": "90001"
                }
            },
            "metadata": {
                "createdAt": "2024-03-29T09:10:20Z",
                "updatedAt": "2024-03-30T12:20:10Z"
            }
        },
        {
            "id": 3,
            "user": {
                "name": "Charlie",
                "email": "charlie@example.com",
                "phones": [
                    { "type": "mobile", "number": "345-678-9012" },
                    { "type": "home", "number": "333-444-5555" }
                ],
                "address": {
                    "city": "Chicago",
                    "zip": "60601"
                }
            },
            "metadata": {
                "createdAt": "2024-03-28T08:00:00Z",
                "updatedAt": "2024-03-29T10:30:45Z"
            }
        },
        {
            "id": 4,
            "user": {
                "name": "David",
                "email": "david@example.com",
                "phones": [
                    { "type": "mobile", "number": "456-789-0123" },
                    { "type": "work", "number": "444-555-6666" }
                ],
                "address": {
                    "city": "Houston",
                    "zip": "77001"
                }
            },
            "metadata": {
                "createdAt": "2024-03-27T07:45:15Z",
                "updatedAt": "2024-03-28T09:25:30Z"
            }
        },
        {
            "id": 5,
            "user": {
                "name": "Eve",
                "email": "eve@example.com",
                "phones": [
                    { "type": "mobile", "number": "567-890-1234" },
                    { "type": "home", "number": "555-666-7777" }
                ],
                "address": {
                    "city": "San Francisco",
                    "zip": "94101"
                }
            },
            "metadata": {
                "createdAt": "2024-03-26T06:30:10Z",
                "updatedAt": "2024-03-27T08:15:20Z"
            }
        }
    ]
    server.all('/public/users/*', async (request, reply) => {
        await common(request, reply)
        return reply.send(users)
    })

    // ========================================
    // RUTAS PRIVADAS (con autenticación)
    // ========================================
    server.all('/private/items/:uuid', async (request, reply) => {
        const authError = await validateAuthorization(request, reply)
        if (authError) return authError

        await common(request, reply)
        const response = handleItems(request)
        response.user_id = request.authPayload?.userId || request.authPayload?.sub
        response.auth_scheme = request.authPayload?.scheme
        return reply.send(response)
    })

    // Endpoint genérico para devolver cualquier código de estado (versión privada)
    // Uso: /private/status/:statusCode/:uuid?cc=private,max-age=60
    server.all('/private/status/:statusCode/:uuid', async (request, reply) => {
        const authError = await validateAuthorization(request, reply)
        if (authError) return authError

        await common(request, reply)
        const response = handleStatus(request, reply)
        response.user_id = request.authPayload?.userId || request.authPayload?.sub
        response.auth_scheme = request.authPayload?.scheme
        return reply.send(response)
    })

}