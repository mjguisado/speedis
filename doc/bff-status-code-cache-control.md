# BFF: Cache-Control by Status Code

## Overview

The `setCacheControlByStatusCode` action allows you to set different `Cache-Control` headers based on the HTTP status code of the response from the origin server. This is useful for implementing different caching strategies for successful responses, errors, redirects, etc.

## Use Cases

- **404 Not Found**: Cache for a short time to reduce load on origin for missing resources
- **403 Forbidden**: Don't cache at all (`no-store`)
- **401 Unauthorized**: Don't cache authentication errors
- **5xx Server Errors**: Don't cache server errors (`no-cache`)
- **200 OK**: Cache successfully for longer periods
- **Different TTLs per status code**: Fine-grained control over cache behavior

## Configuration

### Basic Example

```json
{
  "bff": {
    "transformations": [
      {
        "urlPattern": "/api/products/.*",
        "actions": [
          {
            "phase": "OriginResponse",
            "uses": "headers:setCacheControlByStatusCode",
            "with": {
              "statusCodeRules": {
                "200": "public, max-age=3600",
                "404": "public, max-age=60",
                "403": "no-store",
                "5xx": "no-cache"
              }
            }
          }
        ]
      }
    ]
  }
}
```

### Advanced Example with Ranges

```json
{
  "bff": {
    "transformations": [
      {
        "urlPattern": "/api/users/.*",
        "actions": [
          {
            "phase": "OriginResponse",
            "uses": "headers:setCacheControlByStatusCode",
            "with": {
              "statusCodeRules": {
                "200": "private, max-age=600",
                "404": "private, max-age=10",
                "403": "no-store",
                "401": "no-store",
                "2xx": "private, max-age=300",
                "4xx": "private, max-age=30",
                "5xx": "no-cache"
              }
            }
          }
        ]
      }
    ]
  }
}
```

## Status Code Matching

The action supports two types of rules with the following priority order:

### 1. Specific Status Code (Highest Priority)
Match exact status codes like `"200"`, `"404"`, `"500"`, etc.

```json
"statusCodeRules": {
  "200": "public, max-age=3600",
  "404": "public, max-age=60"
}
```

### 2. Status Code Ranges (Lower Priority)
Match ranges using `"2xx"`, `"3xx"`, `"4xx"`, `"5xx"`:

```json
"statusCodeRules": {
  "2xx": "public, max-age=3600",
  "4xx": "public, max-age=60",
  "5xx": "no-cache"
}
```

### 3. No Match
If no rule matches (neither specific nor range), the original `Cache-Control` header from the origin is preserved unchanged.

## Priority Resolution

When a response is received, the action resolves the `Cache-Control` header in this order:

1. **Specific code**: Check if there's a rule for the exact status code (e.g., `"404"`)
2. **Range**: If not found, check if there's a range rule (e.g., `"4xx"`)
3. **No match**: If no rule matches, the original `Cache-Control` from the origin is preserved

### Example Resolution

For a response with status code `404`:

```json
"statusCodeRules": {
  "200": "public, max-age=3600",
  "404": "public, max-age=60",      // ✅ This will be used (specific match)
  "4xx": "public, max-age=120"
}
```

For a response with status code `410`:

```json
"statusCodeRules": {
  "200": "public, max-age=3600",
  "404": "public, max-age=60",
  "4xx": "public, max-age=120"      // ✅ This will be used (range match)
}
```

For a response with status code `301`:

```json
"statusCodeRules": {
  "200": "public, max-age=3600",
  "404": "public, max-age=60",
  "4xx": "public, max-age=120"
}
// ✅ No match - original Cache-Control from origin is preserved
```

## Common Cache-Control Directives

- `public, max-age=3600` - Cache publicly for 1 hour
- `private, max-age=600` - Cache privately (per-user) for 10 minutes
- `no-store` - Don't cache at all
- `no-cache` - Cache but always revalidate
- `public, max-age=3600, stale-while-revalidate=60` - Cache for 1 hour, serve stale for 1 minute while revalidating

## Integration with Cache Module

The `Cache-Control` header set by this action will be used by Speedis to determine:
- Whether to cache the response
- How long the response is considered fresh
- Whether the cache is public or private

The `ttl` setting in `cacheSettings` controls how long the entry persists in Redis, which can be different from the `max-age` in `Cache-Control`.

## Complete Example

```json
{
  "cache": {
    "defaultCacheSettings": {
      "private": false,
      "ttl": 3600,
      "sortQueryParams": true,
      "ignoredQueryParams": ["utm_source"]
    },
    "cacheables": [
      {
        "urlPattern": "/api/products/.*",
        "cacheSettings": {
          "ttl": 1800
        }
      }
    ]
  },
  "bff": {
    "transformations": [
      {
        "urlPattern": "/api/products/.*",
        "actions": [
          {
            "phase": "OriginResponse",
            "uses": "headers:setCacheControlByStatusCode",
            "with": {
              "statusCodeRules": {
                "200": "public, max-age=1800, stale-while-revalidate=60",
                "404": "public, max-age=300",
                "403": "no-store",
                "5xx": "no-cache"
              }
            }
          }
        ]
      }
    ]
  }
}
```

In this example:
- Successful responses (200) are cached for 30 minutes with stale-while-revalidate
- 404 responses are cached for 5 minutes
- 403 responses are not cached
- 5xx errors are not cached
- Other responses (e.g., 301, 302, 204) keep their original Cache-Control from the origin
- All entries persist in Redis for 30 minutes (from `cacheSettings.ttl`)

