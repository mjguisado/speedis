import fastify from 'fastify'
import path from 'path'
import fs from 'fs/promises'
import speedisPlugin from './plugins/speedis.js'
import { createClient } from 'redis'
import Ajv from "ajv"
import { initOriginConfigValidator } from './modules/originConfigValidator.js'

export async function app(
    opts = {}, 
    ajv = new Ajv({ useDefaults: true }),
    localOriginsConfigs,
    remoteOriginsConfigs) {

    // Register the Prometheus metrics.
    const server = fastify(opts)

    // Load the origin's configuration.
    let originsConfigs = []  
    if (localOriginsConfigs) {
        const originsBasedir = (null === localOriginsConfigs)
            ? path.join(process.cwd(), 'conf', 'origins')
            : path.isAbsolute(localOriginsConfigs)
                ? localOriginsConfigs
                : path.resolve(localOriginsConfigs);
        
        server.log.debug("Origins configuration location:" + originsBasedir)
        const originFiles = await fs.readdir(originsBasedir)
        originFiles.forEach((originFile) => {
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
    if (remoteOriginsConfigs) {
        let configdb = null
        try {
            configdb = await createClient(remoteOriginsConfigs.redisOptions)
            .on('error', error => {
                server.log.error(error, `Remote origins configuration database connection lost.`)
            })
            .connect()
            server.log.info(`Remote origins configuration database connection established.`)
        } catch (error) {           
            throw new Error(`Unable to connect to the remote origins configuration database during startup.`, { cause: error })
        }
        for (const originKey of remoteOriginsConfigs.originsConfigsKeys) {
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
        if (configdb) await configdb.close()
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