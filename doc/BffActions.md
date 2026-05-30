# BFF actions reference

This document is the catalog of every **built-in action** that ships with Speedis. Actions are the small functions invoked by `bff.transformations[].actions[]` to modify the request, the response or the cache entry at different phases of the request lifecycle.

For the higher-level concepts (transformations, phases, ordering, `no-transform`, custom libraries via `bff.actionsLibraries`) see [Configuration.md → Backend-For-Frontend configuration object](./Configuration.md#backend-for-frontend-bff-configuration-object). For the composition patterns (specific → generic, "last wins") see [bff-multiple-transformations.md](./bff-multiple-transformations.md).

## Built-in libraries

Speedis ships four built-in action libraries. Each library is auto-registered the first time a transformation references it, unless you remap it through `bff.actionsLibraries`.

| Library ID | Source | Purpose |
|------------|--------|---------|
| `headers` | [`./src/actions/headers.js`](../src/actions/headers.js) | Manipulate HTTP headers (set, delete, derive `Cache-Control` from status code). |
| `json` | [`./src/actions/json.js`](../src/actions/json.js) | Manipulate the body when it is JSON (keep / delete by JSONPath). |
| `xmlsax` | [`./src/actions/xmlsax.js`](../src/actions/xmlsax.js) | Extract XML content using a streaming SAX parser, used for `CacheKeyGeneration`. |
| `xmlxpath` | [`./src/actions/xmlxpath.js`](../src/actions/xmlxpath.js) | Extract XML content using XPath 1.0 expressions, used for `CacheKeyGeneration`. |

Action names are referenced as `<libraryId>:<actionName>` in the `uses` field of each action.

---

## Headers library

Phase compatibility: any phase that has access to `headers` (i.e. all of them except phases that operate on the body in isolation).

### `setHeaders` — set one or more headers

```json
{
  "phase": "OriginResponse",
  "uses": "headers:setHeaders",
  "with": {
    "x-custom-header": "value",
    "x-another-header": "another-value"
  }
}
```

Header names are lowercased before being applied so collisions are case-insensitive.

### `deleteHeaders` — delete one or more headers

```json
{
  "phase": "OriginResponse",
  "uses": "headers:deleteHeaders",
  "with": {
    "x-unwanted-header": true,
    "x-another-unwanted": true
  }
}
```

The values in the `with` map are ignored; only the keys matter.

### `setLastModifiedAndDateHeaders` — refresh `Last-Modified` and `Date`

```json
{
  "phase": "OriginResponse",
  "uses": "headers:setLastModifiedAndDateHeaders"
}
```

Sets both headers to the current UTC time. Useful when an origin returns stale or missing freshness metadata that would otherwise prevent caching.

### `setCacheControlByStatusCode` — derive `Cache-Control` from the HTTP status code

```json
{
  "phase": "OriginResponse",
  "uses": "headers:setCacheControlByStatusCode",
  "with": {
    "statusCodeRules": {
      "200": "public, max-age=3600",
      "404": "public, max-age=60",
      "403": "no-store",
      "401": "no-store",
      "5xx": "no-cache"
    }
  }
}
```

Priority order: an exact-code rule (e.g. `"404"`) wins over a range rule (e.g. `"4xx"`). If no rule matches, the original `Cache-Control` header from the origin is preserved unchanged. See [bff-status-code-cache-control.md](./bff-status-code-cache-control.md) for the full priority matrix and additional examples.

---

## JSON library

Phase compatibility: phases where the body is available as a string (`OriginResponse`, `ClientResponse`, `CacheResponse`, `VariantsTracker`). Both actions parse the body as JSON with `JSON.parse`; non-JSON bodies are ignored silently.

### `deleteJsonPaths` — drop selected JSON paths

```json
{
  "phase": "OriginResponse",
  "uses": "json:deleteJsonPaths",
  "with": {
    "jsonpaths": [
      "$[*].user.phones[*].type",
      "$[*].metadata"
    ]
  }
}
```

Expressions follow the [JSONPath](https://github.com/dchester/jsonpath) syntax. Useful to strip volatile or sensitive fields before storing the cache entry or fingerprinting variants.

### `keepJsonPaths` — keep only the selected JSON paths

```json
{
  "phase": "OriginResponse",
  "uses": "json:keepJsonPaths",
  "with": {
    "jsonpaths": [
      "$[*].user.name",
      "$[*].user.email"
    ]
  }
}
```

The output body is rebuilt from scratch with just the matched paths. Anything not selected is dropped.

---

## XML SAX library

Phase compatibility: designed for `CacheKeyGeneration`. The action reads `request.body` as a UTF-8 string, runs it through a streaming SAX parser and stores the resulting hash in `request.bodyFingerprint`.

### `xmlBodyFingerprint`

```json
{
  "phase": "CacheKeyGeneration",
  "uses": "xmlsax:xmlBodyFingerprint",
  "with": {
    "elements": ["ns:category", "ns:id"],
    "algorithm": "md5",
    "encoding": "hex"
  }
}
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `elements` | [String] | Yes | — | Qualified XML element names whose text content contributes to the fingerprint. Matched **by prefix + local name**, so `soap:Body` and `s:Body` are different even when both prefixes map to the same URI. |
| `algorithm` | String | No | `"md5"` | Any value accepted by Node's `crypto.createHash`. |
| `encoding` | String | No | `"hex"` | Digest encoding: `"hex"` or `"base64"`. |

Choose this action when the SOAP/XML payload uses stable prefixes and you want streaming parsing without building a full DOM. See [bff-xmlsax-body-fingerprint.md](./bff-xmlsax-body-fingerprint.md) for the full behavior matrix (multiple occurrences, descendants, CDATA, malformed XML, etc.).

---

## XML XPath library

Phase compatibility: designed for `CacheKeyGeneration`. The action builds a DOM from `request.body` and evaluates a list of XPath 1.0 expressions, concatenating the results before hashing.

### `xpathBodyFingerprint`

```json
{
  "phase": "CacheKeyGeneration",
  "uses": "xmlxpath:xpathBodyFingerprint",
  "with": {
    "xpaths": ["//ns:product/ns:category | //ns:product/ns:id"],
    "namespaces": {
      "soap": "http://schemas.xmlsoap.org/soap/envelope/",
      "ns":   "http://example.com/products"
    },
    "algorithm": "md5",
    "encoding": "hex"
  }
}
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `xpaths` | [String] | Yes | — | XPath 1.0 expressions whose results are concatenated in declaration order. |
| `namespaces` | Object | No | — | Map `{ "prefix": "namespaceURI" }` for namespace resolution. Without this, prefixed expressions cannot match anything. |
| `algorithm` | String | No | `"md5"` | Any value accepted by Node's `crypto.createHash`. |
| `encoding` | String | No | `"hex"` | Digest encoding: `"hex"` or `"base64"`. |

Choose this action when you need attribute selection, positional predicates or prefix-independent matching (via `local-name()` or an explicit `namespaces` map). See [bff-xmlxpath-body-fingerprint.md](./bff-xmlxpath-body-fingerprint.md) for the full behavior matrix and the comparison with the SAX variant.

---

## Writing your own actions

Custom libraries are registered through `bff.actionsLibraries` (see [Configuration.md](./Configuration.md#backend-for-frontend-bff-configuration-object)). Each library is an ES module that exports named functions with the signature:

```js
export function actionName(target, params) {
    // target is the request, response or cache-entry being transformed
    // params is the contents of the action's "with" field (may be null)
}
```

The same `target` and `params` contract applies to every built-in action documented above, so the source files in [`./src/actions/`](../src/actions/) double as a reference implementation when writing your own.
