export default async function (server, opts) {

    const items = [];
    for (let index = 0; index < 10; index++) {
        items[index] = {
            id: index,
            name: `Item ${index}`
        }
    } 

    server.get('/items', async (request, reply) => {
        return { items: items }
    })

}