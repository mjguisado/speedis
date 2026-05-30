import originSchema from '../../schemas/origin.schema.json' with { type: 'json' }

/**
 * Initializes and compiles the origin configuration validator using AJV.
 *
 * The validation rules live in [schemas/origin.schema.json](../../schemas/origin.schema.json)
 * as pure JSON, so they can be shared with external tools (e.g. the Speedis
 * admin) by importing the same file. AJV is invoked with `useDefaults: true`
 * by the caller; this function only compiles the schema.
 *
 * @param {Object} ajv - An instance of AJV validator
 * @returns {Function} Compiled validation function
 */
export function initOriginConfigValidator(ajv) {
    return ajv.compile(originSchema)
}
