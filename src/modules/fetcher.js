
import http from 'http'
import https from 'https'

export function _fetch(originOptions, requestOptions, body) {

    return new Promise((resolve, reject) => {

        // If we are using the Circuit Breaker the timeout is managed by it.
        // In other cases, we has to manage the timeout in the request.
        let signal, timeoutId = null
        if (originOptions.origin.originTimeout && !requestOptions.signal) {
            const abortController = new AbortController()
            timeoutId = setTimeout(() => {
                abortController.abort()
            }, originOptions.origin.originTimeout)
            signal = abortController.signal
            requestOptions.signal = signal
        }

        if (body && !requestOptions.headers['Content-Length']) {
            const bodyLength = Buffer.isBuffer(body)
                ? body.length
                : Buffer.byteLength(body)
            requestOptions.headers['Content-Length'] = bodyLength
        }

        const request = (requestOptions.protocol === 'https:' ? https : http)
            .request(requestOptions, (res) => {
                let rawData = ''
                res.on('data', chunk => { rawData += chunk })
                res.on('end', () => {
                    if (timeoutId) clearTimeout(timeoutId)
                    resolve({ statusCode: res.statusCode, headers: res.headers, body: rawData })
                })
            })

        request.on('error', (err) => {
            if (signal && signal.aborted) {
                const error = new Error(`Origin: ${originOptions.id}. Timed out after ${originOptions.origin.originTimeout} ms.`, { cause: err })
                error.code = 'ETIMEDOUT'
                reject(error)
            } else {
                reject(err)
            }
        })

        // Enviar body si existe
        if (body) request.write(body)

        request.end()

    })

}