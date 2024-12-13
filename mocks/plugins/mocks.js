import etag from '@fastify/etag'

export default async function (server, opts) {

    await server.register(etag)


    const items = [];
    for (let index = 0; index < 20; index++) {
        items[index] = {
            id: index,
            name: `Item ${index}`
        }
    } 

    server.get('/items', async (request, reply) => {
        reply.code(200)     
        let headers = {}
        let cc = request.query['cc']
        if (cc) headers['cache-control'] = cc
        headers['last-modified'] = new Date().toUTCString()
        reply.code(200)
        reply.headers(headers)
        reply.send(items)        
    })

}