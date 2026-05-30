# Speedis configuration reference

This document is the canonical reference for every supported configuration option in Speedis. It is generated and kept in sync with the AJV schemas defined in:

- [`src/index.js`](../src/index.js) — main configuration schema (`speedis.json`).
- [`src/modules/originConfigValidator.js`](../src/modules/originConfigValidator.js) — per-origin configuration schema.

In Speedis, each remote server is referred to as an `origin`. The behavior of Speedis for each origin is defined using a JSON configuration object. Speedis loads two layers of configuration during initialization:

1. The **main configuration**, which controls process-wide settings (Fastify server, clustering, metrics endpoint, where to find origin definitions).
2. One **per-origin configuration** per upstream server, registered as an independent Fastify plugin instance and routed by URL path prefix.

Both layers can be loaded either from local JSON files or remotely from a Redis database. Selection is driven by environment variables (see [Environment variables](#environment-variables-for-redis-connection)).

## Table of contents

- [Loading configuration](#loading-configuration)
  - [Environment variables for Redis connection](#environment-variables-for-redis-connection)
  - [Loading configurations into Redis](#loading-configurations-into-redis)
- [Main configuration (`speedis.json`)](#main-configuration-speedisjson)
  - [Fastify options](#fastify-options)
- [Origin configuration](#origin-configuration)
  - [Origin configuration object](#origin-configuration-object)
    - [`http1xOptions`](#http1xoptions)
    - [`http2Options`](#http2options)
    - [`agentOptions`](#agentoptions)
    - [Circuit-breaker options](#circuit-breaker-options)
    - [Origin authentication](#origin-authentication)
  - [BFF configuration object](#backend-for-frontend-bff-configuration-object)
  - [Variant Tracker](#variant-tracker)
  - [Cache configuration object](#cache-configuration-object)
  - [Redis configuration object](#redis-configuration-object)
  - [CORS configuration object](#cors-configuration-object)

---

## Loading configuration

If the `USE_REDIS_CONFIG` environment variable is **not** set, Speedis tries to read the main configuration from the local file `./conf/speedis.json`.

If the `USE_REDIS_CONFIG` environment variable **is** set (any truthy value), Speedis connects to Redis to fetch the main configuration from a JSON stored at the key defined by `SPEEDIS_CONFIG_KEY` (default `speedis:config:main`).

If no configuration is found anywhere, Speedis logs a warning and continues with built-in defaults. Configuration errors (schema validation failures) abort startup with exit code 1.

### Environment variables for Redis connection

When `USE_REDIS_CONFIG` is enabled, Speedis needs a few environment variables to know how to reach the Redis instance that holds its configuration (and which key inside it to read). The full list — `USE_REDIS_CONFIG`, `SPEEDIS_CONFIG_KEY`, `REDIS_URL`, `REDIS_HOST` / `REDIS_PORT` / `REDIS_DB` / `REDIS_USER` / `REDIS_PASS`, plus the runtime/development toggles `NODE_ENV` and `NODE_TLS_REJECT_UNAUTHORIZED` — is documented in a single place: see [EnvironmentVariables.md](./EnvironmentVariables.md).

> **Reminder:** those variables only configure the **configuration store**. The Redis instance used as the cache backend is configured per-origin under [`redis.redisOptions`](#redis-configuration-object) and is fully independent.

#### Loading configurations into Redis

The repository includes a helper script that uploads the local `conf/` tree into Redis using the key layout expected by Speedis:

| Source file | Redis key |
|---|---|
| `conf/speedis.json` | `speedis:config:main` |
| `conf/origins/<name>.json` | `speedis:config:origins:<name>` |

The origin key is derived from the filename (without the `.json` extension), not from the `id` field inside the JSON — so file naming matters when configuring `originsConfigsKeys`.

Usage:
```bash
# From inside Docker Compose / Kubernetes (default REDIS_URL=redis://redis:6379)
./conf/loadConfigsToRedis.sh

# From the host machine pointing at a local Redis
REDIS_URL=redis://localhost:6379 ./conf/loadConfigsToRedis.sh
```

The script iterates over every `*.json` file in `conf/origins/`, so adding a new origin only requires dropping its file there and re-running the script.

---

## Main configuration (`speedis.json`)

The following table describes every supported field of the main configuration object. Unless stated otherwise the field is optional. Fields with a default in the **Default** column are auto-populated by AJV at validation time (`useDefaults: true`).

| Field | Type | Mandatory | Default | Description |
|-------|------|-----------|---------|-------------|
| `maxNumberOfWorkers` | Number | No | [`os.availableParallelism()`](https://nodejs.org/api/os.html#osavailableparallelism) | Upper bound on the number of Node.js cluster workers. The actual number is `Math.min(os.availableParallelism(), maxNumberOfWorkers)`. Remember that the cluster also needs the primary process, so a host with three or more CPUs is recommended. |
| `port` | Number | No | `3001` | TCP port the main HTTP/HTTPS service listens on (bound on `::`, i.e. all interfaces, IPv4 + IPv6). |
| `fastify` | Object | No | — | Options forwarded to the underlying [Fastify factory](https://fastify.dev/docs/latest/Reference/Server/). Speedis validates a curated subset (see [Fastify options](#fastify-options)). |
| `metricServerPort` | Number | No | `3003` | TCP port for the Prometheus metrics server (separate Fastify instance running on the cluster primary). |
| `metricServerLogLevel` | String | No | `"info"` | Pino log level for the metrics server. Allowed values: `trace`, `debug`, `info`, `warn`, `error`, `fatal`. |
| `localOriginsConfigs` | String \| `null` | No | `null` | Directory where per-origin JSON files live when `USE_REDIS_CONFIG` is **not** set. `null` resolves to `conf/origins/` under the working directory; a relative path is resolved against the working directory; absolute paths are used as-is. Ignored when origin configs are loaded from Redis. |
| `originsConfigsKeys` | [String] | Yes when `USE_REDIS_CONFIG` is set | `[]` | List of Redis keys, each one holding a JSON document with a single origin configuration. Speedis loads them in array order. |

> **Validation note:** the schema sets `additionalProperties: false`. Any unknown field at the top level aborts startup with a validation error.

### Fastify options

The `fastify` object is forwarded to [`fastify(opts)`](https://fastify.dev/docs/latest/Reference/Server/#factory). Speedis validates a curated subset of fields. Other Fastify options not listed below are also accepted (the schema uses `additionalProperties: true`), so anything supported by your Fastify version can be set even if it is not explicitly documented here. Function-valued options (`logger` instance, `serverFactory`, `genReqId`, `trustProxy` callbacks, `frameworkErrors`, `clientErrorHandler`, `rewriteUrl`, `querystringParser`, `defaultRoute`, `onBadUrl`, custom `forceCloseConnections`, etc.) cannot be expressed in JSON and are intentionally omitted.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `http` | Object\|null | `null` | Options for the underlying `http.Server`. |
| `http2` | Boolean | `false` | Enable HTTP/2 mode. When `true`, `https` must usually be provided too (see the HTTP/2 example below). |
| `https` | Object\|null | `null` | TLS options. Speedis accepts inline PEM strings (`key`, `cert`) so the configuration is fully JSON-serializable. |
| `connectionTimeout` | Integer | `0` | Server-level connection timeout in ms. `0` disables the timeout. |
| `keepAliveTimeout` | Integer | `72000` | Keep-alive timeout in ms applied to idle HTTP/1.x connections. |
| `maxRequestsPerSocket` | Integer | `0` | Maximum number of requests served per socket. `0` disables the limit. |
| `requestTimeout` | Integer | `0` | Request timeout in ms. `0` disables the timeout. |
| `bodyLimit` | Integer | `1048576` | Max request body size in bytes (1 MiB by default). Remember Speedis captures the body as a raw `Buffer`, so this is the upper bound on POST/PUT payloads forwarded to the origin. |
| `onProtoPoisoning` | String | `"error"` | Behavior when parsing JSON containing `__proto__`. One of `"error"`, `"remove"`, `"ignore"`. |
| `onConstructorPoisoning` | String | `"error"` | Same as above for the `constructor` property. |
| `requestIdHeader` | Boolean | `false` | Whether to derive the request id from a header (`true`) or always generate one. |
| `requestIdLogLabel` | String | `"reqId"` | Label used to attach the request id to log lines. |
| `pluginTimeout` | Integer | `10000` | Plugin readiness timeout in ms. |
| `exposeHeadRoutes` | Boolean | `true` | Auto-register `HEAD` routes for every `GET`. |
| `return503OnClosing` | Boolean | `true` | Respond with `503` to in-flight requests while the server is closing. |
| `ajv` | Object | — | Options forwarded to the internal AJV instance used by Fastify (not the one Speedis uses to validate its own configuration). |
| `serializerOpts` | Object | — | Options for `fast-json-stringify`. |
| `http2SessionTimeout` | Integer | `72000` | Idle timeout in ms for HTTP/2 sessions. |
| `allowErrorHandlerOverride` | Boolean | `false` | Whether plugins can override the global error handler. |
| `routerOptions` | Object | — | Options for the underlying [find-my-way](https://github.com/delvedor/find-my-way) router. See sub-table below. |

#### `fastify.routerOptions`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `allowUnsafeRegex` | Boolean | `false` | Allow potentially catastrophic regex in route definitions. |
| `buildPrettyMeta` | Object | — | Build pretty meta for route registration logs. |
| `caseSensitive` | Boolean | `true` | Route matching is case sensitive. |
| `constraints` | Object | — | Additional constraint plugins. |
| `ignoreDuplicateSlashes` | Boolean | `false` | Collapse duplicate slashes when matching routes. |
| `ignoreTrailingSlash` | Boolean | `false` | Match `/foo` and `/foo/` as the same route. |
| `maxParamLength` | Integer | `100` | Max length (in characters) of a route parameter. |
| `useSemicolonDelimiter` | Boolean | `false` | Treat `;` as path-segment delimiter. |

**Note:** to enable HTTP/2 support for Speedis, the setup would look something like this:

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

---

## Origin configuration

Each origin is described by an independent JSON document, located either in `conf/origins/<name>.json` (when loading from disk) or in a Redis key listed by `main.originsConfigsKeys` (when `USE_REDIS_CONFIG` is set). Speedis registers one Fastify plugin instance per origin and dispatches incoming traffic by matching the URL path against the origin's `prefix`.

The schema for an origin sets `additionalProperties: false`; any field not listed below aborts the load of that specific origin (Speedis logs the error and continues with the rest).

### Top-level fields

| Field | Type | Mandatory | Default | Description |
|-------|------|-----------|---------|-------------|
| `id` | String | Yes | — | Stable identifier of the origin. Used in logs, metrics (`origin` label) and — unless disabled via `cache.includeOriginIdInCacheKey: false` — as the first segment of the Redis cache key. |
| `prefix` | String | Yes | — | URL path prefix used to route incoming requests to this origin (e.g. `/cache`). When the request reaches the origin, this prefix is stripped from the path. |
| `logLevel` | String | No | `"info"` | Pino log level for this origin (`trace`, `debug`, `info`, `warn`, `error`, `fatal`). |
| `exposeErrors` | Boolean | No | `false` | When `true`, Speedis includes a descriptive `msg` field in the JSON response body of internal error responses (e.g. 500 / 503 / 504). Leave it as `false` in production to avoid leaking internal details. |
| `metrics` | Boolean | No | `true` | Enables Prometheus metrics (`speedis_http_requests_total`, `speedis_http_responses_total`, `speedis_http_responses_duration`, `speedis_tcp_connections`) for this origin. |
| `origin` | Object | Yes | — | Defines how to reach the upstream server. See [Origin configuration object](#origin-configuration-object). |
| `cors` | Object | No | — | Per-origin [CORS configuration object](#cors-configuration-object). When omitted (or `enabled: false`), `@fastify/cors` is not registered for this origin and no `Access-Control-*` headers are added. |
| `bff` | Object | No | — | [Backend-For-Frontend transformations](#backend-for-frontend-bff-configuration-object) applied at various phases of the request lifecycle. |
| `variantsTracker` | Object | No | — | [Variant Tracker](#variant-tracker) settings — counts how many distinct response shapes a URL produces. |
| `cache` | Object | No | — | [Cache configuration object](#cache-configuration-object). |
| `redis` | Object | Conditional | — | [Redis configuration object](#redis-configuration-object). **Required** whenever `cache` or `variantsTracker` is present and enabled (validated by a root-level conditional rule in the schema). |

### Origin configuration object

This object describes how Speedis talks to the upstream server. The schema enforces a few mutually-exclusive constraints:

- Exactly **one** of `http1xOptions` or `http2Options` must be present (validated with `oneOf`).
- `agentOptions` is only valid when `http1xOptions` is used (HTTP/2 manages its own sessions).
- When `originBreaker` is `true`, `originBreakerOptions` is required.

| Field | Type | Mandatory | Default | Description |
|-------|------|-----------|---------|-------------|
| `http1xOptions` | Object | Conditional | — | Connection options used by Node's [`http`](https://nodejs.org/api/http.html) / [`https`](https://nodejs.org/api/https.html) clients. See [`http1xOptions`](#http1xoptions). |
| `http2Options` | Object | Conditional | — | Connection options used by Node's [`http2`](https://nodejs.org/api/http2.html) client. See [`http2Options`](#http2options). |
| `agentOptions` | Object | No (HTTP/1.x only) | — | Options passed to `new http.Agent(...)` / `new https.Agent(...)` for connection pooling. See [`agentOptions`](#agentoptions). |
| `headersToForward` | [String] | No | `["*"]` | Whitelist of incoming client headers to forward upstream. Special value `"*"` forwards every client header. |
| `headersToExclude` | [String] | No | `[]` | Blacklist applied **after** the whitelist. Special value `"*"` excludes every header (overrides `headersToForward`). |
| `originTimeout` | Integer | No | — | Maximum time in **milliseconds** allowed for a single request to the origin. When the timeout fires, Speedis aborts the request and the error is reported as `ETIMEDOUT` (mapped to HTTP `504`). When `originBreaker` is enabled, the timeout is managed by the breaker instead. |
| `originBreaker` | Boolean | No | `false` | Enables the upstream circuit breaker (Opossum). |
| `originBreakerOptions` | Object | Yes when `originBreaker` is `true` | — | Tuning options for the circuit breaker. See [Circuit-breaker options](#circuit-breaker-options). |
| `authentication` | Object | Yes when any `cacheable` is `private` | — | Describes how Speedis extracts a stable user identifier from incoming requests in order to build per-user cache keys. See [Origin authentication](#origin-authentication). |

#### `http1xOptions`

Mirrors the options accepted by [`http.request()`](https://nodejs.org/api/http.html#httprequestoptions-callback). Only JSON-serializable fields are accepted (callbacks like `createConnection`, `lookup` or `signal` are not supported, nor are options that belong to `socket.connect()`).

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `auth` | String | — | `user:password` for Basic authentication on the request to the origin. |
| `defaultPort` | Integer | — | Default port when none is specified in the URL. |
| `family` | Integer | — | IP stack family: `4` or `6`. |
| `headers` | Object | `{}` | Headers added to every upstream request. Speedis lowercases the keys at startup so subsequent merges are case-insensitive. |
| `hints` | Integer | — | DNS lookup hints. |
| `host` | String | `"localhost"` | Hostname. |
| `hostname` | String | — | Alias of `host` (takes precedence over `host` when both are set). |
| `insecureHTTPParser` | Boolean | `false` | Use the lenient HTTP parser. |
| `joinDuplicateHeaders` | Boolean | `false` | Join duplicate response headers with a comma. |
| `localAddress` | String | — | Local interface to bind the socket. |
| `localPort` | Integer | — | Local port to bind the socket. |
| `maxHeaderSize` | Integer | `16384` | Max bytes for the response headers section. |
| `method` | String | `"GET"` | Default method (overridden per request). |
| `path` | String | `"/"` | Default path (overridden per request). |
| `port` | Integer | `80` | TCP port. |
| `protocol` | String | `"http:"` | Either `"http:"` or `"https:"`. |
| `setDefaultHeaders` | Boolean | `true` | Whether Node should add default headers. |
| `setHost` | Boolean | `true` | Whether Node should add a `Host` header automatically. |
| `socketPath` | String | — | UNIX domain socket. |
| `timeout` | Integer | — | Socket-level timeout in ms. Prefer `originTimeout` at the parent level. |
| `uniqueHeaders` | Array | — | Headers that must appear at most once. |

#### `http2Options`

Forwarded directly to [`http2.connect(authority, options)`](https://nodejs.org/api/http2.html#http2connectauthority-options-listener). The schema is intentionally minimal so that any future HTTP/2 option remains accessible.

| Field | Type | Mandatory | Description |
|-------|------|-----------|-------------|
| `authority` | String | Yes | The upstream authority (`https://host:port`). |
| `options` | Object | No | Forwarded as-is to `http2.connect`. Useful entries include `rejectUnauthorized`, `ca`, `cert`, `key` and TLS-level `timeout`. |

Speedis maintains a single multiplexed HTTP/2 session per origin and reopens it transparently on `error`, `close` or `goaway` events.

#### `agentOptions`

Forwarded to `new http.Agent(...)` or `new https.Agent(...)` depending on `http1xOptions.protocol`. Useful for keep-alive tuning.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `keepAlive` | Boolean | `false` | Enable HTTP keep-alive. |
| `keepAliveMsecs` | Integer | `1000` | Initial delay (ms) for TCP keep-alive probes when `keepAlive` is `true`. |
| `maxSockets` | Integer | — | Maximum number of sockets per host. |
| `maxTotalSockets` | Integer | — | Maximum number of sockets across all hosts. |
| `maxFreeSockets` | Integer | `256` | Maximum sockets to keep open in the free state per host. |
| `scheduling` | String | `"lifo"` | Free-socket scheduling: `"fifo"` or `"lifo"`. |
| `timeout` | Integer | — | Socket timeout in ms. |
| `maxCachedSessions` | Integer | `100` | (HTTPS only) Maximum number of TLS sessions cached for reuse. |
| `servername` | String | — | (HTTPS only) SNI hostname. |

#### Circuit-breaker options

Both `originBreakerOptions` and `redisBreakerOptions` share the same schema, which mirrors a JSON-serializable subset of [Opossum's `CircuitBreaker` options](https://nodeshift.dev/opossum/#circuitbreaker). Cache- and coalesce-related options are intentionally **not** exposed, because Speedis implements its own caching/coalescing layer and forces them off (`cache: false`, `coalesce: false`) when creating the breaker.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxFailures` | Integer | — | Deprecated in Opossum; included for forward compatibility but should not be relied upon. |
| `resetTimeout` | Integer | `30000` | Time in ms the breaker stays open before switching to half-open and probing the underlying call. |
| `rollingCountTimeout` | Integer | `10000` | Length of the rolling window (ms) used to compute failure stats. |
| `rollingCountBuckets` | Integer | `10` | Number of buckets the rolling window is split into. |
| `rollingPercentilesEnabled` | Boolean | `true` | Track execution-time percentiles. |
| `capacity` | Integer | `Number.MAX_SAFE_INTEGER` | Maximum number of concurrent in-flight calls. |
| `errorThresholdPercentage` | Integer | `50` | Percentage of failures in the rolling window that trips the breaker. |
| `enabled` | Boolean | `true` | Allows declaring breaker options while keeping the breaker dormant (useful for staged rollouts). |
| `allowWarmUp` | Boolean | `false` | Skip the error-percentage check during the first rolling window so the breaker doesn't trip on transient startup errors. |
| `volumeThreshold` | Integer | `0` | Minimum number of calls in the rolling window before the breaker is allowed to open. |
| `enableSnapshots` | Boolean | — | Emit periodic stats snapshots (used by the Opossum stats stream). |
| `autoRenewAbortController` | Boolean | `false` | Recreate the `AbortController` after every fire so a single timeout doesn't poison subsequent calls. |

When the breaker opens on the Redis side, Speedis attaches a `Retry-After` value (computed from `resetTimeout`) for downstream consumers to honor.

#### Origin authentication

When cache entries are configured as `private` (per-user caching), the user identifier becomes part of the cache key. Speedis performs **passive** authentication: it never runs a login flow, it only extracts the user identifier from credentials that the caller (typically an upstream API gateway) has already validated. Supported schemes follow [RFC 7235](https://www.rfc-editor.org/rfc/rfc7235.html) / [IANA registry](https://www.iana.org/assignments/http-authschemes/http-authschemes.xhtml).

When the extraction fails for a request targeting a `private` resource, Speedis responds with `401 Unauthorized` and a `WWW-Authenticate` header constructed from `scheme` and `realm`.

| Field | Type | Mandatory | Default | Description |
|-------|------|-----------|---------|-------------|
| `enabled` | Boolean | No | `true` | Set to `false` to opt-out even when the schema would otherwise require this block (note: validation still rejects an enabled cache module with private cacheables unless authentication is enabled too). |
| `scheme` | String | No | `"Basic"` | Authentication scheme expected in the `Authorization` header. Supported values: `"Basic"`, `"Bearer"`. |
| `realm` | String | No | — | Used in the `WWW-Authenticate` header to tell clients which protected area they failed to access. |
| `bearer` | Object | Yes when `scheme` is `"Bearer"` | — | Bearer-token validation options. See below. |
| `idTransformation` | Object | No | — | How to transform the extracted user identifier before using it in cache keys. See below. |

##### `bearer` — Bearer token validation options

Used only when `scheme` is `"Bearer"`. Speedis supports both **JWS** (signed JWTs, 3 parts) and **JWE** (encrypted JWTs, 5 parts). For JWE the token is decrypted first using `decryptionKey` and then validated as a JWS.

| Field | Type | Mandatory | Default | Description |
|-------|------|-----------|---------|-------------|
| `claim` | String | No | `"sub"` | JWT claim whose value is used as the user identifier. If the claim is missing the request is rejected with 401. |
| `decryptionKey` | String | No | — | Key used to decrypt JWE tokens. **Required when the token is a JWE.** Must be a base64url-encoded string compatible with `jose.compactDecrypt`. |
| `allowUnsigned` | Boolean | No | `false` | When `true`, JWTs with `alg: "none"` are accepted (their payload is decoded as plain JSON). Use with extreme care. |
| `verifyJwtSignature` | Boolean | No | `true` | When `true`, signatures are verified against `jwksUri` using `jose.jwtVerify`. Supported algorithms: `RS256`, `RS384`, `RS512`, `ES256`, `ES384`, `ES512`. |
| `jwksUri` | String | Yes when `verifyJwtSignature` is `true` | — | URL of the JSON Web Key Set used to verify signatures. Loaded once at startup via `jose.createRemoteJWKSet`. |

##### `idTransformation` — User-ID transformation options

Caching the raw user identifier is rarely desirable (it can expose PII in Redis dumps). This block lets you hash and/or decorate the identifier before it becomes part of the cache key.

| Field | Type | Mandatory | Default | Description |
|-------|------|-----------|---------|-------------|
| `prefix` | String | No | `""` | Prefix prepended to the (optionally hashed) identifier. |
| `suffix` | String | No | `""` | Suffix appended to the (optionally hashed) identifier. |
| `hash.enabled` | Boolean | No | `true` | Hash the identifier before assembling the cache key. |
| `hash.algorithm` | String | No | `"md5"` | Any algorithm supported by Node's [`crypto.getHashes()`](https://nodejs.org/api/crypto.html#cryptogethashes) (e.g. `"sha256"`). |
| `hash.hex` | Boolean | No | `true` | `true` produces a hexadecimal digest; `false` produces a Base64 digest. |

**Order of operations:** `prefix + (hash.enabled ? hash(userId) : userId) + suffix`. When hashing is disabled, `prefix`/`suffix` decorate the raw identifier directly.

##### Purging private entries

Purge requests do **not** carry user credentials (they're issued by trusted server-side callers). To purge a private cache entry, the caller sets the header `X-Speedis-Purge-UserID: <raw-user-id>`. Speedis applies the same `idTransformation` pipeline so the regenerated key matches the stored entry. When the header is missing, the purge falls through and returns `404`. See [`cache.purgeToken`](#cache-fields) for the shared-secret that protects this endpoint.

### Backend-For-Frontend (BFF) configuration object

Speedis can apply transformations to incoming requests and outgoing responses at multiple phases of their lifecycle. The architecture follows a Backend-For-Frontend (BFF) pattern: each origin can present its data in shapes optimized for specific clients without changing the upstream server.

> **`no-transform` semantics:** if either the request or the response carries a `Cache-Control: no-transform` directive, Speedis skips every BFF phase **except** `CacheKeyGeneration` and `VariantsTracker` (those two never produce visible mutations on the wire).

| Field | Type | Mandatory | Default | Description |
|-------|------|-----------|---------|-------------|
| `enabled` | Boolean | No | `true` | Enables the BFF module for this origin. When `false`, no transformations are applied even if `transformations` is defined. |
| `actionsLibraries` | Object | No | — | Map of `{ "<libraryId>": "<filesystem path>" }` declaring custom or relocated action libraries. The path is resolved relative to the Node.js process working directory when not absolute. Built-in libraries (`headers`, `json`, `xmlsax`, `xmlxpath`) are auto-registered when referenced and you have not overridden them here. The target file **must** have a `.js` extension and export ES6 functions. |
| `transformations` | [Object] | Yes when `enabled !== false` | — | Ordered list of transformation rules. See below. |

#### Transformations configuration

Speedis allows transformations to be applied to requests and responses it handles at different phases of their lifecycle.

##### How Transformations Are Applied

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

##### Transformation Phases

|Phase|Description|
|-|-|
|`ClientRequest`|Apply transformations to the request received by Speedis from the client.|
|`ClientResponse`|Apply transformations to the response sent by Speedis to the client.|
|`OriginRequest`|Apply transformations to the request sent by Speedis to the origin server.|
|`OriginResponse`|Apply transformations to the response received by Speedis from the origin server.|
|`CacheRequest`|Apply transformations to the cache entry **before** Speedis stores it in Redis. Lets you strip or rewrite fields that should not be persisted (e.g. internal headers).|
|`CacheResponse`|Apply transformations to the cache entry **immediately after** Speedis retrieves it from Redis, before any freshness/validation logic runs.|
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

Speedis includes four built-in action libraries: `headers`, `json`, `xmlsax` and `xmlxpath`. Each one bundles a set of functions you can reference from a transformation via the `uses` field.

For the full catalog — every built-in action, its parameters and its phase compatibility — see [BffActions.md](./BffActions.md). The list of built-in libraries themselves (source files and purpose) is reproduced at the top of that document.

### Variant Tracker

The Variant Tracker observes the responses Speedis sends for selected URLs and counts how many distinct response shapes they produce, computing an MD5 fingerprint of the body for each variant and incrementing a sorted-set counter in Redis (`vary:<cacheKey>`). It also emits a weak `ETag` header (`W/"<fingerprint>"`) on tracked responses. This is useful to spot endpoints that fragment the cache (one entry per call) without you noticing.

> The Variant Tracker reuses Redis to store its counters, so the `redis` block is mandatory whenever this module is enabled.

| Field | Type | Mandatory | Default | Description |
|-------|------|-----------|---------|-------------|
| `enabled` | Boolean | No | `true` | Enables the Variant Tracker for this origin. |
| `urlPatterns` | [String] | Yes when `enabled !== false` | — | Regular expressions; only requests whose URL matches at least one of them are tracked. |

Within a tracked response you can run BFF transformations under the `VariantsTracker` phase to **normalize** the body before fingerprinting (e.g. drop volatile fields). Those transformations don't affect the response sent to the client; they only shape the input to the MD5 hash.

### Cache configuration object

> **Known limitation:** Speedis currently does **not** cache responses that include a `Vary` header. Such responses are forwarded to the client but never stored. Subsequent requests for the same resource will always be forwarded to the origin. Content negotiation based on request headers (`Accept-Encoding`, `Accept-Language`, `User-Agent`, etc.) is therefore not supported by the cache. See [RFC 9111 §4.1](https://www.rfc-editor.org/rfc/rfc9111.html#name-calculating-cache-keys-with) for the spec behavior.

#### Cache fields

| Field | Type | Mandatory | Default | Description |
|-------|------|-----------|---------|-------------|
| `enabled` | Boolean | No | `true` | Enables the cache module. When `false`, every request is proxied (origin still benefits from BFF transformations). |
| `purgePath` | String | No | `"/purge"` | URL path prefix that turns a `DELETE` request into a cache purge. The effective endpoint is `<origin.prefix><purgePath>...` (e.g. with `prefix: "/cache"` and the default, `DELETE /cache/purge/...`). Wildcard `purge/*` flushes every entry stored under the origin's namespace in Redis. |
| `purgeToken` | String | No | — | Shared secret. When set, purge requests must include the header `X-Speedis-Purge-Token: <value>`; otherwise the request is rejected with `401 Unauthorized`. Leaving this field empty leaves the purge endpoint open — only safe when access is restricted upstream (private network, reverse proxy ACL, etc.). |
| `includeOriginIdInCacheKey` | Boolean | No | `true` | When `true`, the origin's `id` becomes the first segment of every cache key. Setting it to `false` makes cache entries shareable across origins that point to the same underlying resource (advanced; you must guarantee global key uniqueness yourself). |
| `defaultCacheSettings` | Object | No | See [defaults](#default-cache-settings-configuration-object) | Default per-URL cache behavior. Merged with each cacheable entry. |
| `localRequestsCoalescing` | Boolean | No | `true` | Within a single Speedis worker, requests for the same key wait for the first in-flight request to complete instead of all hitting the origin. |
| `distributedRequestsCoalescing` | Boolean | No | `false` | Adds a Redis-based distributed lock so coalescing also works across Speedis workers and instances. |
| `distributedRequestsCoalescingOptions` | Object | Yes when `distributedRequestsCoalescing` is `true` | — | Lock TTL and retry settings; see [Lock configuration object](#lock-configuration-object). |
| `cacheables` | [Object] | Yes | — | At least one entry. List of URL patterns considered for caching; see [Cacheable configuration object](#cacheable-configuration-object). |

#### Cache key structure

Cache keys are assembled as a colon-joined string with the following segments (in order, omitting segments that don't apply):

1. `opts.id` (only when `includeOriginIdInCacheKey: true`)
2. `userId` (only when the matched cacheable is `private`; already transformed via `idTransformation`)
3. The HTTP method (so `HEAD` and `GET` get separate entries — see [RFC 9111 §3.4](https://www.rfc-editor.org/rfc/rfc9111.html#name-head))
4. `bodyFingerprint` (only when a `CacheKeyGeneration` BFF action sets it, e.g. for SOAP/GraphQL)
5. The URL path and query string with `/` replaced by `:` (after optionally sorting and stripping query params per `sortQueryParams` / `ignoredQueryParams`)

When the response carries `Vary`, the listed header names and their values are also appended (see [RFC 9111 §4.1](https://www.rfc-editor.org/rfc/rfc9111.html#name-calculating-cache-keys-with)). As noted above, Speedis currently treats `Vary` as a no-cache signal rather than a key extension.

#### Default cache settings configuration object

`defaultCacheSettings` controls the per-URL cache behavior that applies to every cacheable that doesn't override a given field.

**How defaults are resolved:**

- When you **omit** the `defaultCacheSettings` field entirely, AJV (with `useDefaults: true`) injects the full baseline: `{ methods: ["GET", "HEAD", "POST"], private: false, ttl: -1, sortQueryParams: true, ignoredQueryParams: [] }`.
- When you **provide** `defaultCacheSettings`, only the keys you spell out are set; the rest stay `undefined` and inherit from each cacheable's `cacheSettings`.
- **Exception:** `methods` has a runtime safety net. If after merging defaults with a cacheable's overrides `methods` is still missing, Speedis silently falls back to `["GET", "HEAD", "POST"]` so the request-method check never throws.

| Field | Type | Mandatory | Default (when whole block omitted) | Description |
|-------|------|-----------|------------------------------------|-------------|
| `methods` | [String] | No | `["GET", "HEAD", "POST"]` | HTTP methods eligible for caching. Allowed values: `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`, `TRACE`. RFC 9111 §3 permits caching non-safe methods (e.g. `POST` for SOAP/GraphQL) when explicit freshness info is provided. |
| `private` | Boolean | No | `false` | When `true`, the response is cached per authenticated user (requires `origin.authentication`). |
| `ttl` | Integer | No | `-1` | Default Redis TTL **in seconds** for cache entries. `-1` means: use the freshness information derived from HTTP cache headers (`Cache-Control`, `Expires`, etc.). |
| `sortQueryParams` | Boolean | No | `true` | When `true`, query-string parameters are sorted alphabetically before being incorporated into the cache key (turns `?a=1&b=2` and `?b=2&a=1` into the same key). |
| `ignoredQueryParams` | [String] | No | `[]` | Query parameters to strip before building the cache key (typical use-case: marketing/tracking params like `utm_source`, `delay`). |

#### Lock configuration object

Used by `distributedRequestsCoalescing` to coordinate which Speedis instance is responsible for refilling a stale cache entry. The lock follows the [Redlock](https://redis.io/docs/latest/develop/use/patterns/distributed-locks/) pattern.

| Field | Type | Mandatory | Default | Description |
|-------|------|-----------|---------|-------------|
| `lockTTL` | Integer | Yes | — | Time-to-live for the lock in **milliseconds**. If the holder doesn't release it, Redis evicts it automatically when the TTL expires (so a worker that crashes mid-refresh doesn't deadlock the cache). |
| `retryCount` | Integer | Yes | — | How many times other workers retry to acquire the lock before giving up with HTTP `503 CACHE_NO_LOCK`. |
| `retryDelay` | Integer | Yes | — | Base wait between retries in milliseconds. |
| `retryJitter` | Integer | Yes | — | Random jitter (`0..retryJitter` ms) added to each `retryDelay` to spread contention. |

#### Cacheable configuration object

Each entry in `cacheables` matches a subset of URLs and (optionally) overrides the default cache behavior.

| Field | Type | Mandatory | Default | Description |
|-------|------|-----------|---------|-------------|
| `urlPattern` | String | Yes | — | Regular expression compiled with `new RegExp(...)` and tested against the request's raw URL (including query string). The first matching entry wins; order is preserved from the JSON array. |
| `cacheSettings` | Object | No | Inherits from `defaultCacheSettings` | Override cache behavior for this URL pattern. Fields not provided are inherited (see [Cache settings object](#cache-settings-object)). |

The schema rejects any other property and requires at least one entry in the array.

#### Cache settings object

This object is used **both** as `cache.defaultCacheSettings` and inside each `cacheable.cacheSettings`. When used inside a cacheable, fields not provided are inherited from `defaultCacheSettings` (using object spread, so the cacheable wins on overlap).

| Field | Type | Mandatory | Default | Description |
|-------|------|-----------|---------|-------------|
| `methods` | [String] | No | Inherits from `defaultCacheSettings.methods` | HTTP methods eligible for caching on this URL pattern. Useful, for example, to enable caching of `POST` requests for SOAP or GraphQL endpoints. |
| `private` | Boolean | No | Inherits / `false` | When `true`, response is cached per authenticated user (forces `origin.authentication` to be enabled — enforced at validation time). |
| `ttl` | Integer | No | Inherits / `-1` | Redis TTL **in seconds**. `-1` derives the TTL from HTTP cache headers. |
| `sortQueryParams` | Boolean | No | Inherits / `true` | Sort query-string parameters alphabetically when building the cache key. |
| `ignoredQueryParams` | [String] | No | Inherits / `[]` | Query parameters to strip before building the cache key. |

### Redis configuration object

Configures the Redis connection used by the cache, the distributed coalescing lock and the Variant Tracker counters. Internally Speedis uses [`node-redis`](https://github.com/redis/node-redis) with RESP3 (`unstableResp3: true`) to enable JSON commands. The block is **mandatory** whenever either `cache` or `variantsTracker` is enabled.

| Field | Type | Mandatory | Default | Description |
|-------|------|-----------|---------|-------------|
| `redisOptions` | Object | Yes | — | Passed verbatim to `createClient(...)` (after Speedis layers `RESP: 3` and `unstableResp3: true` on top). Use the same shape documented in [node-redis client-configuration](https://github.com/redis/node-redis/blob/master/docs/client-configuration.md). The simplest form is `{ "url": "redis://host:6379" }`. Function-valued options (custom socket factory, reconnect strategy, etc.) are not supported because the config is JSON. |
| `redisTimeout` | Integer | No | — | Maximum time **in milliseconds** allowed for a single Redis command. Implemented via `client.withAbortSignal(...)` (sync timeouts wrapped through a Proxy), so it covers every command including `scanIterator.next()`. |
| `redisBreaker` | Boolean | No | `false` | Enables an Opossum circuit breaker around Redis commands. When the breaker is open Speedis short-circuits all Redis access and either falls back to the origin or responds with `503 CACHE_REDIS_OUTAGE` depending on `disableOriginOnRedisOutage`. |
| `redisBreakerOptions` | Object | Yes when `redisBreaker` is `true` | — | Tuning options; see [Circuit-breaker options](#circuit-breaker-options). Speedis automatically sets the breaker `name` (`redis-<origin.id>`) and forces `cache: false`/`coalesce: false` so they don't conflict with Speedis's own implementations. |
| `disableOriginOnRedisOutage` | Boolean | No | `false` | When `true` and the Redis breaker is open, Speedis refuses to fall through to the origin and returns `503` with `x-speedis-cache-status: CACHE_REDIS_OUTAGE` instead. Use this if the origin cannot absorb the full load without the cache. |

### CORS configuration object

Speedis supports [Cross-Origin Resource Sharing (CORS)](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS) via the official [`@fastify/cors`](https://github.com/fastify/fastify-cors) plugin.

CORS is configured **per origin** in the `cors` property of each origin configuration file. If an origin does not define a `cors` object, no CORS headers are added to its responses — `@fastify/cors` is not registered for that origin at all.

> **Important:** Only JSON-serializable values are supported (booleans, strings, numbers, and arrays). Function-based dynamic `origin` callbacks available in `@fastify/cors` are not supported through configuration.

#### CORS configuration fields

The following table describes all supported fields of the per-origin `cors` object. Defaults marked as *(from `@fastify/cors`)* are not injected by Speedis; they apply only when the field is omitted and `@fastify/cors` is registered. Defaults marked as *(Speedis)* are populated by AJV from the origin schema.

| Field | Type | Mandatory | Default | Description |
|-------|------|-----------|---------|-------------|
| `enabled` | Boolean | No | `true` *(Speedis)* | Enables CORS for this origin. When `false`, `@fastify/cors` is not registered even if a `cors` object is present. This field is Speedis-specific and is stripped before forwarding the rest of the object to `@fastify/cors`. |
| `origin` | Boolean \| String \| [String] | No | `false` *(Speedis schema default)* | Controls which origins are allowed. `true` reflects the request `Origin` back. `false` disables CORS. A string or array of strings restricts access to specific origins (an array enables real server-side enforcement, see [Behaviors](#important-behaviors) below). |
| `methods` | [String] | No | `['GET','HEAD','PUT','PATCH','POST','DELETE']` *(from `@fastify/cors`)* | HTTP methods permitted for cross-origin requests. Populates `Access-Control-Allow-Methods`. Allowed values are constrained by the schema to `GET`, `HEAD`, `PUT`, `PATCH`, `POST`, `DELETE`, `OPTIONS`. |
| `allowedHeaders` | [String] | No | Reflects `Access-Control-Request-Headers` *(from `@fastify/cors`)* | Request headers that browsers are allowed to send. Populates `Access-Control-Allow-Headers`. |
| `exposedHeaders` | [String] | No | — | Response headers that browsers are permitted to read beyond the [CORS-safelisted set](https://developer.mozilla.org/en-US/docs/Glossary/CORS-safelisted_response_header). Populates `Access-Control-Expose-Headers`. |
| `credentials` | Boolean | No | `false` | When `true`, the `Access-Control-Allow-Credentials: true` header is sent. Requires `origin` to be a specific value (not `true`). |
| `maxAge` | Integer | No | — | Duration in **seconds** the browser may cache a preflight response. Populates `Access-Control-Max-Age`. |
| `preflightContinue` | Boolean | No | `false` *(from `@fastify/cors`)* | If `true`, the preflight response is passed to the next handler instead of being sent immediately. |
| `optionsSuccessStatus` | Integer | No | `204` *(from `@fastify/cors`)* | HTTP status code returned for successful preflight responses. Allowed values by the schema: `200`, `204`. Use `200` for compatibility with legacy browsers. |
| `preflight` | Boolean | No | `true` *(from `@fastify/cors`)* | If `false`, the automatic `OPTIONS *` preflight route is not added. Useful when the upstream origin already handles CORS preflight. |
| `strictPreflight` | Boolean | No | `true` *(from `@fastify/cors`)* | If `true`, preflight requests missing an `Origin` or `Access-Control-Request-Method` header receive a `400 Bad Request` response. |
| `hideOptionsRoute` | Boolean | No | `true` *(from `@fastify/cors`)* | If `true`, the OPTIONS preflight route is hidden from API schema generation tools (e.g., Swagger). |

#### Important behaviors

##### 1. No `cors` object → no CORS headers

If an origin configuration does not define a `cors` object, Speedis does not register `@fastify/cors` for that origin and no `Access-Control-*` headers are added to any response. This is the default behavior and is the right choice for internal or backend-only origins that should never be exposed to browsers.

The same effect can be achieved explicitly by setting `enabled: false`:

```json
{ "cors": { "enabled": false } }
```

##### 2. `origin` string vs array — browser enforcement vs server enforcement

This is the most important behavioral difference between the two accepted types for `origin`:

| `origin` type | Who enforces the restriction | How |
|---|---|---|
| `true` | Browser | `Access-Control-Allow-Origin` reflects the request `Origin` back |
| String (e.g. `"https://app.example.com"`) | **Browser only** | The header is always set to the configured string, regardless of the actual request `Origin` |
| Array (e.g. `["https://a.com", "https://b.com"]`) | **Server + browser** | The header is only set when the request `Origin` is in the list; otherwise no header is sent |

With a **string** origin, Speedis (via `@fastify/cors`) always responds with `Access-Control-Allow-Origin: <configured-value>`. If a request comes from a different origin, the browser sees that the header value doesn't match and blocks the response — but the response was still sent by the server. Non-browser clients (e.g. `curl`, server-to-server) are unaffected.

With an **array** origin, `@fastify/cors` compares the request `Origin` against the list server-side. Only matching origins receive the `Access-Control-Allow-Origin` header; all others receive no CORS header at all.

**Recommendation:** Prefer an array over a string when you need to restrict access to one or more specific origins and want server-side enforcement.

##### 3. Preflight OPTIONS and Speedis's catch-all route

Speedis registers a `server.all('/*', ...)` route that proxies every HTTP method — including `OPTIONS` — to the upstream origin. When CORS is enabled, `@fastify/cors` is registered **before** this route inside each plugin scope and adds its own `OPTIONS *` preflight handler. Because of Fastify's route registration order, the CORS preflight handler takes priority over the proxy catch-all for `OPTIONS` requests that carry the required CORS headers (`Origin` + `Access-Control-Request-Method`).

Consequently:
- **CORS preflight `OPTIONS` requests** are handled directly by Speedis and never forwarded to the upstream origin.
- **Non-preflight `OPTIONS` requests** (i.e., without `Access-Control-Request-Method`) fall through to the proxy as normal.

If your upstream origin already implements its own CORS handling and you want Speedis to forward all `OPTIONS` requests instead of intercepting them, set `"preflight": false`. In this case, Speedis still adds the `Access-Control-Allow-Origin` (and related) headers to every response via hooks, but the preflight route is not registered.

#### Configuration examples

All examples below are placed in a per-origin configuration file (e.g. `conf/origins/<origin>.json`).

##### Example 1 — Permissive CORS (all origins, specific methods)

```json
{
  "cors": {
    "origin": true,
    "methods": ["GET", "HEAD", "OPTIONS"]
  }
}
```
This allows any browser origin to make `GET`, `HEAD`, and `OPTIONS` requests to this origin.

##### Example 2 — Restrict to a single domain, allow credentials

```json
{
  "cors": {
    "origin": "https://app.example.com",
    "credentials": true,
    "maxAge": 600
  }
}
```

##### Example 3 — Multiple allowed domains as a list

```json
{
  "cors": {
    "origin": ["https://app.example.com", "https://admin.example.com"],
    "methods": ["GET", "POST", "DELETE"],
    "exposedHeaders": ["X-Speedis-Cache-Status"]
  }
}
```

##### Example 4 — Explicitly disable CORS

```json
{
  "cors": {
    "enabled": false
  }
}
```
Equivalent to omitting the `cors` object entirely. Useful as an explicit marker for internal or backend-only origins.
