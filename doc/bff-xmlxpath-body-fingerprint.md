# BFF: XML XPath Body Fingerprint for Cache Key Generation

## Overview

The `xmlxpath:xpathBodyFingerprint` action enables caching of POST requests whose **XML body** determines the response, using full **XPath 1.0** expressions to select the content to extract.

Unlike `xmlsax:xmlBodyFingerprint` — which selects content by element name — this action builds a complete DOM tree from the request body and evaluates arbitrary XPath expressions against it. This makes it the right choice when the selection logic is complex: filtering by attribute values, selecting by position, extracting attribute nodes, or navigating across axes.

The extracted texts are concatenated in the order the expressions are declared, hashed and stored in `request.bodyFingerprint` so that Speedis can generate a distinct cache key per unique body.

## Phase

`CacheKeyGeneration`

## Parameters (`with`)

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `xpaths` | `string[]` | ✅ | — | XPath 1.0 expressions to evaluate against the document. Results are concatenated in declaration order. |
| `namespaces` | `object` | ❌ | `{}` | Prefix-to-URI map for namespace-aware evaluation, e.g. `{ "soap": "http://schemas.xmlsoap.org/soap/envelope/" }`. |
| `algorithm` | `string` | ❌ | `"md5"` | Hash algorithm. Any value accepted by Node.js [`crypto.createHash()`](https://nodejs.org/api/crypto.html#cryptocreatehashalgorithm-options). |
| `encoding` | `string` | ❌ | `"hex"` | Output encoding: `"hex"` or `"base64"`. |

## Configuration Example

```json
{
  "bff": {
    "enabled": true,
    "transformations": [
      {
        "urlPattern": "/services/products.*",
        "actions": [
          {
            "phase": "CacheKeyGeneration",
            "uses": "xmlxpath:xpathBodyFingerprint",
            "with": {
              "xpaths": [
                "//wsse:UsernameToken/text()",
                "//soap:Body/text()"
              ],
              "namespaces": {
                "soap": "http://schemas.xmlsoap.org/soap/envelope/",
                "wsse": "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"
              },
              "algorithm": "md5",
              "encoding": "hex"
            }
          }
        ]
      }
    ]
  }
}
```

## Namespaces in XPath: why they must be declared in the configuration

### The root cause

XPath 1.0 identifies elements by their **namespace URI**, not by their prefix. When the XPath engine evaluates an expression like `//soap:Body/text()`, it needs to know what URI the prefix `soap` maps to **inside the expression**. It cannot take that mapping from the XML document because the two namespace contexts are completely independent.

The `namespaces` map in the configuration is precisely that resolver: it tells the XPath engine which URI each prefix in your expressions refers to.

```json
"namespaces": {
  "soap": "http://schemas.xmlsoap.org/soap/envelope/"
}
```

### The key benefit: robustness against prefix changes

Because matching is done by URI, the prefix used in the XML document is irrelevant. The expression `//soap:Body/text()` will match `<s:Body>`, `<env:Body>` or `<soap:Body>` equally, as long as all of them declare the same namespace URI:

```xml
<!-- All of these are matched by //soap:Body/text() with the namespaces map above -->
<soap:Body xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">getProducts</soap:Body>
<s:Body    xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">getProducts</s:Body>
<env:Body  xmlns:env="http://schemas.xmlsoap.org/soap/envelope/">getProducts</env:Body>
```

This is the fundamental advantage over `xmlsax`, which matches by qualified name and would only match `soap:Body`, failing on `s:Body` or `env:Body`.

### Alternative: avoid namespaces entirely with `local-name()`

If you do not need namespace precision, use the XPath `local-name()` function. The expression matches any element whose local name is `Body`, regardless of its namespace URI or prefix:

```json
"xpaths": ["//*[local-name()='Body']/text()"]
```

No `namespaces` map is needed in this case. This is simpler to configure but less precise: it will match elements with the same local name in different namespaces.

### Summary: three strategies for namespace handling

| Strategy | Configuration | Matches by | Robust to prefix change |
|---|---|---|---|
| `xmlsax` — qualified name | `elements: ["soap:Body"]` | prefix + local name | ❌ |
| `xmlxpath` — namespace map | `namespaces: { soap: "uri" }` + `//soap:Body` | URI + local name | ✅ |
| `xmlxpath` — `local-name()` | no `namespaces` needed | local name only | ✅ |

### Filtering by attribute value

```json
"xpaths": ["//item[@type='premium']/text()"]
```

### Selecting attribute values

```json
"xpaths": ["//Token/@id"]
```

### Selecting by position

```json
"xpaths": ["//param[2]/text()"]
```

## Behaviour Details

| Situation | Behaviour |
|---|---|
| Expression matches **multiple nodes** | All nodes are concatenated before moving to the next expression. |
| Expression matches **nothing** | Ignored silently; contributes nothing to the fingerprint. |
| Expression returns a **primitive** (`string()`, `count()`, etc.) | Converted to string and included. |
| **No expression matched** anything | `bodyFingerprint` is not set; cache key is generated without a body component. |
| **Invalid XPath** expression | Skipped silently; remaining expressions are still evaluated. |
| **Invalid XML** body | `bodyFingerprint` is not set; ignored silently. |
| Element node selected | Full text content including all descendants. |
| Attribute node selected | Attribute value. |

## Choosing Between `xmlsax` and `xmlxpath`

| | `xmlsax:xmlBodyFingerprint` | `xmlxpath:xpathBodyFingerprint` |
|---|---|---|
| **Selection** | List of element names | XPath 1.0 expressions |
| **Namespace handling** | Qualified name (prefix-dependent) | URI-based (prefix-independent with `namespaces` map) or `local-name()` |
| **Attribute extraction** | ❌ | ✅ |
| **Predicate filtering** | ❌ | ✅ |
| **Memory** | Streaming (low) | Full DOM in memory |
| **Configuration complexity** | Low | Medium |
| **Best for** | Simple SOAP/XML cases | Complex selection logic |

## See Also

- [BFF: XML SAX Body Fingerprint](./bff-xmlsax-body-fingerprint.md)
- [BFF: Multiple Transformations and Composition](./bff-multiple-transformations.md)
- [Configuration Reference](./Configuration.md)
