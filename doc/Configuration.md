# Speedis main configuration
The optional file ./conf/speedis.conf contains a JSON object with the general configuration of the Speedis server.
The following table describes the supported fields.
|Field|Type|Mandatory|Default|Description|
|-----|----|---------|-------|-----------|
|`maxNumberOfWorkers`|Number|`false`|[os.availableParallelism()](https://nodejs.org/api/os.html#osavailableparallelism)|This parameters limits the number of workers.|
|`port`|Number|`false`|3001|The port on which the main service is running.|
|`logLevel`|String|`false`|`info`|Logging level for the main service (`trace`, `debug`, `info`, `warn`, `error`, `fatal`).|
|`metricServerPort`|Number|`false`|3003|The port on which the metrics service is running.|
|`metricServerLogLevel`|String|`false`|`info`|Logging level for the metric service (`trace`, `debug`, `info`, `warn`, `error`, `fatal`).|

# Origins configurations
In Speedis, each remote server is referred to as an `origin`.
The configuration of Speedis’ behavior for each origin is defined in a configuration file which contains a JSON object and is located in ./conf/origin/.
During initialization, Speedis will load all configuration files located in that folder.
The following table describes the supported fields.
|Field|Type|Mandatory|Default|Description|
|-----|----|---------|-------|-----------|
|`id`|String|`true`||Origin’s ID|
|`prefix`|String|`true`||URL path prefix used to route incoming requests to this origin.|
|`logLevel`|String|`false`|`info`|Logging level for this origin (`trace`, `debug`, `info`, `warn`, `error`, `fatal`).|
|`exposeErrors`|Boolean|`false`|`false`|This parameter determines whether descriptive error messages are included in the response body (`true` or `false`).|
|`origin`|Object|true||This object defines all the details related to the origin server management. Its format is detailed below.|
|`bff`|Object|false||This object defines all the details related to the Backend-For-Frontend (BFF) management. Its format is detailed below.|
|`cache`|Object|false||This object defines all the details related to the cache management. Its format is detailed below.|
|`oauth2`|Object|false||This object defines all the details related to the OAuth2-based Access Control. Its format is detailed below.|
|`redis`|Object|`true` if cache of oauth2 is enabled||This object defines all the details related to the redis database. Its format is detailed below.|

## Origin configuration object
The following table describes the supported fields in the origin configuration object.
|Field|Type|Mandatory|Default|Description|
|-----|----|---------|-------|-----------|
|`httpxOptions`|Object|`true`||Speedis leverages Node’s native [http](https://nodejs.org/api/http.html)/[https](https://nodejs.org/api/https.html) libraries to make requests to the origin server. This field is used to define the request options. Its format is almost identical to the original [options](https://nodejs.org/api/http.html#httprequestoptions-callback). The main difference is that, since the configuration is in JSON format, parameters defined as JavaScript entities in the original options are not supported. Options in socket.connect() are not supported.|
|`agentOptions`|Object|`false`||Speedis allows to use an [Agent](https://nodejs.org/api/https.html#class-httpsagent) to manage connection persistence and reuse for HTTP clients. This field is used to configure the agent. Its format is identical to the original [https options](https://nodejs.org/api/https.html#class-httpsagent) or [http options](https://nodejs.org/api/http.html#new-agentoptions).|
|`originTimeout`|Number|`false`||Specifies the maximum time allowed for retrieving the resource from the origin server before the request is considered a failure.|
|`originBreaker`|Boolean|`false`|`false`|Enables (`true`) or disables (`false`) the origin's circuit breaker mechanism.|
|`originBreakerOptions`|Object|`true` if originBreaker is enabled||Speedis leverages [Opossum](https://nodeshift.dev/opossum/) to implement the circuit breaker mechanism. This field is used to define the circuit braker options. Its format is almost identical to the original [options](https://nodeshift.dev/opossum/#circuitbreaker). The main difference is that, since the configuration is in JSON format, parameters defined as JavaScript entities in the original options are not supported. Additionally, options related to caching and coalescing features are also not supported.|

## Backend-For-Frontend (BFF) configuration object
Speedis can apply various transformations to incoming requests and outgoing responses throughout their lifecycle.
These transformations are designed to adapt the data and behavior of the origin server to meet the specific needs of different clients.
The architecture follows a Backend For Frontend (BFF) pattern, allowing for client-specific optimizations.
The following table describes the supported fields in the Backend-For-Frontend configuration object.
|Field|Type|Mandatory|Default|Description|
|-----|----|---------|-------|-----------|
|`actionsLibraries`|Object|`false`||An array containing the full paths to custom action libraries that extend the default set provided out of the box.|
|`transformations`|[Object]|`false`||Array of objects that define the set of transformations that Speedis can apply to requests and responses at different stages. Its format is detailed below.|

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

## Cache configuration object
The following table describes the supported fields in the cache configuration object.
|Field|Type|Mandatory|Default|Description|
|-----|----|---------|-------|-----------|
|`purgePath`|String|`false`|`/purge`|URL path prefix used to trigger cache purge requests. Any DELETE request whose path starts with this prefix will be interpreted as a cache purge operation.|
|`cacheableUrlPatterns`|[String]|`true`||List of URL patterns that are considered cacheable. Only request with method GET can be cached.|
|`includeOriginIdInCacheKey`|Boolean|`false`|`true`|This field determines whether the id of the origin is used to generate the cache key for the entry (`true` or `false`).|
|`ignoredQueryParams`|[String]|`false`||The cache key is generated based on the URL requested from the origin. This field defines a list of query string parameters that will be ignored when forming the cache key for the entry.|
|`sortQueryParams`|Boolean|`false`|`false`|The cache key is generated based on the URL requested from the origin. This field determines whether the query string parameters should be sorted alphabetically before being used to generate the cache key for the entry (`true` or `false`). |
|`localRequestsCoalescing`|Boolean|`false`|`true`|Enables (`true`) or disables (`false`) the request coalescing mechanism.|
|`distributedRequestsCoalescing`|Boolean|`false`|`false`|Enables (`true`) or disables (`false`) the request coalescing functionality across multiple instances.|
|`distributedRequestsCoalescingOptions`|Object|`true` if distributedRequestsCoalescing is enabled||Configure the distributed lock mechanism used to implements the requests coalescing functionality across multiple instances. Its format is detailed below.|

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
|`redirectPath`|String|`false`|`/login`|Indicates the final part of the URL of the client that the User-Agent will use to redirect the Resource Owner to the Authentication endpoint of the Authorization Server, initiating the OAuth2 authentication flow.|
|`callbackPath`|String|`false`|`/callback`|Indicates the final part of the client’s URL where the authorization server redirects the User-Agent back to the client after completing the OAuth2 authentication flow.|
|`logoutPath`|String|`false`|`/logout`|Indicates the final part of the client’s URL that will handle logout requests initiated by the Authorization Server.|
|`clientId`|String|`true`||The client identifier issued to the client during the registration process|
|`clientSecret`|String|`true`||The client secret.|
|`discoverySupported`|Boolean|`true`||If `true`, this indicates that the Authorization Server exposes a metadata document, allowing the client to automatically retrieve endpoint URLs and other configuration details. If `false`, all necessary endpoints and settings must be provided manually.|
|`authorizationServerMetadataLocation`|String|`true` if discoverySupported is `true`||Specifies the absolute URL to the Authorization Server’s metadata JSON document|
|`authorizationServerMetadata`|Object|`true` if discoverySupported is `false`||An object that defines all the necessary endpoint URLs and configuration parameters of the Authorization Server. Its format is defined in [ServerMetadata](https://github.com/panva/openid-client/blob/main/docs/interfaces/ServerMetadata.md). For further details, refer to [RFC 8414](https://www.rfc-editor.org/rfc/rfc8414.html#section-2). Speedis specifically requires the issuer, authorization_endpoint, token_endpoint and jwks_uri.|
|`authorizationRequest`|Object|false||Allows the definition of values for the parameters that will be included in the query component of the authorization endpoint URI, used in the client’s [request to the Authorization Server](https://www.rfc-editor.org/rfc/rfc6749#section-4.1.1) during the OAuth2 authorization flow.|
|`pkceEnabled`|Boolean|`false`|`false`|Indicates whether PKCE (Proof Key for Code Exchange) is enabled. Although the client is considered Confidential, enabling PKCE provides an additional layer of security during the token exchange process.|
|`authorizationCodeTtl`|Number|`false`|`300`|Defines the time-to-live (TTL) for the authorization code, indicating how long the code remains valid before it expires. This value is typically set to a short duration (e.g., 5-10 minutes) to ensure that the code is used promptly after issuance.|
|`sessionIdCookieName`|String|`false`|`speedis_token_id`|Specifies the name of the cookie that the client uses to communicate the value of the ID token to the User-Agent.|
|`postAuthRedirectUrl`|String|`true`||Specifies the URL to which the user will be redirected after successful authentication and the establishment of the authentication cookie. This page is typically a landing page or the main entry point to the application, ensuring that the user is directed to the appropriate location after login.|

## Redis configuration object
The following table describes the supported fields in the redis configuration object.
|Field|Type|Mandatory|Default|Description|
|-----|----|---------|-------|-----------|
|`redisOptions`|Object|`true`||Speedis uses [node-redis](https://github.com/redis/node-redis) to connect to the Redis database where the cached contents are stored. This object defines the connection details. Its format is almost identical to the [createClient configuration](https://github.com/redis/node-redis/blob/master/docs/client-configuration.md). The main difference is that, since the configuration is in JSON format, parameters defined as JavaScript entities in the original client configuration are not supported.|
|`redisTimeout`|Number|`false`||Specifies the maximum time allowed for executing a command on the Redis server before it is considered a failure.|
|`redisBreaker`|Boolean|`false`|`false`|Enables (`true`) or disables (`false`) the redis's circuit breaker mechanism.|
|`redisBreakerOptions`|Object|`true` if redisBreaker is enabled||Speedis leverages [Opossum](https://nodeshift.dev/opossum/) to implement the circuit breaker mechanism. This field is used to define the circuit braker options. Its format is almost identical to the original [options](https://nodeshift.dev/opossum/#circuitbreaker). The main difference is that, since the configuration is in JSON format, parameters defined as JavaScript entities in the original options are not supported. Additionally, options related to caching and coalescing features are also not supported.
|`disableOriginOnRedisOutage`|Boolean|`false`|`false`|When set to `true` Speedis will not forward requests to the origin server if Redis becomes unavailable.|



