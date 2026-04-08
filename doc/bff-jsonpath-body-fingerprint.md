# BFF: JSON Body Fingerprint for Cache Key Generation

## Overview

The `jsonpath:jsonpathBodyFingerprint` action enables caching of POST requests whose **JSON body** determines the response — typical for REST APIs, GraphQL or any service where the request body contains the discriminating parameters.

It parses the request body as JSON, evaluates a list of **JSONPath** expressions to extract values, concatenates the results in declaration order, optionally applies a hash, and stores the result in `request.bodyFingerprint`. Speedis then appends this fingerprint to the cache key so that requests with different JSON bodies get separate cache entries.

## Phase

`CacheKeyGeneration`

## Parameters (`with`)

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `jsonpaths` | `string[]` | ✅ | — | JSONPath expressions to evaluate against the parsed body. Results are concatenated in declaration order. |
| `hash` | `object` | ❌ | `{}` | Hash configuration sub-object. |
| `hash.enabled` | `boolean` | ❌ | `false` | Whether to apply the hash. When `false` (default), the raw concatenated string is stored directly in `request.bodyFingerprint`. |
| `hash.algorithm` | `string` | ❌ | `"md5"` | Hash algorithm. Any value accepted by Node.js [`crypto.createHash()`](https://nodejs.org/api/crypto.html#cryptocreatehashalgorithm-options) is valid (e.g. `"sha256"`). |
| `hash.encoding` | `string` | ❌ | `"hex"` | Output encoding of the hash digest: `"hex"` or `"base64"`. |

## Configuration Example

```json
{
  "bff": {
    "enabled": true,
    "transformations": [
      {
        "urlPattern": "/api/products/search",
        "actions": [
          {
            "phase": "CacheKeyGeneration",
            "uses": "jsonpath:jsonpathBodyFingerprint",
            "with": {
              "jsonpaths": [
                "$.filter.category",
                "$.filter.priceRange"
              ],
              "hash": {
                "enabled": true,
                "algorithm": "md5",
                "encoding": "hex"
              }
            }
          }
        ]
      }
    ]
  }
}
```

## How It Works

Given a JSON request body like:

```json
{
  "filter": { "category": "electronics", "priceRange": [100, 500] },
  "page": 1
}
```

With `jsonpaths: ["$.filter.category", "$.filter.priceRange"]`:

1. Body (Buffer) is parsed as UTF-8 JSON.
2. `$.filter.category` → `"electronics"` → serialised as `"electronics"`.
3. `$.filter.priceRange` → `[100, 500]` → serialised as `"[100,500]"`.
4. Concatenation → `"electronics[100,500]"`.
5. `md5("electronics[100,500]")` → stored in `request.bodyFingerprint`.

## Value Serialisation

| JSON value type | Serialisation |
|---|---|
| `string` | Used as-is. |
| `number` | Converted with `String()` (e.g. `42` → `"42"`). |
| `boolean` | Converted with `String()` (e.g. `true` → `"true"`). |
| `object` / `array` | Serialised with `JSON.stringify()`. |
| `null` | Skipped — contributes nothing to the fingerprint. |

## Behaviour Details

| Situation | Behaviour |
|---|---|
| Expression matches **multiple nodes** | All values are concatenated before moving to the next expression. |
| Expression matches **nothing** | Ignored silently; contributes nothing to the fingerprint. |
| **No expression matched** anything | `bodyFingerprint` is not set; cache key is generated without a body component. |
| **Invalid JSONPath** expression | Skipped silently; remaining expressions are still evaluated. |
| **Invalid JSON** body | `bodyFingerprint` is not set; ignored silently. |
| `hash.enabled` is `false` | Raw concatenated string stored; `hash.algorithm` and `hash.encoding` are ignored. |

## Usage: Disabling the Hash

In some scenarios (e.g. debugging or when the fingerprint is used downstream as a readable string) you may want to skip the hash:

```json
{
  "jsonpaths": ["$.operation", "$.userId"],
  "hash": { "enabled": false }
}
```

`request.bodyFingerprint` will contain the literal concatenated string (e.g. `"searchabc123"`), which becomes part of the cache key as-is.

## See Also

- [BFF: XML SAX Body Fingerprint](./bff-xmlsax-body-fingerprint.md)
- [BFF: XML XPath Body Fingerprint](./bff-xmlxpath-body-fingerprint.md)
- [BFF: Multiple Transformations and Composition](./bff-multiple-transformations.md)
- [Configuration Reference](./Configuration.md)
