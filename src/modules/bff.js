import path from 'path'
import { parseCacheControlHeader } from '../utils/utils.js'

export const CLIENT_REQUEST = "ClientRequest"
export const CLIENT_RESPONSE = "ClientResponse"
export const ORIGIN_REQUEST = "OriginRequest"
export const ORIGIN_RESPONSE = "OriginResponse"
export const CACHE_REQUEST = "CacheRequest"
export const CACHE_RESPONSE = "CacheResponse"

export const VARIANTS_TRACKER = "VariantsTracker"
export const CACHE_KEY_GENERATION = 'CacheKeyGeneration'

// Actions libraries
const bffActionsRepository = {}

export async function initBff(server, opts) {

    // Init the catalog of available actions.
    if (!opts.bff.actionsLibraries) { opts.bff.actionsLibraries = {} }

    // Collect the library names that are actually referenced in the configured transformations.
    const referencedLibraries = new Set()
    opts.bff.transformations.forEach(transformation => {
        transformation.actions.forEach(action => {
            // The action.uses field contains the name of the library and 
            // the name of the action separated by a colon.
            // If the library name is not specified, the speedis library is assumed.
            // To increse
            const tokens = action.uses.split(':')
            if (tokens.length === 1) {
                action.library = 'speedis'
                action.func = tokens[0]
            } else if (tokens.length === 2) {
                action.library = tokens[0]
                action.func = tokens[1]
                referencedLibraries.add(tokens[0])
            } else {
                server.log.fatal(`Origin: ${opts.id}. The name of the action ${action.uses} is not valid. The correct format is library:action.`)
                throw new Error(`Origin: ${opts.id}. The transformation configuration is invalid.`)
            }
        })
    })

    // Register built-in libraries only if they are referenced by at least one action
    // and the user has not already provided a custom path for them.
    const builtinLibraries = {
        'headers':  path.resolve(process.cwd(), './src/actions/headers.js'),
        'json':     path.resolve(process.cwd(), './src/actions/json.js'),
        'jsonpath': path.resolve(process.cwd(), './src/actions/jsonpath.js'),
        'xmlsax':   path.resolve(process.cwd(), './src/actions/xmlsax.js'),
        'xmlxpath': path.resolve(process.cwd(), './src/actions/xmlxpath.js'),
    }
    for (const [key, libPath] of Object.entries(builtinLibraries)) {
        if (referencedLibraries.has(key) && !opts.bff.actionsLibraries[key]) {
            opts.bff.actionsLibraries[key] = libPath
        }
    }

    for (let actionsLibraryKey in opts.bff.actionsLibraries) {
        // If the path is not absolute, we make it absolute.
        if (!path.isAbsolute(opts.bff.actionsLibraries[actionsLibraryKey])) {
            opts.bff.actionsLibraries[actionsLibraryKey] = path.resolve(
                process.cwd(),
                opts.bff.actionsLibraries[actionsLibraryKey]
            )
        }
        // Import the library
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
            server.log.fatal(`Origin: ${opts.id}. The file ${opts.bff.actionsLibraries[actionsLibraryKey]} containing the action library must have a .js extension.`)
            throw new Error(`Origin: ${opts.id}. The transformation configuration is invalid.`)
        }
    }

    // Init the transformations
    // If BFF is true, then at least one transformation is enforced.
    let hasCacheKeyGenerationAction = false
    opts.bff.transformations.forEach(transformation => {
        try {
            transformation.re = new RegExp(transformation.urlPattern)
        } catch (error) {
            server.log.fatal(error, `Origin: ${opts.id}. urlPattern ${transformation.urlPattern} is not a valid regular expression.`)
            throw new Error(`Origin: ${opts.id}. The transformation configuration is invalid.`, { cause: error })
        }
        transformation.actions.forEach(action => {
            if (CACHE_KEY_GENERATION === action.phase) {
                hasCacheKeyGenerationAction = true
            }
            if (!bffActionsRepository[action.library] || !bffActionsRepository[action.library][action.func]) {
                server.log.fatal(`Origin: ${opts.id}. Function ${action.uses} was not found among the available actions.`)
                throw new Error(`Origin: ${opts.id}. The transformation configuration is invalid.`)
            }
        })
    })

    // If there is a cache key generation action, we need to store the body fingerprint.
    if (hasCacheKeyGenerationAction) {
        server.decorateRequest('bodyFingerprint', null)
    }

}

export function transform(opts, type, target) {
    let cacheDirectives = parseCacheControlHeader(target)
    if (CACHE_KEY_GENERATION !== type &&
        VARIANTS_TRACKER !== type &&
        cacheDirectives['no-transform']) {
        // The no-transform directive is present in the Cache-Control header.
        // No transformation is applied.
        return
    }
    opts.bff.transformations.forEach(transformation => {
        if (transformation.re.test(target.path)) {
            transformation.actions.forEach(action => {
                if (action.phase === type) {
                    bffActionsRepository[action.library][action.func](target, action.with ? action.with : null)
                }
            })
        }
    })
}