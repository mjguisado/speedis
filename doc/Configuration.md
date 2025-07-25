# Speedis main configuration
The optional file ./conf/speedis.conf contains a JSON object with the general configuration of the Speedis server.
In Speedis, each remote server is referred to as an `origin`.
The behavior of Speedis for each origin is defined using a JSON configuration object.
These configurations can be stored either as files in a folder or in a Redis database.
During initialization, Speedis will load all available configurations.
In the Speedis configuration, you must set either the `localOriginsConfigs` or `remoteOriginsConfigs` parameter.
The following table describes the supported fields.

|Field|Type|Mandatory|Default|Description|
|-----|----|---------|-------|-----------|
|`maxNumberOfWorkers`|Number|`false`|[os.availableParallelism()](https://nodejs.org/api/os.html#osavailableparallelism)|This parameters limits the number of workers.|
|`port`|Number|`false`|3001|The port on which the main service is running.|
|`logLevel`|String|`false`|`info`|Logging level for the main service (`trace`, `debug`, `info`, `warn`, `error`, `fatal`).|
|`metricServerPort`|Number|`false`|3003|The port on which the metrics service is running.|
|`metricServerLogLevel`|String|`false`|`info`|Logging level for the metric service (`trace`, `debug`, `info`, `warn`, `error`, `fatal`).|
|`localOriginsConfigs`|String|`false`||Disk location of the origin configuration files. It can be either an absolute or a relative path. If a relative path is provided, Speedis will resolve it to an absolute path using the current working directory.|
|`remoteOriginsConfigs`|[Object]|`false`||Redis database where the origin configuration objects are stored. Speedis connects to this database to retrieve the configurations during initialization.|

## Remote Origin Configs object
The following table describes the supported fields in the remote origin configs object.
|Field|Type|Mandatory|Default|Description|
|-----|----|---------|-------|-----------|
|`redisOptions`|Object|`true`||Speedis uses [node-redis](https://github.com/redis/node-redis) to connect to the Redis database where the cached contents are stored. This object defines the connection details. Its format is almost identical to the [createClient configuration](https://github.com/redis/node-redis/blob/master/docs/client-configuration.md). The main difference is that, since the configuration is in JSON format, parameters defined as JavaScript entities in the original client configuration are not supported.|
|`originsConfigsKeys`|[String]|`true`||List of Redis keys that store origin configurations.|


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
|`variantsTracker`|Object|`false`||This object defines all the details related to the variant tracker. Its format is detailed below.|
|`cache`|Object|`false`||This object defines all the details related to the cache. Its format is detailed below.|
|`oauth2`|Object|`false`||This object defines all the details related to the OAuth2-based Access Control. Its format is detailed below.|
|`redis`|Object|`true` if cache of oauth2 is enabled||This object defines all the details related to the redis database. Its format is detailed below.|

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

## Backend-For-Frontend (BFF) configuration object
Speedis can apply various transformations to incoming requests and outgoing responses throughout their lifecycle.
These transformations are designed to adapt the data and behavior of the origin server to meet the specific needs of different clients.
The architecture follows a Backend For Frontend (BFF) pattern, allowing for client-specific optimizations.
The following table describes the supported fields in the Backend-For-Frontend configuration object.
|Field|Type|Mandatory|Default|Description|
|-----|----|---------|-------|-----------|
|`actionsLibraries`|Object|`false`||An array containing the full paths to custom action libraries that extend the default set provided out of the box.|
|`transformations`|[Object]|`true`||Array of objects that define the set of transformations that Speedis can apply to requests and responses at different stages. Its format is detailed below.|

### Transformations configuration
Speedis allows transformations to be applied to requests and responses it handles at different phases of their lifecycle.
|Phase|Description|
|-|-|
|`ClientRequest`|Apply transformations to the request received by Speedis from the client.|
|`ClientResponse`|Apply transformations to the response sent by Speedis to the client.|
|`OriginRequest`|Apply transformations to the request sent by Speedis to the origin server.|
|`OriginResponse`|Apply transformations to the response received by Speedis from the origin server.|
|`CacheRequest`|Apply transformations to the request sent by Speedis to the cache (Redis).|
|`CacheResponse`|Apply transformations to the response received by Speedis from the cache (Redis).|
|`VariantsTracker`|Apply transformations to the response before calculating its fingerprinting. Theses transformations don't affect to the response sent to the client.|

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

Speedis includes out of the box two libreries
|Library ID|Location|Description|
|----------|--------|-----------|
|headers|[./src/actions/headers.js](../src/actions/headers.js)|Actions to manipulate headers|
|json|[./src/actions/json.js](../src/actions/json.js)|Actions to manipulate the body in JSON format|

## Variant Tracker
The following table describes the supported fields in the variant tracker configuration object.
|Field|Type|Mandatory|Default|Description|
|-----|----|---------|-------|-----------|
|`urlPatterns`|[String]|`true`||List of URL patterns to track along with their variants.|

## Cache configuration object
The following table describes the supported fields in the cache configuration object.
|Field|Type|Mandatory|Default|Description|
|-----|----|---------|-------|-----------|
|`purgePath`|String|`false`|`/purge`|URL path prefix used to trigger cache purge requests. Any DELETE request whose path starts with this prefix will be interpreted as a cache purge operation.|
|`cacheables`|[Object]|`true`||List of URL patterns that are considered cacheable. Only request with method GET can be cached. Its format is detailed below.|
|`includeOriginIdInUrlKey`|Boolean|`false`|`true`|This field determines whether the id of the origin is used to generate the url key for the entry (`true` or `false`).|
|`ignoredQueryParams`|[String]|`false`||The url key is generated based on the URL requested from the origin. This field defines a list of query string parameters that will be ignored when forming the cache key for the entry.|
|`sortQueryParams`|Boolean|`false`|`true`|The url key is generated based on the URL requested from the origin. This field determines whether the query string parameters should be sorted alphabetically before being used to generate the cache key for the entry (`true` or `false`). |
|`localRequestsCoalescing`|Boolean|`false`|`true`|Enables (`true`) or disables (`false`) the request coalescing mechanism.|
|`distributedRequestsCoalescing`|Boolean|`false`|`false`|Enables (`true`) or disables (`false`) the request coalescing functionality across multiple instances.|
|`distributedRequestsCoalescingOptions`|Object|`true` if distributedRequestsCoalescing is `true`||Configure the distributed lock mechanism used to implements the requests coalescing functionality across multiple instances. Its format is detailed below.|

## Cacheable configuration object
The following table describes the supported fields in the cacheable configuration object.
|Field|Type|Mandatory|Default|Description|
|-----|----|---------|-------|-----------|
|`urlPattern`|String|`true`||URL patterns that are considered cacheable.|
|`perUser`|Boolean|`false`|`false`|Indicates whether the response for a given URL should be cached separately for each authenticated user.|
|`ttl`|Number|`false`|`Infinity`|This parameter defines how long the response will be stored in the cache.|

### Lock configuration object
The following table describes the supported fields in the lock configuration object.
|Field|Type|Mandatory|Default|Description|
|-----|----|---------|-------|-----------|
|`lockTTL`|Number|`true`||(Time-to-Live for the lock): Specifies the duration (in milliseconds) for which the lock remains valid before automatically expiring. If the lock is not explicitly released within this period, it will be removed.|
|`retryCount`|Number|`true`||(Number of retry attempts): Defines the maximum number of times the system will attempt to acquire the lock if the initial attempt fails.|
|`retryDelay`|Number|`true`||(Base delay between retries): Sets the waiting time (in milliseconds) between consecutive lock acquisition attempts. This helps prevent excessive contention when multiple processes try to acquire the same lock.|
|`retryJitter`|Number|`true`||(Randomized delay variation): Introduces a random variation (in milliseconds) to the retry delay to reduce the likelihood of multiple processes retrying at the same time, which can help prevent contention spikes.|

## OAuth2-based Access Control
The following table describes the supported fields in the OAuth2-based Access Control configuration object.
|Field|Type|Mandatory|Default|Description|
|-----|----|---------|-------|-----------|
|`id`|String|`true`||Lorem ipsum dolor sit amet|
|`prefix`|String|`false`|`/oauth2`|URL path prefix used to route incoming requests to the OAuth2 plugin.|
|`logLevel`|String|`false`|`info`|Logging level for the OAuth2 (`trace`, `debug`, `info`, `warn`, `error`, `fatal`).|
|`baseUrl`|String|`true`||Since Speedis can serve multiple domains, this variable is used to specify the domain currently in use for yhe current origin.|
|`clientId`|String|`true`||The client identifier issued to the client during the registration process|
|`clientSecret`|String|`true`||The client secret.|
|`discoverySupported`|Boolean|`true`||If `true`, this indicates that the Authorization Server exposes a metadata document, allowing the client to automatically retrieve endpoint URLs and other configuration details. If `false`, all necessary endpoints and settings must be provided manually.|
|`authorizationServerMetadataLocation`|String|`true` if discoverySupported is `true`||Specifies the absolute URL to the Authorization Server’s metadata JSON document|
|`authorizationServerMetadata`|Object|`true` if discoverySupported is `false`||An object that defines all the necessary endpoint URLs and configuration parameters of the Authorization Server. Its format is defined in [ServerMetadata](https://github.com/panva/openid-client/blob/main/docs/interfaces/ServerMetadata.md). For further details, refer to [RFC 8414](https://www.rfc-editor.org/rfc/rfc8414.html#section-2). Speedis specifically requires the issuer, authorization_endpoint, token_endpoint and jwks_uri.|
|`authorizationRequest`|Object|`false`|{}|Allows the definition of values for the parameters that will be included in the query component of the authorization endpoint URI, used in the client’s [request to the Authorization Server](https://www.rfc-editor.org/rfc/rfc6749#section-4.1.1) during the OAuth2 authorization flow.|
|`pkceEnabled`|Boolean|`false`|`false`|Indicates whether PKCE (Proof Key for Code Exchange) is enabled. Although the client is considered Confidential, enabling PKCE provides an additional layer of security during the token exchange process.|
|`authorizationCodeTtl`|Number|`false`|`300`|Defines the time-to-live (TTL) for the authorization code, indicating how long the code remains valid before it expires. This value is typically set to a short duration (e.g., 5-10 minutes) to ensure that the code is used promptly after issuance.|
|`sessionIdCookieName`|String|`false`|`speedis_session`|Specifies the name of the cookie that the client uses to communicate the value of the ID token to the User-Agent.|
|`postAuthRedirectUri`|String|`true`||Specifies the URL to which the user will be redirected after successfully completing the authentication flow with the authorization server and the establishment of the authentication cookie. This page is typically a landing page or the main entry point to the application, ensuring that the user is directed to the appropriate location after login.|
|`logoutRequest`|Object|`false`|{}|Allows the definition of values for the parameters that will be included in the query component of the [OpenID Provider's Logout Endpoint](https://openid.net/specs/openid-connect-rpinitiated-1_0.html).|
|`postLogoutRedirectUri`|String|`false`||Specifies the URL to which the user will be redirected after successfully completing the logout flow with the OpenID Provider. This page is typically a landing page or the main entry point to the application, ensuring that the user is directed to the appropriate location after logout.|

## Redis configuration object
The following table describes the supported fields in the redis configuration object.
|Field|Type|Mandatory|Default|Description|
|-----|----|---------|-------|-----------|
|`redisOptions`|Object|`true`||Speedis uses [node-redis](https://github.com/redis/node-redis) to connect to the Redis database where the cached contents are stored. This object defines the connection details. Its format is almost identical to the [createClient configuration](https://github.com/redis/node-redis/blob/master/docs/client-configuration.md). The main difference is that, since the configuration is in JSON format, parameters defined as JavaScript entities in the original client configuration are not supported.|
|`redisTimeout`|Number|`false`||Specifies the maximum time allowed for executing a command on the Redis server before it is considered a failure.|
|`redisBreaker`|Boolean|`false`|`false`|Enables (`true`) or disables (`false`) the redis's circuit breaker mechanism.|
|`redisBreakerOptions`|Object|`true` if redisBreaker is enabled||Speedis leverages [Opossum](https://nodeshift.dev/opossum/) to implement the circuit breaker mechanism. This field is used to define the circuit braker options. Its format is almost identical to the original [options](https://nodeshift.dev/opossum/#circuitbreaker). The main difference is that, since the configuration is in JSON format, parameters defined as JavaScript entities in the original options are not supported. Additionally, options related to caching and coalescing features are also not supported.
|`disableOriginOnRedisOutage`|Boolean|`false`|`false`|When set to `true` Speedis will not forward requests to the origin server if Redis becomes unavailable.|
