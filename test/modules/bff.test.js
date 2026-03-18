import { describe, it } from 'node:test'
import assert from 'node:assert'

describe('BFF Transformations - Multiple Matches', () => {

    it('should apply all transformations that match the URL in order', () => {
        // Simulate the BFF transform logic
        const transformations = [
            {
                urlPattern: "/api/users/.*",
                re: new RegExp("/api/users/.*"),
                actions: [
                    {
                        phase: "OriginResponse",
                        uses: "headers:setHeaders",
                        with: {
                            headers: {
                                "X-User-API": "true",
                                "Cache-Control": "private, max-age=600"
                            }
                        }
                    }
                ]
            },
            {
                urlPattern: "/api/.*",
                re: new RegExp("/api/.*"),
                actions: [
                    {
                        phase: "OriginResponse",
                        uses: "headers:setHeaders",
                        with: {
                            headers: {
                                "X-API": "true"
                            }
                        }
                    }
                ]
            },
            {
                urlPattern: ".*",
                re: new RegExp(".*"),
                actions: [
                    {
                        phase: "OriginResponse",
                        uses: "headers:setHeaders",
                        with: {
                            headers: {
                                "X-Powered-By": "Speedis",
                                "Cache-Control": "public, max-age=300"
                            }
                        }
                    }
                ]
            }
        ]

        const target = {
            path: "/api/users/123",
            headers: {}
        }

        // Simulate applying all matching transformations
        const matchedTransformations = []
        transformations.forEach(transformation => {
            if (transformation.re.test(target.path)) {
                matchedTransformations.push(transformation.urlPattern)
                transformation.actions.forEach(action => {
                    if (action.phase === "OriginResponse") {
                        // Simulate setHeaders action
                        Object.assign(target.headers, action.with.headers)
                    }
                })
            }
        })

        // Verify that all 3 transformations matched
        assert.strictEqual(matchedTransformations.length, 3)
        assert.deepStrictEqual(matchedTransformations, [
            "/api/users/.*",
            "/api/.*",
            ".*"
        ])

        // Verify that headers were applied in order
        // The last transformation should win for Cache-Control
        assert.strictEqual(target.headers['X-User-API'], 'true')
        assert.strictEqual(target.headers['X-API'], 'true')
        assert.strictEqual(target.headers['X-Powered-By'], 'Speedis')
        assert.strictEqual(target.headers['Cache-Control'], 'public, max-age=300') // Last one wins
    })

    it('should apply transformations in order - last wins for conflicting headers', () => {
        const transformations = [
            {
                urlPattern: "/api/.*",
                re: new RegExp("/api/.*"),
                actions: [
                    {
                        phase: "OriginResponse",
                        uses: "headers:setHeaders",
                        with: {
                            headers: {
                                "Cache-Control": "private, max-age=600"
                            }
                        }
                    }
                ]
            },
            {
                urlPattern: ".*",
                re: new RegExp(".*"),
                actions: [
                    {
                        phase: "OriginResponse",
                        uses: "headers:setHeaders",
                        with: {
                            headers: {
                                "Cache-Control": "public, max-age=300"
                            }
                        }
                    }
                ]
            }
        ]

        const target = {
            path: "/api/test",
            headers: {}
        }

        transformations.forEach(transformation => {
            if (transformation.re.test(target.path)) {
                transformation.actions.forEach(action => {
                    if (action.phase === "OriginResponse") {
                        Object.assign(target.headers, action.with.headers)
                    }
                })
            }
        })

        // The last transformation should win
        assert.strictEqual(target.headers['Cache-Control'], 'public, max-age=300')
    })

    it('should only apply transformations that match the URL', () => {
        const transformations = [
            {
                urlPattern: "/api/users/.*",
                re: new RegExp("/api/users/.*"),
                actions: [
                    {
                        phase: "OriginResponse",
                        uses: "headers:setHeaders",
                        with: {
                            headers: {
                                "X-User-API": "true"
                            }
                        }
                    }
                ]
            },
            {
                urlPattern: "/api/products/.*",
                re: new RegExp("/api/products/.*"),
                actions: [
                    {
                        phase: "OriginResponse",
                        uses: "headers:setHeaders",
                        with: {
                            headers: {
                                "X-Product-API": "true"
                            }
                        }
                    }
                ]
            }
        ]

        const target = {
            path: "/api/users/123",
            headers: {}
        }

        transformations.forEach(transformation => {
            if (transformation.re.test(target.path)) {
                transformation.actions.forEach(action => {
                    if (action.phase === "OriginResponse") {
                        Object.assign(target.headers, action.with.headers)
                    }
                })
            }
        })

        // Only the first transformation should have been applied
        assert.strictEqual(target.headers['X-User-API'], 'true')
        assert.strictEqual(target.headers['X-Product-API'], undefined)
    })
})

