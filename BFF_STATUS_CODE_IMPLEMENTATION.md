# BFF Status Code Cache-Control Implementation

## Summary

Implemented a new BFF action `setCacheControlByStatusCode` that allows setting different `Cache-Control` headers based on the HTTP status code of responses from the origin server.

## Implementation Details

### 1. New Action: `setCacheControlByStatusCode`

**Location**: `src/actions/headers.js`

**Features**:
- ✅ Set different `Cache-Control` headers per status code
- ✅ Support for specific status codes (e.g., `"200"`, `"404"`, `"403"`)
- ✅ Support for status code ranges (e.g., `"2xx"`, `"4xx"`, `"5xx"`)
- ✅ Preserves original Cache-Control when no rule matches
- ✅ Priority resolution: specific > range

**Function Signature**:
```javascript
export function setCacheControlByStatusCode(target, params)
```

**Parameters**:
- `target`: Response object with `statusCode` and `headers`
- `params.statusCodeRules`: Object mapping status codes/ranges to Cache-Control values

### 2. Configuration Example

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
                "200": "public, max-age=1800",
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

### 3. Priority Resolution Logic

When a response is received with a specific status code, the action resolves the `Cache-Control` header in this order:

1. **Specific code**: Check for exact match (e.g., `"404"`)
2. **Range**: Check for range match (e.g., `"4xx"` for status 404)
3. **No match**: Leave original `Cache-Control` unchanged

**Example**:
- Status 404 with rules `{"404": "...", "4xx": "..."}` → Uses `"404"` rule (specific match)
- Status 410 with rules `{"404": "...", "4xx": "..."}` → Uses `"4xx"` rule (range match)
- Status 301 with rules `{"404": "...", "4xx": "..."}` → Original Cache-Control preserved (no match)

### 4. Use Cases

#### Cache 404s for Short Time
```json
"statusCodeRules": {
  "404": "public, max-age=60"
}
```

#### Don't Cache Authentication Errors
```json
"statusCodeRules": {
  "401": "no-store",
  "403": "no-store"
}
```

#### Don't Cache Server Errors
```json
"statusCodeRules": {
  "5xx": "no-cache"
}
```

#### Different TTLs for Success vs Errors
```json
"statusCodeRules": {
  "200": "public, max-age=3600",
  "2xx": "public, max-age=1800",
  "4xx": "public, max-age=60",
  "5xx": "no-cache"
}
```

## Files Modified

### 1. `src/actions/headers.js`
- ✅ Added `setCacheControlByStatusCode` function with full JSDoc documentation
- ✅ Implements priority resolution logic (specific > range > default)
- ✅ Handles edge cases (null params, missing rules)

### 2. `conf/origins/cache.json`
- ✅ Added example transformations for `/mocks/public/items/.*`
- ✅ Added example transformations for `/mocks/items/.*`
- ✅ Demonstrates both public and private cache scenarios

### 3. `doc/Configuration.md`
- ✅ Added "Available Actions" section
- ✅ Documented all headers library actions
- ✅ Documented all json library actions
- ✅ Added reference to detailed documentation

### 4. `doc/bff-status-code-cache-control.md` (NEW)
- ✅ Comprehensive documentation with examples
- ✅ Explains priority resolution
- ✅ Common use cases
- ✅ Integration with cache module
- ✅ Complete configuration examples

### 5. `test/actions/headers.test.js` (NEW)
- ✅ 10 test cases covering all scenarios
- ✅ Tests specific code matching
- ✅ Tests range matching
- ✅ Tests default fallback
- ✅ Tests priority resolution
- ✅ Tests edge cases
- ✅ All tests passing ✅

## Testing

### Test Results
```
✔ setCacheControlByStatusCode (2.063667ms)
  ✔ should set cache-control for specific status code
  ✔ should set cache-control for status code range
  ✔ should not modify cache-control when no rule matches
  ✔ should prioritize specific over range
  ✔ should use range when specific not found
  ✔ should not set cache-control if no rule matches
  ✔ should handle 2xx range
  ✔ should handle no-store directive
  ✔ should do nothing if params is null
  ✔ should do nothing if statusCodeRules is missing

ℹ tests 10
ℹ pass 10
ℹ fail 0
```

### Configuration Validation
```
cache.json: ✅ Valid
```

## Benefits

1. **✅ Flexible**: Different cache behaviors per status code
2. **✅ Declarative**: Configuration-based, no code changes needed
3. **✅ Extensible**: Uses existing BFF infrastructure
4. **✅ Testable**: Pure function with comprehensive tests
5. **✅ Standards-compliant**: Uses standard HTTP Cache-Control directives
6. **✅ Well-documented**: Inline JSDoc + separate documentation file
7. **✅ Composable**: Can be combined with other transformations

## Integration with Existing System

- **BFF Module**: Uses existing transformation infrastructure
- **Cache Module**: Works seamlessly with cache settings
- **Multiple Transformations**: All matching transformations are applied in order (last wins for conflicts)
- **No Breaking Changes**: Purely additive feature
- **Backward Compatible**: Existing configurations continue to work

## Multiple Transformations Behavior

**Important**: Speedis applies **all transformations** whose `urlPattern` matches the URL, in order.

Example:
```json
"transformations": [
  {
    "urlPattern": "/api/products/.*",
    "actions": [{"phase": "OriginResponse", "uses": "headers:setCacheControlByStatusCode", "with": {...}}]
  },
  {
    "urlPattern": ".*",
    "actions": [{"phase": "OriginResponse", "uses": "headers:setHeaders", "with": {"X-Powered-By": "Speedis"}}]
  }
]
```

For `/api/products/123`:
- ✅ First transformation applies (sets Cache-Control based on status)
- ✅ Second transformation applies (adds X-Powered-By header)

See [BFF: Multiple Transformations](doc/bff-multiple-transformations.md) for details.

## Next Steps (Optional)

1. Consider adding similar actions for other headers (e.g., `Vary`, `ETag`)
2. Add metrics to track cache behavior by status code
3. Consider adding a helper to derive `ttl` from `max-age` automatically

