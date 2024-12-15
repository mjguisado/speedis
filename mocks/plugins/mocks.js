export default async function (server, opts) {

    server.get('/items/:uuid', async (request, reply) => {
        reply.code(200)     
        let headers = {}
        let cc = request.query['cc']
        if (cc) headers['cache-control'] = cc
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
        reply.code(200)
        reply.headers(headers)
        reply.send({
            id: request.params.uuid,
            name: `Item ${request.params.uuid}`
        })
    })

}