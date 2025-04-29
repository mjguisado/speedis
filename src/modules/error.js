export function errorHandler(reply, code, msg, exposeErrors, cause) {
    let details = { msg: msg }
    if (cause) details.cause = cause.toString()
    reply
        .code(code)
        .header('date', new Date().toUTCString())
    if (exposeErrors) {
        reply.header('content-type', 'application/json')
        reply.send(details)
    } else {
        reply.send()
    }
    return reply
}

