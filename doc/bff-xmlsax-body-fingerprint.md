# BFF: XML SAX Body Fingerprint for Cache Key Generation

## Overview

The `xmlsax:xmlBodyFingerprint` action enables caching of POST requests whose **XML body** determines the response — the typical case for SOAP and XML-RPC services.

It extracts the text content of a set of XML elements, concatenates them in document order, applies a hash and stores the result in `request.bodyFingerprint`. Speedis then appends this fingerprint to the cache key, so that requests with different XML bodies get separate cache entries.

## Phase

`CacheKeyGeneration`

## Parameters (`with`)

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `elements` | `string[]` | ✅ | — | Qualified XML element names whose text content will be extracted (e.g. `"soap:Body"`, `"wsse:UsernameToken"`). Matching is **case-sensitive**. |
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
        "urlPattern": "/services/products.*",
        "actions": [
          {
            "phase": "CacheKeyGeneration",
            "uses": "xmlsax:xmlBodyFingerprint",
            "with": {
              "elements": ["wsse:UsernameToken", "soap:Body"],
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

Given a SOAP request like:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
  <soap:Header>
    <wsse:Security>
      <wsse:UsernameToken>admin</wsse:UsernameToken>
    </wsse:Security>
  </soap:Header>
  <soap:Body>getProducts</soap:Body>
</soap:Envelope>
```

With `elements: ["wsse:UsernameToken", "soap:Body"]`:

1. SAX parser traverses the document in order.
2. Text of `wsse:UsernameToken` → `"admin"` (appears first in the document).
3. Text of `soap:Body` → `"getProducts"`.
4. Concatenation → `"admingetProducts"`.
5. `md5("admingetProducts")` → stored in `request.bodyFingerprint`.

## Behaviour Details

| Situation | Behaviour |
|---|---|
| Element appears **multiple times** | All occurrences are concatenated in document order. |
| Element **not found** in the XML | Ignored silently; that element contributes nothing to the fingerprint. |
| **No element matched** at all | `bodyFingerprint` is not set; the cache key is generated without a body component. |
| **Invalid XML** | Ignored silently; `bodyFingerprint` is not set. |
| Element contains **child elements** | The full text content (including text from descendants) is captured. |
| Element contains a **CDATA section** | The CDATA content is treated as regular text. |
| **Namespace prefixes** | Matching uses the qualified name exactly as written in the XML. The same element declared with a different prefix in another document will **not** match. |

## Important Notes

### Qualified Name Matching

This action matches XML elements by their **qualified name** (prefix + local name), exactly as written in the document. It does **not** resolve namespace URIs.

This means `soap:Body` and `s:Body` are treated as different elements even if both prefixes map to the same namespace URI. Make sure the `elements` list uses the same prefixes that appear in your actual XML payloads.

### body is a Buffer

Speedis stores `request.body` as a raw `Buffer`. This action converts it to a UTF-8 string before parsing. If your XML uses a different encoding, declare it in the XML declaration (`<?xml version="1.0" encoding="ISO-8859-1"?>`); however, the Buffer-to-string conversion always uses UTF-8. Ensure your origin sends UTF-8 encoded XML for correct results.

## See Also

- [BFF: Multiple Transformations and Composition](./bff-multiple-transformations.md)
- [BFF: Cache-Control by Status Code](./bff-status-code-cache-control.md)
- [Configuration Reference](./Configuration.md)
