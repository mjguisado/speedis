import { suite, test } from 'node:test'
import assert from 'node:assert'
import Ajv from 'ajv'
import { initOriginConfigValidator } from '../../src/modules/originConfigValidator.js'

suite('OriginConfigValidator Module', () => {

    let validator

    suite('Basic Configuration Validation', () => {

        test('should validate minimal valid configuration', (t) => {
            const ajv = new Ajv({ useDefaults: true })
            validator = initOriginConfigValidator(ajv)

            const config = {
                id: 'test-origin',
                prefix: '/test',
                origin: {
                    http2Options: {
                        authority: 'https://example.com',
                        options: {}
                    }
                }
            }

            const isValid = validator(config, ajv)
            assert.strictEqual(isValid, true)
        })

        test('should reject configuration without id', (t) => {
            const ajv = new Ajv({ useDefaults: true })
            validator = initOriginConfigValidator(ajv)

            const config = {
                prefix: '/test',
                origin: {
                    http2Options: {
                        authority: 'https://example.com',
                        options: {}
                    }
                }
            }

            const isValid = validator(config, ajv)
            assert.strictEqual(isValid, false)
            assert.ok(validator.errors)
        })

        test('should reject configuration without prefix', (t) => {
            const ajv = new Ajv({ useDefaults: true })
            validator = initOriginConfigValidator(ajv)

            const config = {
                id: 'test-origin',
                origin: {
                    http2Options: {
                        authority: 'https://example.com',
                        options: {}
                    }
                }
            }

            const isValid = validator(config, ajv)
            assert.strictEqual(isValid, false)
            assert.ok(validator.errors)
        })

        test('should reject configuration without origin', (t) => {
            const ajv = new Ajv({ useDefaults: true })
            validator = initOriginConfigValidator(ajv)

            const config = {
                id: 'test-origin',
                prefix: '/test'
            }

            const isValid = validator(config, ajv)
            assert.strictEqual(isValid, false)
            assert.ok(validator.errors)
        })
    })

    suite('HTTP1x Configuration', () => {

        test('should validate http1x configuration', (t) => {
            const ajv = new Ajv({ useDefaults: true })
            validator = initOriginConfigValidator(ajv)

            const config = {
                id: 'test-origin',
                prefix: '/test',
                origin: {
                    http1xOptions: {
                        protocol: 'https:',
                        host: 'example.com',
                        port: 443
                    }
                }
            }

            const isValid = validator(config, ajv)
            assert.strictEqual(isValid, true)
        })
    })

    suite('Cache Configuration', () => {

        test('should validate cache configuration with redis', (t) => {
            const ajv = new Ajv({ useDefaults: true })
            validator = initOriginConfigValidator(ajv)

            const config = {
                id: 'test-origin',
                prefix: '/test',
                origin: {
                    http2Options: {
                        authority: 'https://example.com',
                        options: {}
                    }
                },
                cache: {
                    cacheables: [
                        {
                            urlPattern: '/api/.*',
                            cacheSettings: {
                                private: false,
                                ttl: 3600
                            }
                        }
                    ]
                },
                redis: {
                    redisOptions: {
                        url: 'redis://localhost:6379'
                    }
                }
            }

            const isValid = validator(config, ajv)
            assert.strictEqual(isValid, true)
        })

        test('should reject cache configuration without redis', (t) => {
            const ajv = new Ajv({ useDefaults: true })
            validator = initOriginConfigValidator(ajv)

            const config = {
                id: 'test-origin',
                prefix: '/test',
                origin: {
                    http2Options: {
                        authority: 'https://example.com',
                        options: {}
                    }
                },
                cache: {
                    cacheables: [
                        {
                            urlPattern: '/api/.*',
                            private: false,
                            ttl: 3600
                        }
                    ]
                }
            }

            const isValid = validator(config, ajv)
            assert.strictEqual(isValid, false)
        })
    })
})

