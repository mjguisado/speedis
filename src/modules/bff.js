import path from 'path'
import { parseCacheControlHeader} from '../utils/utils.js'


export const CLIENT_REQUEST = "ClientRequest"
export const CLIENT_RESPONSE = "ClientResponse"
export const ORIGIN_REQUEST = "OriginRequest"
export const ORIGIN_RESPONSE = "OriginResponse"
export const CACHE_REQUEST = "CacheRequest"
export const CACHE_RESPONSE = "CacheResponse"
export const VARIANTS_TRACKER = "VariantsTracker"

// Actions libraries
const bffActionsRepository = {}

export async function initBff(server, opts) {

    // Init the catalog of available actions.
    if (!opts.bff.actionsLibraries) { opts.bff.actionsLibraries = {} }
    opts.bff.actionsLibraries['headers'] = path.resolve(process.cwd(), './src/actions/headers.js')
    opts.bff.actionsLibraries['json'] = path.resolve(process.cwd(), './src/actions/json.js')
    for (let actionsLibraryKey in opts.bff.actionsLibraries) {
        if (!path.isAbsolute(opts.bff.actionsLibraries[actionsLibraryKey])) {
            opts.bff.actionsLibraries[actionsLibraryKey] = path.resolve(
                process.cwd(),
                opts.bff.actionsLibraries[actionsLibraryKey]
            )
        }
        if (opts.bff.actionsLibraries[actionsLibraryKey].endsWith(".js")) {
            try {
                const library = await import(`file://${opts.bff.actionsLibraries[actionsLibraryKey]}`)
                Object.entries(library).forEach(([key, value]) => {
                    if (typeof value === 'function') {
                        if (!bffActionsRepository[actionsLibraryKey]) {
                            bffActionsRepository[actionsLibraryKey] = {}
                        }
                        bffActionsRepository[actionsLibraryKey][key] = value
                    }
                })
            } catch (error) {
                server.log.fatal(error, `Origin: ${opts.id}. Error importing the action library ${opts.bff.actionsLibraries[actionsLibraryKey]}.`)
                throw new Error(`Origin: ${opts.id}. The transformation configuration is invalid.`, { cause: error })
            }
        } else {
            server.log.fatal(error, `Origin: ${opts.id}. The file ${opts.bff.actionsLibraries[actionsLibraryKey]} containing the action library must have a .js extension.`)
            throw new Error(`Origin: ${opts.id}. The transformation configuration is invalid.`)
        }
    }

    // Init the transformations
    // If BFF is true, then at least one transformation is enforced.
    opts.bff.transformations.forEach(transformation => {
        try {
            transformation.re = new RegExp(transformation.urlPattern)
        } catch (error) {
            server.log.fatal(error, `Origin: ${opts.id}. urlPattern ${transformation.urlPattern} is not a valid regular expresion.`)
            throw new Error(`Origin: ${opts.id}. The transformation configuration is invalid.`, { cause: error })
        }
        transformation.actions.forEach(action => {
            const tokens = action.uses.split(':')
            let library = null
            let func = null
            if (tokens.length === 1) {
                library = 'speedis'
                func = tokens[0]
            } else if (tokens.length === 2) {
                library = tokens[0]
                func = tokens[1]
            } else {
                server.log.fatal(`Origin: ${opts.id}. The name of the action ${action.uses} is not valid. The correct format is library:action.`)
                throw new Error(`Origin: ${opts.id}. The transformation configuration is invalid.`)
            }
            if (!bffActionsRepository[library] || !bffActionsRepository[library][func]) {
                server.log.fatal(`Origin: ${opts.id}. Function ${action.uses} was not found among the available actions.`)
                throw new Error(`Origin: ${opts.id}. The transformation configuration is invalid.`)
            }
        })
    })

}

export function transform(opts, type, target) {
    let cacheDirectives = parseCacheControlHeader(target)
    if (cacheDirectives['no-transform']) {
        // The no-transform directive is present in the Cache-Control header.
        // No transformation is applied.
        return
    }
    opts.bff.transformations.forEach(transformation => {
        if (transformation.re.test(target.path)) {
            transformation.actions.forEach(action => {
                if (action.phase === type) {
                    const tokens = action.uses.split(':')
                    let library = null
                    let func = null
                    if (tokens.length === 1) {
                        library = 'speedis'
                        func = tokens[0]
                    } else if (tokens.length === 2) {
                        library = tokens[0]
                        func = tokens[1]
                    }
                    bffActionsRepository[library][func](target, action.with ? action.with : null)
                }
            })
        }
    })
}