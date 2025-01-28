export default async function (server, opts) {

    server.get('/items/:uuid', async (request, reply) => {
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
        reply.send({
            id: request.params.uuid,
            name: `Item ${request.params.uuid}`
        })
    })

}