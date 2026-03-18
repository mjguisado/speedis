# Cache Defaults Configuration Example

This document provides examples of how to use the new `cache.defaults` configuration to define default cache behavior that can be overridden per URL pattern.

## Basic Example

```json
{
  "cache": {
    "defaultCacheSettings": {
      "private": false,
      "ttl": 3600,
      "sortQueryParams": true,
      "ignoredQueryParams": ["utm_source", "utm_campaign", "utm_medium"]
    },
    "cacheables": [
      {
        "urlPattern": "/api/public/.*"
        // Uses all defaults: private=false, ttl=3600, sortQueryParams=true, ignoredQueryParams=[...]
      },
      {
        "urlPattern": "/api/users/.*",
        "cacheSettings": {
          "private": true,
          "ttl": 1800
        }
        // Overrides: private=true, ttl=1800
        // Inherits: sortQueryParams=true, ignoredQueryParams=[...]
      },
      {
        "urlPattern": "/api/search/.*",
        "cacheSettings": {
          "ignoredQueryParams": ["page", "limit", "offset"]
        }
        // Overrides: ignoredQueryParams=["page", "limit", "offset"]
        // Inherits: private=false, ttl=3600, sortQueryParams=true
      }
    ]
  }
}
```

## Advanced Example

```json
{
  "cache": {
    "defaultCacheSettings": {
      "private": false,
      "ttl": 7200,
      "sortQueryParams": true,
      "ignoredQueryParams": ["_", "timestamp", "cache_buster"]
    },
    "cacheables": [
      {
        "urlPattern": "/api/products/.*",
        "cacheSettings": {
          "ttl": 300
        }
      },
      {
        "urlPattern": "/api/user/profile/.*",
        "cacheSettings": {
          "private": true,
          "ttl": 600,
          "ignoredQueryParams": []
        }
      },
      {
        "urlPattern": "/api/analytics/.*",
        "cacheSettings": {
          "sortQueryParams": false,
          "ignoredQueryParams": ["session_id", "user_id", "timestamp"]
        }
      },
      {
        "urlPattern": "/api/static/.*",
        "cacheSettings": {
          "ttl": 86400,
          "ignoredQueryParams": ["v", "version", "build"]
        }
      }
    ]
  }
}
```

## Migration from Old Configuration

### Before (old configuration):

```json
{
  "cache": {
    "sortQueryParams": true,
    "ignoredQueryParams": ["cc", "delay"],
    "cacheables": [
      {
        "urlPattern": "/mocks/public/items/.*",
        "private": false,
        "ttl": 20
      },
      {
        "urlPattern": "/mocks/items/.*",
        "private": true
      }
    ]
  }
}
```

### After (new configuration):

```json
{
  "cache": {
    "defaultCacheSettings": {
      "private": false,
      "ttl": -1,
      "sortQueryParams": true,
      "ignoredQueryParams": ["cc", "delay"]
    },
    "cacheables": [
      {
        "urlPattern": "/mocks/public/items/.*",
        "cacheSettings": {
          "ttl": 20
        }
      },
      {
        "urlPattern": "/mocks/items/.*",
        "cacheSettings": {
          "private": true
        }
      }
    ]
  }
}
```

## Benefits

1. **DRY (Don't Repeat Yourself)**: Define common settings once in `defaults`
2. **Flexibility**: Override any default on a per-URL-pattern basis
3. **Clarity**: Explicit separation between defaults and specific rules
4. **Maintainability**: Change default behavior in one place

## Default Values

If `cache.defaults` is not specified, the following defaults are used:

```json
{
  "private": false,
  "ttl": -1,
  "sortQueryParams": true,
  "ignoredQueryParams": []
}
```

- `private: false` - Cache is shared (not per-user)
- `ttl: -1` - Use HTTP cache headers to determine TTL
- `sortQueryParams: true` - Sort query parameters alphabetically for consistent cache keys
- `ignoredQueryParams: []` - Don't ignore any query parameters

