# Cache Defaults Feature - Implementation Summary

## Overview

Implemented a new `cache.defaults` configuration section that allows defining default cache behavior for all cacheable entries, with the ability to override these defaults on a per-URL-pattern basis.

## Changes Made

### 1. Schema Validation (`src/modules/originConfigValidator.js`)

- **Removed** deprecated properties from `cache` level:
  - `cache.sortQueryParams` ❌
  - `cache.ignoredQueryParams` ❌

- **Added** new `cacheSettings` definition in `definitions` section:
  ```javascript
  cacheSettings: {
    type: "object",
    additionalProperties: false,
    properties: {
      private: { type: "boolean" },
      ttl: { type: "integer" },
      sortQueryParams: { type: "boolean" },
      ignoredQueryParams: { type: "array", items: { type: "string" } }
    }
  }
  ```

- **Added** `cache.defaultCacheSettings` object that references `cacheSettings`:
  ```javascript
  defaultCacheSettings: {
    $ref: "#/definitions/cacheSettings",
    default: {
      private: false,
      ttl: -1,
      sortQueryParams: true,
      ignoredQueryParams: []
    }
  }
  ```

- **Updated** `cacheables` items to have exactly two properties:
  - `urlPattern` (required): String - regex pattern to match URLs
  - `cacheSettings` (optional): Object - references `#/definitions/cacheSettings`

  This provides a cleaner, more structured configuration where each cacheable entry has:
  1. **Where** to cache (`urlPattern`)
  2. **How** to cache (`cacheSettings` object)

This approach using JSON Schema `definitions` ensures:
- **DRY**: Cache settings properties are defined once in `cacheSettings`
- **Consistency**: Both `defaults` and `cacheables` items use the same property definitions
- **Maintainability**: Changes to cache settings only need to be made in one place

### 2. Cache Initialization (`src/modules/cache.js`)

- Simplified to use AJV-applied defaults directly from `cache.defaultCacheSettings`
- Apply defaults to each `cacheable.cacheSettings` using nullish coalescing (`??`)
- **Refactored request decoration**: Instead of multiple individual decorators, now uses a single `request.cache` object:
  ```javascript
  request.cacheSettings = {
    private: cacheable.cacheSettings.private,
    ttl: cacheable.cacheSettings.ttl,
    sortQueryParams: cacheable.cacheSettings.sortQueryParams,
    ignoredQueryParams: cacheable.cacheSettings.ignoredQueryParams
  }
  ```
- This provides a cleaner API and avoids polluting the request object with multiple properties

### 3. URL Key Generation (`src/modules/origin.js`)

- Modified `generateUrlKey()` to use request-specific parameters from `request.cache`
- Removed backward compatibility with old global `cache.sortQueryParams` and `cache.ignoredQueryParams`
- Now uses `request.cacheSettings.sortQueryParams` and `request.cacheSettings.ignoredQueryParams` exclusively

### 4. Configuration Example (`conf/origins/cache.json`)

Updated to use the new structure:
```json
{
  "cache": {
    "defaultCacheSettings": {
      "private": false,
      "ttl": 3600,
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

### 5. Documentation

- Updated `doc/Configuration.md` with new structure
- Created `doc/cache-defaults-example.md` with comprehensive examples
- Removed references to deprecated properties

## Benefits

1. **DRY Principle**: Define common settings once in `defaults`
2. **Flexibility**: Override any default on a per-URL-pattern basis
3. **Clarity**: Explicit separation between defaults and specific rules
4. **Maintainability**: Change default behavior in one place
5. **Per-URL Control**: Each URL pattern can have its own `sortQueryParams` and `ignoredQueryParams`

## Breaking Changes

⚠️ **BREAKING CHANGES** - This is a breaking change:

- `cache.sortQueryParams` is **no longer supported** - use `cache.defaults.sortQueryParams`
- `cache.ignoredQueryParams` is **no longer supported** - use `cache.defaults.ignoredQueryParams`

### Migration Guide

**Before:**
```json
{
  "cache": {
    "sortQueryParams": true,
    "ignoredQueryParams": ["cc", "delay"],
    "cacheables": [...]
  }
}
```

**After:**
```json
{
  "cache": {
    "defaultCacheSettings": {
      "sortQueryParams": true,
      "ignoredQueryParams": ["cc", "delay"]
    },
    "cacheables": [
      {
        "urlPattern": "...",
        "cacheSettings": {
          // Override specific settings here
        }
      }
    ]
  }
}
```

## Testing

- Configuration validation: ✅ Passed
- Schema validation with AJV: ✅ Passed
- Example configuration: ✅ Valid

## Files Modified

1. `src/modules/originConfigValidator.js` - Schema updates
2. `src/modules/cache.js` - Initialization and request decoration
3. `src/modules/origin.js` - URL key generation
4. `conf/origins/cache.json` - Example configuration
5. `doc/Configuration.md` - Documentation updates
6. `doc/cache-defaults-example.md` - New examples document (created)

