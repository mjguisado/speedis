export default async function (server, opts) {

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

    async function common(request, reply) {
        server.log.debug(`REQUEST: Id: ${request.id} - Method: ${request.method} - Url: ${request.url} - Headers: ${JSON.stringify(request.headers)} - Body: ${request.body}` )

        if (request.query['delay']) {
            let delay = parseInt(request.query['delay'])
            if (!Number.isNaN(delay) && delay > 0) {
                await new Promise(resolve => setTimeout(resolve, delay))
            }
        }
        reply.code(200)
        let headers = {}
        if (request.query['cc']) headers['cache-control'] = request.query['cc']
        headers['etag'] = `W/"${request.params.uuid}"`
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

    server.all('/users/*', async (request, reply) => {
        await common(request, reply)
        return reply.send(users)
    })

    server.all('/items/:uuid', async (request, reply) => {
        await common(request, reply)
        return reply.send({
            id: request.params.uuid,
            name: `Item ${request.params.uuid}`
        })
    })

}