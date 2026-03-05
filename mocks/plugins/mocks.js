export default async function (server, opts) {
    /**
     * Valida el token de autorización y los scopes requeridos
     */
    function validateAuthorization(request, reply, requiredScopes = []) {

        const authHeader = request.headers['authorization']
        
        if (!authHeader) {
            reply.code(401)
            return reply.send({
                error: 'unauthorized',
                error_description: 'Missing Authorization header'
            })
        }

        const parts = authHeader.split(' ')
        if (parts.length !== 2 || parts[0] !== 'Bearer') {
            reply.code(401)
            return reply.send({
                error: 'invalid_token',
                error_description: 'Invalid Authorization header format. Expected: Bearer <token>'
            })
        }

        const token = parts[1]
        
        // Decode the JWT (without validating the signature)
        try {

            const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString())
           
            server.log.debug(`Token payload: ${JSON.stringify(payload)}`)
            
            // Validate expiration
            if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
                reply.code(401)
                return reply.send({
                    error: 'invalid_token',
                    error_description: 'Token has expired'
                })
            }

            // Validar scopes requeridos
            if (requiredScopes.length > 0) {

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

            // Añadir información del token al request para uso posterior
            request.tokenPayload = payload
            
            return null // Autorización exitosa
            
        } catch (error) {
            server.log.error(error, 'Error decoding token')
            reply.code(401)
            return reply.send({
                error: 'invalid_token',
                error_description: 'Malformed token'
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
            if (request.query['cc']) headers['cache-control'] = request.query['cc']
            if (request.params.uuid) headers['etag'] = `W/"${request.params.uuid}"`
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

    // ========================================
    // RUTAS PÚBLICAS (sin autenticación)
    // ========================================
    server.all('/public/items/:uuid', async (request, reply) => {
        await common(request, reply)
        return reply.send({
            id: request.params.uuid,
            name: `Item ${request.params.uuid}`
        })
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
    // RUTAS CON SCOPE: basic
    // ========================================
    server.all('/basic/settings', async (request, reply) => {
        const authError = validateAuthorization(request, reply, ['basic'])
        if (authError) return authError

        await common(request, reply)
        return reply.send({
            settings: {
                theme: 'dark',
                language: 'en',
                notifications: true
            },
            scope: 'basic',
            user_id: request.tokenPayload.sub,
            message: 'This endpoint requires scope: basic'
        })
    })

    // ========================================
    // RUTAS CON SCOPE: private
    // ========================================
    server.all('/private/data', async (request, reply) => {
        const authError = validateAuthorization(request, reply, ['private'])
        if (authError) return authError

        await common(request, reply)
        return reply.send({
            data: {
                sensitive_info: 'This is private data',
                account_balance: 1234.56,
                ssn: '***-**-1234'
            },
            scope: 'private',
            user_id: request.tokenPayload.sub
        })
    })

    // ========================================
    // RUTAS CON SCOPE: signed
    // ========================================
    server.all('/transaction/signed', async (request, reply) => {
        const authError = validateAuthorization(request, reply, ['signed'])
        if (authError) return authError
        await common(request, reply)
        return reply.send({
            result: 'executed',
            operation: request.body?.operation || 'unknown',
            signature: 'SHA256:xyz789...',
            executed_at: new Date().toISOString(),
            scope: 'signed',
            user_id: request.tokenPayload.sub
        })
    })

    // ========================================
    // RUTAS CON MÚLTIPLES SCOPES
    // ========================================
    server.all('/admin/users', async (request, reply) => {
        const authError = validateAuthorization(request, reply, ['basic', 'private'])
        if (authError) return authError

        await common(request, reply)
        return reply.send({
            users: users,
            scope: 'basic + private + signed',
            accessed_by: request.tokenPayload.sub
        })
    })

}