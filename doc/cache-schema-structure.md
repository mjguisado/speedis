# Cache Configuration Schema Structure

This document explains the JSON Schema structure used for cache configuration validation.

## Schema Definitions

The cache configuration uses JSON Schema `definitions` to ensure consistency and avoid duplication.

### `cacheSettings` Definition

Located in `definitions.cacheSettings`, this defines the common structure for cache behavior:

```javascript
{
  type: "object",
  additionalProperties: false,
  properties: {
    private: { type: "boolean" },
    ttl: { type: "integer" },
    sortQueryParams: { type: "boolean" },
    ignoredQueryParams: {
      type: "array",
      items: { type: "string" }
    }
  }
}
```

## Cache Configuration Structure

### `cache.defaultCacheSettings`

References the `cacheSettings` definition and provides default values:

```javascript
{
  $ref: "#/definitions/cacheSettings",
  default: {
    private: false,
    ttl: -1,
    sortQueryParams: true,
    ignoredQueryParams: []
  }
}
```

### `cache.cacheables`

An array of cacheable URL patterns. Each item has **exactly two properties**:
- `urlPattern` (required): String - regex pattern to match URLs
- `cacheSettings` (optional): Object - references `#/definitions/cacheSettings`

This structure provides clear separation between:
1. **Where** to cache (`urlPattern`)
2. **How** to cache (`cacheSettings`)

## Benefits of This Approach

### 1. DRY (Don't Repeat Yourself)
Cache settings properties are defined once in the `cacheSettings` definition. Both `defaults` and individual `cacheables` items reference this single source of truth.

### 2. Consistency
All cache-related properties use the same type definitions, ensuring consistency across the configuration.

### 3. Maintainability
If we need to add, remove, or modify a cache setting property:
1. Update the `cacheSettings` definition
2. Update the `defaults` default value (if needed)
3. All references automatically use the updated definition

### 4. Type Safety
AJV validates that all cache settings conform to the defined types, catching configuration errors early.

## Example Configuration

```json
{
  "cache": {
    "defaultCacheSettings": {
      "private": false,
      "ttl": 3600,
      "sortQueryParams": true,
      "ignoredQueryParams": ["utm_source", "utm_campaign"]
    },
    "cacheables": [
      {
        "urlPattern": "/api/public/.*"
        // Inherits all defaults (no cacheSettings specified)
      },
      {
        "urlPattern": "/api/users/.*",
        "cacheSettings": {
          "private": true,
          "ttl": 1800
        }
        // Overrides private and ttl, inherits sortQueryParams and ignoredQueryParams
      },
      {
        "urlPattern": "/api/search/.*",
        "cacheSettings": {
          "ignoredQueryParams": ["page", "limit"]
        }
        // Overrides ignoredQueryParams, inherits other defaults
      }
    ]
  }
}
```

## Schema Validation Flow

1. **AJV applies defaults**: If `cache.defaultCacheSettings` is not specified, AJV applies the default values
2. **Schema validation**: AJV validates that all properties conform to the `cacheSettings` definition
3. **Runtime merging**: The `initCache` function merges `defaultCacheSettings` with individual `cacheable.cacheSettings` using nullish coalescing (`??`)

## Adding New Cache Settings

To add a new cache setting property:

1. **Update `cacheSettings` definition**:
   ```javascript
   cacheSettings: {
     properties: {
       // ... existing properties
       newProperty: { type: "boolean" }
     }
   }
   ```

2. **Update `defaultCacheSettings` default value**:
   ```javascript
   defaultCacheSettings: {
     default: {
       // ... existing defaults
       newProperty: true
     }
   }
   ```

3. **No need to update `cacheables` items** - they already reference the entire `cacheSettings` definition!

4. **Update runtime code** in `src/modules/cache.js`:
   ```javascript
   cacheable.cacheSettings.newProperty = cacheable.cacheSettings.newProperty ?? defaultCacheSettings.newProperty
   ```

That's it! The new property is now available for use in cache configuration.

