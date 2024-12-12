import etag from '@fastify/etag'

export default async function (server, opts) {

    await server.register(etag)


    const items = [];
    for (let index = 0; index < 10; index++) {
        items[index] = {
            id: index,
            name: `Item ${index}`
        }
    } 

    server.get('/items', async (request, reply) => {
        reply.code(200)     
        let cachecontrol = "public";
        let  maxage = request.query['max-age']
        let smaxage = request.query['s-maxage']
        if (smaxage) cachecontrol += `, s-maxage=${smaxage}`
        if (maxage)  cachecontrol += `, max-age=${maxage}`
        let now = new Date().toUTCString();
        reply.headers({
            'cache-control': cachecontrol,
            'last-modified': now
        })
        reply.send(items)        
    })

    server.get('/code/:code', async (request, reply) => {
        reply.code(request.params.code)
    })

    server.get('/no-store', async (request, reply) => {
        reply.code(200)
        reply.headers({
            'cache-control': 'no-store'
        })
        reply.send(items)        
    })

    server.get('/private', async (request, reply) => {
        reply.code(200)
        reply.headers({
            'cache-control': 'private'
        })
        reply.send(items)        
    })

}