import fastify from 'fastify'
import path from 'path'
import fs from 'fs/promises'
import speedisPlugin from './plugins/speedis.js'
import Ajv from "ajv"
import { initOriginConfigValidator } from './modules/originConfigValidator.js'
import { initMetrics } from './modules/metrics.js'

export async function app(opts = {}, ajv = new Ajv({ useDefaults: true })) {

    // Register the Prometheus metrics.
    const server = fastify(opts)

    // Load the origin's configuration.
    const originsBasedir = path.join(process.cwd(), 'conf', 'origins')
    const originFiles = await fs.readdir(originsBasedir)
    let origins = []
    originFiles.forEach((originFile) => {
        const originFilePath = path.join(originsBasedir, originFile)
        origins.push(
            fs.readFile(originFilePath, 'utf8')
                .then(jsonString => { return JSON.parse(jsonString) })
                .catch(error => {
                    server.log.error(error, 'Error loading the configuration file ' + originFilePath)
                }))
    })
    origins = await Promise.all(origins)

    // For each valid origin, we register an instance of the plugin that manages it.
    const originConfigValidator = initOriginConfigValidator(ajv)
    const plugins = new Map()
    origins.forEach((origin) => {
        if (undefined !== origin) {
            if (!originConfigValidator(origin, ajv)) {
                server.log.error(originConfigValidator.errors)
                server.log.error(`Origin configuration is invalid. Skiping origin: ${origin.id}.`)
            } else {
                server.register(speedisPlugin, origin)
                plugins.set(origin.id, origin.prefix)
                server.after(err => { if (err) console.log(err) })
            }
        }
    })

    initMetrics(server, plugins)

    server.ready(err => { if (err) console.log(err) })

    return server

}