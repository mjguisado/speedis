# BFF: Multiple Transformations and Composition

## Overview

Speedis BFF module applies **all transformations** whose `urlPattern` matches the request URL, in the order they appear in the configuration. This allows for powerful composition of transformations, from specific to generic.

## Key Concepts

### 1. All Matching Transformations Are Applied

Unlike some systems that stop at the first match, Speedis applies **every** transformation that matches the URL pattern.

```json
{
  "bff": {
    "transformations": [
      {
        "urlPattern": "/api/users/.*",
        "actions": [{"phase": "OriginResponse", "uses": "headers:setHeaders", "with": {"X-User-API": "true"}}]
      },
      {
        "urlPattern": "/api/.*",
        "actions": [{"phase": "OriginResponse", "uses": "headers:setHeaders", "with": {"X-API": "true"}}]
      },
      {
        "urlPattern": ".*",
        "actions": [{"phase": "OriginResponse", "uses": "headers:setHeaders", "with": {"X-Powered-By": "Speedis"}}]
      }
    ]
  }
}
```

**For URL `/api/users/123`:**
- ✅ Matches `/api/users/.*` → Sets `X-User-API: true`
- ✅ Matches `/api/.*` → Sets `X-API: true`
- ✅ Matches `.*` → Sets `X-Powered-By: Speedis`

**Result**: All three headers are set.

### 2. Order Matters - Last Wins

Transformations are applied in the order they appear in the array. If multiple transformations modify the same property, **the last one wins**.

```json
{
  "bff": {
    "transformations": [
      {
        "urlPattern": "/api/.*",
        "actions": [{"phase": "OriginResponse", "uses": "headers:setHeaders", "with": {"Cache-Control": "private, max-age=600"}}]
      },
      {
        "urlPattern": ".*",
        "actions": [{"phase": "OriginResponse", "uses": "headers:setHeaders", "with": {"Cache-Control": "public, max-age=300"}}]
      }
    ]
  }
}
```

**For URL `/api/test`:**
1. First transformation sets `Cache-Control: private, max-age=600`
2. Second transformation **overwrites** it with `Cache-Control: public, max-age=300`

**Result**: `Cache-Control: public, max-age=300` (last wins)

### 3. Recommended Pattern: Specific → Generic

To leverage this behavior effectively, organize transformations from most specific to most generic:

```json
{
  "bff": {
    "transformations": [
      // 1. Most specific patterns first
      {
        "urlPattern": "/api/users/premium/.*",
        "actions": [
          {
            "phase": "OriginResponse",
            "uses": "headers:setCacheControlByStatusCode",
            "with": {
              "statusCodeRules": {
                "200": "private, max-age=1800"
              }
            }
          }
        ]
      },
      // 2. Less specific patterns
      {
        "urlPattern": "/api/users/.*",
        "actions": [
          {
            "phase": "OriginResponse",
            "uses": "headers:setHeaders",
            "with": {
              "X-User-API": "true"
            }
          }
        ]
      },
      // 3. Generic patterns
      {
        "urlPattern": "/api/.*",
        "actions": [
          {
            "phase": "OriginResponse",
            "uses": "headers:setHeaders",
            "with": {
              "X-API-Version": "v1"
            }
          }
        ]
      },
      // 4. Global transformations last
      {
        "urlPattern": ".*",
        "actions": [
          {
            "phase": "OriginResponse",
            "uses": "headers:setHeaders",
            "with": {
              "X-Powered-By": "Speedis",
              "X-Server": "cache-01"
            }
          }
        ]
      }
    ]
  }
}
```

**For URL `/api/users/premium/123`:**
- ✅ Applies transformation 1 (premium-specific cache control)
- ✅ Applies transformation 2 (adds `X-User-API`)
- ✅ Applies transformation 3 (adds `X-API-Version`)
- ✅ Applies transformation 4 (adds `X-Powered-By` and `X-Server`)

**Result**: All transformations are applied, building up the final response.

## Use Cases

### Global Headers for All Responses

Add headers to all responses by using `".*"` pattern at the end:

```json
{
  "urlPattern": ".*",
  "actions": [
    {
      "phase": "OriginResponse",
      "uses": "headers:setHeaders",
      "with": {
        "X-Powered-By": "Speedis",
        "X-Cache-Server": "prod-01"
      }
    }
  ]
}
```

This transformation will apply to **every** request, regardless of other transformations.

### Layered Cache Control

Combine specific and generic cache control rules:

```json
"transformations": [
  {
    "urlPattern": "/api/products/.*",
    "actions": [{
      "phase": "OriginResponse",
      "uses": "headers:setCacheControlByStatusCode",
      "with": {
        "statusCodeRules": {
          "200": "public, max-age=3600",
          "404": "public, max-age=60"
        }
      }
    }]
  },
  {
    "urlPattern": ".*",
    "actions": [{
      "phase": "OriginResponse",
      "uses": "headers:setCacheControlByStatusCode",
      "with": {
        "statusCodeRules": {
          "5xx": "no-cache"
        }
      }
    }]
  }
]
```

For `/api/products/123` with status 500:
1. First transformation doesn't match status 500 → No change
2. Second transformation matches `5xx` → Sets `Cache-Control: no-cache`

**Result**: Server errors are never cached, even for product URLs.

## Important Notes

1. **Performance**: All transformations are evaluated for every request. Keep the list manageable.

2. **Debugging**: Use specific patterns first to make it easier to understand which transformations apply.

3. **Testing**: Test URLs that match multiple patterns to ensure the final result is what you expect.

4. **No-Transform Directive**: If the response contains `Cache-Control: no-transform`, **no transformations** are applied, regardless of configuration.

## See Also

- [BFF: Cache-Control by Status Code](./bff-status-code-cache-control.md)
- [Configuration Reference](./Configuration.md)

