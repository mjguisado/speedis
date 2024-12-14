import etag from '@fastify/etag'

export default async function (server, opts) {

    await server.register(etag)

    server.get('/items/:uuid', async (request, reply) => {
        reply.code(200)     
        let headers = {}
        let cc = request.query['cc']
        if (cc) headers['cache-control'] = cc
        headers['last-modified'] = new Date().toUTCString()
        reply.code(200)
        reply.headers(headers)
        reply.send({
            id: request.params.uuid,
            name: `Item ${request.params.uuid}`
        })
    })

}