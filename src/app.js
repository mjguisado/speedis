import fastify from 'fastify'
import path from 'path'
import fs from 'fs/promises'
import speedisPlugin from './plugins/speedis.js'
import Ajv from "ajv"
import { initOriginConfigValidator } from './modules/originConfigValidator.js'

export async function app(
    opts,
    ajv = new Ajv({ useDefaults: true }),
    localOriginsConfigs,
    configdb,
    originsConfigsKeys) {

    // Register the Prometheus metrics.
    const server = fastify(opts)


    /**
     * Fastify onSend hook that sanitizes HTTP/2 responses by removing
     * hop-by-hop headers that are invalid in HTTP/2.
     *
     * According to the HTTP/2 specification (RFC 9113 §8.2.2),
     * the "Connection" header and all headers listed in its value
     * (e.g. "Keep-Alive", "Upgrade", "Transfer-Encoding") are
     * forbidden in HTTP/2 responses.
     *
     * https://www.rfc-editor.org/rfc/rfc9113.html#section-8.2.2
     * 
     * Use this hook to prevent ERR_HTTP2_INVALID_CONNECTION_HEADERS
     * and ensure compatibility with HTTP/2 clients.
     */
    server.addHook('onSend', async (req, reply, payload) => {
        // Apply only for HTTP/2 connections
        if (req.raw.httpVersionMajor === 2) {
            const connection = reply.getHeader('connection')
            if (connection) {
                // Remove the "Connection" header itself
                reply.removeHeader('connection')
                // Remove every header listed in the Connection header value
                connection
                    .split(',')
                    .map(h => h.trim().toLowerCase())
                    .forEach(header => reply.removeHeader(header))
            }
            // Explicitly remove common hop-by-hop headers
            ['proxy-connection', 'keep-alive', 'transfer-encoding', 'upgrade', ]
                .forEach(h => reply.removeHeader(h))
        }
    })

    // Load the origin's configuration.
    let originsConfigs = []  
    if (configdb) {
        let client = null
        try {
            client = await configdb.connect()
            server.log.info(`Remote origins configuration database connection established.`)
        } catch (error) {           
            throw new Error(`Unable to connect to the remote origins configuration database.`, { cause: error })
        }
        for (const originKey of originsConfigsKeys) {
            try {
                const origin = await configdb.json.get(originKey)
                if (origin) {
                    originsConfigs.push(origin)
                } else {
                    server.log.error('Origin configuration key ' + originKey + ' not found.')
                }
            } catch (error) {
                server.log.error(error, 'Error loading the origin configuration key ' + originKey)
            }
        }
        if (client) await client.close()
    } else {
        const originsBasedir = (null === localOriginsConfigs)
            ? path.join(process.cwd(), 'conf', 'origins')
            : path.isAbsolute(localOriginsConfigs)
                ? localOriginsConfigs
                : path.resolve(localOriginsConfigs);       
        server.log.debug("Origins configuration location:" + originsBasedir)
        const originFiles = await fs.readdir(originsBasedir)
        originFiles.filter(file => file.endsWith('.json')).forEach((originFile) => {
            const originFilePath = path.join(originsBasedir, originFile)
            originsConfigs.push(
                fs.readFile(originFilePath, 'utf8')
                    .then(jsonString => { return JSON.parse(jsonString) })
                    .catch(error => {
                        server.log.error(error, 'Error loading the origin configuration file ' + originFilePath)
                    }))
        })
        originsConfigs = await Promise.all(originsConfigs)
    } 

    // For each valid origin, we register an instance of the plugin that manages it.
    const originConfigValidator = initOriginConfigValidator(ajv)
    const plugins = new Map()
    originsConfigs.forEach((originConfig) => {
        if (undefined !== originConfig) {
            if (!originConfigValidator(originConfig, ajv)) {
                server.log.error(originConfigValidator.errors)
                server.log.error(`Origin configuration is invalid. Skiping origin: ${originConfig.id}.`)
            } else {
                server.log.info(`Loading origin configuration. Origin: ${originConfig.id}.`)
                server.register(speedisPlugin, originConfig)
                plugins.set(originConfig.id, originConfig.prefix)
                server.after(err => { if (err) console.log(err) })
            }
        }
    })

    server.decorate('plugins', plugins)
    server.ready(err => { if (err) console.log(err) })

    return server

}