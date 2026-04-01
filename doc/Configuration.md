# Speedis main configuration

In Speedis, each remote server is referred to as an `origin`.
The behavior of Speedis for each origin is defined using a JSON configuration object.
This guide explains how to configure Speedis to load its main configuration and its per-origin configurations either from from local files or remotely from Redis.
During initialization, Speedis will load all available configurations.

If the USE_REDIS_CONFIG environment variable is not set, Speedis tries to reads the main configuration from the local file ./conf/speedis.json.
If the USE_REDIS_CONFIG environment variable is set (truthy) Speedis connects to Redis to fetch the main configuration from a JSON stored at SPEEDIS_CONFIG_KEY (default speedis:config:main).

If no configuration is found anywhere, Speedis logs a warning and continues with built-in defaults.

## Environment variables for Redis connection

When `USE_REDIS_CONFIG` is enabled, Speedis needs to connect to Redis to fetch the configuration. You can configure this connection using environment variables.

### Option 1: Using REDIS_URL
The simplest way is to use a single connection string:

```bash
REDIS_URL="redis://{user}:{password}@{host}:{port}/{database}"
```
**Note:** You cannot use `@` or `:` characters in your username or password when using `REDIS_URL`.

### Option 2: Using individual environment variables
Alternatively, you can set each connection parameter separately.
This method allows all special characters in usernames and passwords:

```bash
REDIS_HOST="localhost"
REDIS_PORT="6379"
REDIS_DB="0"
REDIS_USER="myuser"
REDIS_PASS="my:p@ssword"
```

### Configuration key
By default, Speedis looks for the main configuration at the Redis key `speedis:config:main`.
You can customize this with:

```bash
SPEEDIS_CONFIG_KEY="my:custom:config:key"
```

---

The following table describes the supported fields in the main configuration.

|Field|Type|Mandatory|Default|Description|
|-----|----|---------|-------|-----------|
|`maxNumberOfWorkers`|Number|`false`|[os.availableParallelism()](https://nodejs.org/api/os.html#osavailableparallelism)|This parameters limits the number of workers.|
|`port`|Number|`false`|3001|The port on which the main service is running.|
|`fastify`|Object|`false`||Options object which is used to customize the Fastify server instance. Its format is described in this [url](https://fastify.dev/docs/latest/Reference/Server/)|
|`metricServerPort`|Number|`false`|3003|The port on which the metrics service is running.|
|`metricServerLogLevel`|String|`false`|`info`|Logging level for the metric service (`trace`, `debug`, `info`, `warn`, `error`, `fatal`).|
|`localOriginsConfigs`|String|`false`|`null`|Disk location of the origin configuration files. This setting is only used if the USE_REDIS_CONFIG environment variable is not defined. Its value can be `null`, an absolute path, or a relative path. If set to `null`, Speedis will use the conf/origin folder inside the current working directory. If a relative path is provided, Speedis will resolve it to an absolute path based on the current working directory.|
|`originsConfigsKeys`|[String]|`true` if USE_REDIS_CONFIG|[]|List of Redis keys that store origin configurations.|

**Note:** To enable HTTP2 support for Speedis, the setup would look something like this:

```json
  "fastify": {
      "http2": true,
      "https": {
        "allowHTTP1": true,
        "key":  "-----BEGIN PRIVATE KEY-----\nMIIE ... 74A==\n-----END PRIVATE KEY-----\n",
        "cert": "-----BEGIN CERTIFICATE-----\nMIID ... 5jo\n-----END CERTIFICATE-----\n"
      }
  },
```

The certificates for Speedis can be generated using the following command.
```sh
./conf/generate_certificate.sh
```

You can then generate the fastify.https.key and fastify.https.cert attributes with the command:
```sh
./conf/dump_certificate.sh
```

Here’s an example of an HTTP2 request:
```sh
curl -kv -http2 --resolve speedis.localhost:3001:127.0.0.1 'https://speedis.localhost:3001/mocks/mocks/public/items/real-betis?delay=300&cc=public,max-age=10'
```
# Origins configurations

The following table describes the supported fields.

|Field|Type|Mandatory|Default|Description|
|-----|----|---------|-------|-----------|
|`id`|String|`true`||Origin’s ID|
|`prefix`|String|`true`||URL path prefix used to route incoming requests to this origin.|
|`logLevel`|String|`false`|`info`|Logging level for this origin (`trace`, `debug`, `info`, `warn`, `error`, `fatal`).|
|`exposeErrors`|Boolean|`false`|`false`|This parameter determines whether descriptive error messages are included in the response body (`true` or `false`).|
|`metrics`|Boolean|`false`|`true`|This parameter determines whether the metrics for this plugin are enabled. (`true` or `false`).|
|`origin`|Object|`true`||This object defines all the details related to the origin server. Its format is detailed below.|
|`bff`|Object|`false`||This object defines all the details related to the Backend-For-Frontend (BFF). Its format is detailed below.|
|`variantsTracker`|Object|`false`||This object defines all the details related to the Variant Tracker. Its format is detailed below.|
|`cache`|Object|`false`||This object defines all the details related to the Cache. Its format is detailed below.|
|`redis`|Object|`true` if either variantsTracker or cache exists and is enabled.||This object defines all the details related to the redis database. Its format is detailed below.|

## Origin configuration object
The following table describes the supported fields in the origin configuration object.
In the origin configuration, you must set either the http1xOptions or http2Options parameter.
The agentOptions parameter is only valid when http1xOptions is used.
|Field|Type|Mandatory|Default|Description|
|-----|----|---------|-------|-----------|
|`http1xOptions`|Object|`false`||Speedis leverages Node’s native [http](https://nodejs.org/api/http.html)/[https](https://nodejs.org/api/https.html) libraries to make HTTP/1.x requests to the origin server. This field is used to define the request options. Its format is almost identical to the original [options](https://nodejs.org/api/http.html#httprequestoptions-callback). The main difference is that, since the configuration is in JSON format, parameters defined as JavaScript entities in the original options are not supported. Options in socket.connect() are not supported.|
|`http2Options`|Object|`false`||Speedis leverages Node’s native [http2](https://nodejs.org/api/http2.html) library to make HTTP/2 requests to the origin server. This field is used to define the connection options. Its format is identical to the original [options](https://nodejs.org/api/http2.html#http2connectauthority-options-listener).
|`agentOptions`|Object|`false`||Speedis allows to use an [Agent](https://nodejs.org/api/https.html#class-httpsagent) to manage connection persistence and reuse for HTTP clients. This field is used to configure the agent. Its format is identical to the original [https options](https://nodejs.org/api/https.html#class-httpsagent) or [http options](https://nodejs.org/api/http.html#new-agentoptions).|
|`headersToForward`|[String]|`false`|[]|An array of HTTP header names received from the client that should be forwarded to the origin server. Only the headers listed here will be included in the upstream request.If the array contains an element with the value '*', all client headers will be forwarded to the origin.|
|`headersToExclude`|[String]|`false`|[]|An array of HTTP header names received from the client that should be excluded when forwarding the request to the origin server. If the array contains a single element with the value '*', all client headers will be excluded and none will be forwarded.|
|`originTimeout`|Number|`false`||Specifies the maximum time allowed for retrieving the resource from the origin server before the request is considered a failure.|
|`originBreaker`|Boolean|`false`|`false`|Enables (`true`) or disables (`false`) the origin's circuit breaker mechanism.|
|`originBreakerOptions`|Object|`true` if originBreaker is `true`||Speedis leverages [Opossum](https://nodeshift.dev/opossum/) to implement the circuit breaker mechanism. This field is used to define the circuit braker options. Its format is almost identical to the original [options](https://nodeshift.dev/opossum/#circuitbreaker). The main difference is that, since the configuration is in JSON format, parameters defined as JavaScript entities in the original options are not supported. Additionally, options related to caching and coalescing features are also not supported.|
|`authentication`|Object|`true` if cache has private cacheables||Defines how to extract user identifiers from requests for private caching. This is passive authentication - it extracts user info but doesn't manage login flows. See "Origin authentication" below for details.|

### Origin authentication
When cache entries are configured as private (per-user caching), the user identifier becomes part of the cache key.
To extract the user identifier, Speedis supports several standard [HTTP authentication](https://www.rfc-editor.org/rfc/rfc7235.html) [schemes](https://www.iana.org/assignments/http-authschemes/http-authschemes.xhtml).
The following table describes the supported fields for the `origin.authentication` configuration object.

|Field|Type|Mandatory|Default|Description|
|-----|----|---------|-------|-----------|
|`enabled`|Boolean|`false`|`true`|Enables (`true`) or disables (`false`) authentication for this origin.|
|`scheme`|String|`false`|`Basic`|[Authentication scheme](https://www.iana.org/assignments/http-authschemes/http-authschemes.xhtml) used to extract user identifiers. Supported values: `Basic`, `Bearer`.|
|`realm`|String|`false`||It defines the protected area (or scope) of a resource and tells the client which credentials are applicable.|
|`bearer`|Object|`true` if scheme is `Bearer`||Bearer token validation options. Required when `scheme` is `Bearer`. See below for details.|
|`idTransformation`|Object|`false`||Defines how the user identifier is transformed before being used in cache keys (e.g. hashing). See below for details.|

#### Bearer token validation options
The `bearer` object is only used when `scheme` is set to `Bearer`.

|Field|Type|Mandatory|Default|Description|
|-----|----|---------|-------|-----------|
|`claim`|String|`false`|`sub`|The JWT claim used as the user identifier.|
|`decryptionKey`|String|`false`||The key used to decrypt the JWT. Required for JWE tokens. Not needed for JWS tokens. The key must be a base64url encoded string. The algorithm used to encrypt the JWT must be supported by the `crypto` module of Node.js.|
|`allowUnsigned`|Boolean|`false`|`false`|If `true`, unsigned JWTs are accepted.|
|`verifyJwtSignature`|Boolean|`false`|`true`|If `true`, Speedis verifies the JWT signature against the JWKS endpoint. If `false`, the token is accepted without signature verification.|
|`jwksUri`|String|`true` if verifyJwtSignature is `true`||The URL of the JSON Web Key Set (JWKS) used to validate the JWT signature. Required when `verifyJwtSignature` is `true` (the default).|

#### User ID transformation options
The following table describes the supported fields for the `origin.authentication.idTransformation` configuration object.

|Field|Type|Mandatory|Default|Description|
|-----|----|---------|-------|-----------|
|`prefix`|String|`false`|`""`|Prefix to prepend to the user identifier.|
|`suffix`|String|`false`|`""`|Suffix to append to the user identifier.|
|`hash.enabled`|Boolean|`false`|`true`|When caching responses per user, it is often useful to transform the user identifier before it becomes part of the cache key, in order to prevent exposing raw user IDs and to safeguard Personally Identifiable Information (PII). If `true`, the user identifier is hashed before being used in the cache key.|
|`hash.algorithm`|String|`false`|`md5`|Hash algorithm to use. Must be supported by Node.js `crypto.getHashes()`.|
|`hash.hex`|Boolean|`false`|`true`|If `true`, the hash output is encoded as a hexadecimal string (default). Otherwise it will use a binary/base64 encoding.|

**Note:** When `hash.enabled` is set to `true`, the prefix and suffix are applied to the hashed value of the user identifier. If hashing is disabled, they are applied to the raw user identifier instead.

## Backend-For-Frontend (BFF) configuration object
Speedis can apply various transformations to incoming requests and outgoing responses throughout their lifecycle.
These transformations are designed to adapt the data and behavior of the origin server to meet the specific needs of different clients.
The architecture follows a Backend For Frontend (BFF) pattern, allowing for client-specific optimizations.
The following table describes the supported fields in the Backend-For-Frontend configuration object.
|Field|Type|Mandatory|Default|Description|
|-----|----|---------|-------|-----------|
|`enabled`|Boolean|`false`|`true`|Enables (`true`) or disables (`false`) Backend For Frontend (BFF).| 
|`actionsLibraries`|Object|`false`||An array containing the full paths to custom action libraries that extend the default set provided out of the box.|
|`transformations`|[Object]|`true`||Array of objects that define the set of transformations that Speedis can apply to requests and responses at different stages. Its format is detailed below.|

### Transformations configuration
Speedis allows transformations to be applied to requests and responses it handles at different phases of their lifecycle.

#### How Transformations Are Applied

**Important**: All transformations whose `urlPattern` matches the request URL are applied **in the order they appear** in the `transformations` array.

- **Multiple matches**: If a URL matches multiple patterns, all matching transformations are applied sequentially
- **Order matters**: Define specific patterns first, generic patterns last
- **Last wins**: If multiple transformations modify the same property (e.g., a header), the last transformation wins
- **Global transformations**: Use pattern `".*"` at the end to apply transformations to all URLs

**Example**: For URL `/api/users/123`:
```json
"transformations": [
  {"urlPattern": "/api/users/.*", "actions": [...]},  // ✅ Matches - Applied first
  {"urlPattern": "/api/.*", "actions": [...]},        // ✅ Matches - Applied second
  {"urlPattern": ".*", "actions": [...]}              // ✅ Matches - Applied last
]
```
All three transformations are applied in order.

#### Transformation Phases

|Phase|Description|
|-|-|
|`ClientRequest`|Apply transformations to the request received by Speedis from the client.|
|`ClientResponse`|Apply transformations to the response sent by Speedis to the client.|
|`OriginRequest`|Apply transformations to the request sent by Speedis to the origin server.|
|`OriginResponse`|Apply transformations to the response received by Speedis from the origin server.|
|`CacheRequest`|Apply transformations to the request sent by Speedis to the cache (Redis).|
|`CacheResponse`|Apply transformations to the response received by Speedis from the cache (Redis).|
|`VariantsTracker`|Apply transformations to the response before calculating its fingerprinting. Theses transformations don't affect to the response sent to the client.|
|`CacheKeyGeneration`|Apply transformations to the incoming request to compute the `bodyFingerprint` — a string derived from the request body that is included as part of the cache key. This enables caching of requests (e.g., POST-based SOAP or GraphQL) where the request body determines the response. Actions in this phase operate on the request object and must set `request.bodyFingerprint`.|

Speedis includes a set of functions, called actions, that allow changes to be made.
To simplify management, these functions are grouped into libraries.
Speedis allows easy extension of this model by adding custom actions libraries.
To do so, the user must identify the additional action libraries they want to load for each of the sources using the configuration variable actionsLibraries.
This variable contains an object, and each of its fields includes the identifier for the library and its location on disk.
The paths to the libraries can be absolute or relative; in the latter case, the current working directory of the Node.js process will be used as the base.
Custom actions libraries are ES6 modules containing actions implemented as functions with the following signature:
```js
export function actionname(target, params) {}
```
The first parameter `target` represents the object to be modified, whether it is a request or a response.
The second parameter `params` contains the value of the “with” field within the object that defines the action in the transformation configuration.
Below is an example of the transformation configuration.
```json
    "transformations": [
        {
            "urlPattern": ".*",
            "actions": [
                {
                    "phase": "OriginRequest",
                    "uses":  "headers:setHeaders",
                    "with": {
                        "x-header": "example of transformation"
                    }         
                }
            ]  
        } 
    ]
```
Note how the action name is composed of two parts separated by the `:` character.
The first part is the identifier given to the action library in the configuration, and the second part is the name of the action.
This allows using the same action name in different libraries, avoiding collisions.

Speedis includes out of the box four libraries:
|Library ID|Location|Description|
|----------|--------|-----------|
|headers|[./src/actions/headers.js](../src/actions/headers.js)|Actions to manipulate headers|
|json|[./src/actions/json.js](../src/actions/json.js)|Actions to manipulate the body in JSON format|
|xmlsax|[./src/actions/xmlsax.js](../src/actions/xmlsax.js)|Actions to extract XML content using SAX parsing for cache key generation|
|xmlxpath|[./src/actions/xmlxpath.js](../src/actions/xmlxpath.js)|Actions to extract XML content using XPath expressions for cache key generation|

### Available Actions

#### Headers Library Actions

**`setHeaders`** - Set one or more headers
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

**`deleteHeaders`** - Delete one or more headers
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

**`setLastModifiedAndDateHeaders`** - Set Last-Modified and Date headers to current time
```json
{
  "phase": "OriginResponse",
  "uses": "headers:setLastModifiedAndDateHeaders"
}
```

**`setCacheControlByStatusCode`** - Set Cache-Control header based on HTTP status code

This action allows you to define different caching behaviors for different HTTP status codes. It supports specific codes and ranges (2xx, 3xx, 4xx, 5xx).

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

Priority order: specific code (e.g., "404") > range (e.g., "4xx")

If no rule matches, the original Cache-Control header from the origin is preserved.

For detailed documentation and examples, see [BFF: Cache-Control by Status Code](./bff-status-code-cache-control.md).

#### JSON Library Actions

**`deleteJsonPaths`** - Delete specific JSON paths from the response body
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

**`keepJsonPaths`** - Keep only specific JSON paths in the response body
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

## Variant Tracker
The following table describes the supported fields in the variant tracker configuration object.
|Field|Type|Mandatory|Default|Description|
|-----|----|---------|-------|-----------|
|`enabled`|Boolean|`false`|`true`|Enables (`true`) or disables (`false`) the Variant Tracker.| 
|`urlPatterns`|[String]|`true`||List of URL patterns to track along with their variants.|

## Cache configuration object
The following table describes the supported fields in the cache configuration object.
|Field|Type|Mandatory|Default|Description|
|-----|----|---------|-------|-----------|
|`enabled`|Boolean|`false`|`true`|Enables (`true`) or disables (`false`) the Cache.|
|`purgePath`|String|`false`|`/purge`|URL path prefix used to trigger cache purge requests. Any DELETE request whose path starts with this prefix will be interpreted as a cache purge operation.|
|`includeOriginIdInCacheKey`|Boolean|`false`|`true`|This field determines whether the id of the origin is used to generate the url key for the entry (`true` or `false`).|
|`defaultCacheSettings`|Object|`false`|See below|Default cache behavior for all cacheable entries. These defaults can be overridden per cacheable entry. Its format is detailed below.|
|`localRequestsCoalescing`|Boolean|`false`|`true`|Enables (`true`) or disables (`false`) the request coalescing mechanism.|
|`distributedRequestsCoalescing`|Boolean|`false`|`false`|Enables (`true`) or disables (`false`) the request coalescing functionality across multiple instances.|
|`distributedRequestsCoalescingOptions`|Object|`true` if distributedRequestsCoalescing is `true`||Configure the distributed lock mechanism used to implements the requests coalescing functionality across multiple instances. Its format is detailed below.|
|`cacheables`|[Object]|`true`||List of URL patterns that are considered cacheable. Only request with method GET or HEAD can be cached. Its format is detailed below.|

### Default cache settings configuration object
The following table describes the supported fields in the `defaultCacheSettings` configuration object. If not specified, the following defaults are used: `{ private: false, ttl: -1, sortQueryParams: true, ignoredQueryParams: [] }`.
|Field|Type|Mandatory|Default|Description|
|-----|----|---------|-------|-----------|
|`private`|Boolean|`false`|`false`|Default value for whether responses should be cached separately for each authenticated user. Can be overridden per cacheable entry.|
|`ttl`|Number|`false`|`-1`|Default time-to-live (in seconds) for cache entries. `-1` means use HTTP cache headers. Can be overridden per cacheable entry.|
|`sortQueryParams`|Boolean|`false`|`true`|Default behavior for sorting query string parameters alphabetically when generating cache keys. Can be overridden per cacheable entry.|
|`ignoredQueryParams`|[String]|`false`|`[]`|Default list of query string parameters to ignore when generating cache keys. Can be overridden per cacheable entry.|

### Lock configuration object
The following table describes the supported fields in the lock configuration object.
|Field|Type|Mandatory|Default|Description|
|-----|----|---------|-------|-----------|
|`lockTTL`|Number|`true`||(Time-to-Live for the lock): Specifies the duration (in milliseconds) for which the lock remains valid before automatically expiring. If the lock is not explicitly released within this period, it will be removed.|
|`retryCount`|Number|`true`||(Number of retry attempts): Defines the maximum number of times the system will attempt to acquire the lock if the initial attempt fails.|
|`retryDelay`|Number|`true`||(Base delay between retries): Sets the waiting time (in milliseconds) between consecutive lock acquisition attempts. This helps prevent excessive contention when multiple processes try to acquire the same lock.|
|`retryJitter`|Number|`true`||(Randomized delay variation): Introduces a random variation (in milliseconds) to the retry delay to reduce the likelihood of multiple processes retrying at the same time, which can help prevent contention spikes.|

### Cacheable configuration object
The following table describes the supported fields in the cacheable configuration object. Each cacheable entry has exactly two properties:
|Field|Type|Mandatory|Default|Description|
|-----|----|---------|-------|-----------|
|`urlPattern`|String|`true`||Regular expression pattern to match URLs that should be cached.|
|`cacheSettings`|Object|`false`|Inherits from `cache.defaultCacheSettings`|Cache behavior settings for this URL pattern. Any property not specified will inherit from `cache.defaultCacheSettings`. See the cache settings object format below.|

### Cache settings object
The following table describes the supported fields in the `cacheSettings` object (used both in `defaultCacheSettings` and within each `cacheable` entry):
|Field|Type|Mandatory|Default|Description|
|-----|----|---------|-------|-----------|
|`private`|Boolean|`false`|`false`|Indicates whether the response for a given URL should be cached separately for each authenticated user. If `true`, `origin.authentication` must be configured.|
|`ttl`|Number|`false`|`-1`|Time-to-live (in seconds) for this cache entry. `-1` means use HTTP cache headers.|
|`sortQueryParams`|Boolean|`false`|`true`|Whether to sort query string parameters alphabetically when generating the cache key.|
|`ignoredQueryParams`|[String]|`false`|`[]`|List of query string parameters to ignore when generating the cache key.|

## Redis configuration object
The following table describes the supported fields in the redis configuration object.
|Field|Type|Mandatory|Default|Description|
|-----|----|---------|-------|-----------|
|`redisOptions`|Object|`true`||Speedis uses [node-redis](https://github.com/redis/node-redis) to connect to the Redis database where the cached contents are stored. This object defines the connection details. Its format is almost identical to the [createClient configuration](https://github.com/redis/node-redis/blob/master/docs/client-configuration.md). The main difference is that, since the configuration is in JSON format, parameters defined as JavaScript entities in the original client configuration are not supported.|
|`redisTimeout`|Number|`false`||Specifies the maximum time allowed for executing a command on the Redis server before it is considered a failure.|
|`redisBreaker`|Boolean|`false`|`false`|Enables (`true`) or disables (`false`) the redis's circuit breaker mechanism.|
|`redisBreakerOptions`|Object|`true` if redisBreaker is enabled||Speedis leverages [Opossum](https://nodeshift.dev/opossum/) to implement the circuit breaker mechanism. This field is used to define the circuit braker options. Its format is almost identical to the original [options](https://nodeshift.dev/opossum/#circuitbreaker). The main difference is that, since the configuration is in JSON format, parameters defined as JavaScript entities in the original options are not supported. Additionally, options related to caching and coalescing features are also not supported.
|`disableOriginOnRedisOutage`|Boolean|`false`|`false`|When set to `true` Speedis will not forward requests to the origin server if Redis becomes unavailable.|
