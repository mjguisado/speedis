# Speedis main configuration
The file ./conf/speedis.conf contains a JSON object with the general configuration of the Speedis server.
The following table describes the supported fields.

|Field|Type|Mandatory|Default|Description|
|-----|----|---------|-------|-----------|
|`maxNumberOfWorkers`|Number|`false`|[os.availableParallelism()](https://nodejs.org/api/os.html#osavailableparallelism)|This parameters limits the number of workers.|
|`port`|Number|`false`|3001|The port on which the main service is running.|
|`logLevel`|String|`false`|`info`|Logging level for the main service (`trace`, `debug`, `info`, `warn`, `error`, `fatal`).|
|`metricServerPort`|Number|`false`|3003|The port on which the metrics service is running.|
|`metricServerLogLevel`|String|`false`|`info`|Logging level for the metric service (`trace`, `debug`, `info`, `warn`, `error`, `fatal`).|

# Origins configurations
In Speedis, the remote server to be cached is referred to as an `origin`.
The configuration of Speedis’ behavior for each origin is defined in a configuration file which contains a JSON object and is located in ./conf/origin/.
During initialization, Speedis will load all configuration files located in that folder.
The following table describes the supported fields.
|Field|Type|Mandatory|Default|Description|
|-----|----|---------|-------|-----------|
|`id`|String|`true`||Origin’s ID|
|`prefix`|String|`true`||URL path prefix used to route incoming requests to this origin.|
|`logLevel`|String|`true`|`info`|Logging level for this origin (`trace`, `debug`, `info`, `warn`, `error`, `fatal`).|
|`exposeErrors`|Boolean|`false`|`false`|This parameter determines whether descriptive error messages are included in the response body (`true` or `false`).|
|`redis`|Object|`true`||Speedis uses [node-redis](https://github.com/redis/node-redis) to connect to the Redis database where the cached contents are stored. This object defines the connection details. Its format is almost identical to the [createClient configuration](https://github.com/redis/node-redis/blob/master/docs/client-configuration.md). The main difference is that, since the configuration is in JSON format, parameters defined as JavaScript entities in the original client configuration are not supported.|
|origin|Object|true||This object defines all the details related to the origin management. Its format is detailed below.|

## Origin configuration object
The following table describes the supported fields in the origin configuration object.
|Field|Type|Mandatory|Default|Description|
|-----|----|---------|-------|-----------|
|`httpxOptions`|Object|`true`||Speedis leverages Node’s native [http](https://nodejs.org/api/http.html)/[https](https://nodejs.org/api/https.html) libraries to make requests to the origin server. This field is used to define the request options. Its format is almost identical to the original [options](https://nodejs.org/api/http.html#httprequestoptions-callback). The main difference is that, since the configuration is in JSON format, parameters defined as JavaScript entities in the original options are not supported.|
|`agentOptions`|Object|`false`||Speedis allows to use an [Agent](https://nodejs.org/api/https.html#class-httpsagent) to manage connection persistence and reuse for HTTP clients. This field is used to configure the agent. Its format is identical to the original [https options](https://nodejs.org/api/https.html#class-httpsagent) or [http options](https://nodejs.org/api/http.html#new-agentoptions).|
|`fetchTimeout`|Number|`false`||Specifies the maximum time allowed for retrieving the resource from the origin server before the request is considered a failure.|
|`ignoredQueryParams`|[String]|`false`||The cache key is generated based on the URL requested from the origin. This field defines a list of query string parameters that will be ignored when forming the cache key for the entry.|
|`sortQueryParams`|Boolean|`false`|`false`|The cache key is generated based on the URL requested from the origin. This field determines whether the query string parameters should be sorted alphabetically before being used to generate the cache key for the entry (`true` or `false`). |
|`requestCoalescing`|Boolean|`false`|`false`|Enables (`true`) or disables (`false`) the request coalescing mechanism.|
|`lock`|Boolean|`false`|`true`|Enables (`true`) or disables (`false`) the request coalescing functionality across multiple instances.|
|`lockOptions`|Object|`true` if lock is enabled||Configure the distributed lock mechanism. Its format is detailed below.|
|`circuitBreaker`|Boolean|`false`|`true`|Enables (`true`) or disables (`false`) the circuit breaker mechanism.|
|`circuitBreakerOptions`|Object|`true` if circuitBreaker is enabled||Speedis leverages [Opossum](https://nodeshift.dev/opossum/) to implement the circuit breaker mechanism. This field is used to define the circuit braker options. Its format is almost identical to the original [options](https://nodeshift.dev/opossum/#circuitbreaker). The main difference is that, since the configuration is in JSON format, parameters defined as JavaScript entities in the original options are not supported.|

### Lock configuration object
The following table describes the supported fields in the lock configuration object.
|Field|Type|Mandatory|Default|Description|
|-----|----|---------|-------|-----------|
|`lockTTL`|Number|`true`||(Time-to-Live for the lock): Specifies the duration (in milliseconds) for which the lock remains valid before automatically expiring. If the lock is not explicitly released within this period, it will be removed.|
|`retryCount`|Number|`true`||(Number of retry attempts): Defines the maximum number of times the system will attempt to acquire the lock if the initial attempt fails.|
|`retryDelay`|Number|`true`||(Base delay between retries): Sets the waiting time (in milliseconds) between consecutive lock acquisition attempts. This helps prevent excessive contention when multiple processes try to acquire the same lock.|
|`retryJitter`|Number|`true`||(Randomized delay variation): Introduces a random variation (in milliseconds) to the retry delay to reduce the likelihood of multiple processes retrying at the same time, which can help prevent contention spikes.|

### Transformations configuration
Speedis supports transformations at different phases of a request:
- **ClientRequest**: Apply transformations to the request received by Speedis from the client (via HAProxy).
- **ClientResponse**: Apply transformations to the response sent by Speedis to the client (via HAProxy).
- **OriginRequest**: Apply transformations to the request sent by Speedis to the origin server.
- **OriginResponse**: Apply transformations to the response received by Speedis from the origin server.
- **CacheRequest**: Apply transformations to the request sent by Speedis to the cache (Redis).
- **CacheResponse**: Apply transformations to the response received by Speedis from the cache (Redis).
In each origin’s configuration file, you can define the transformation to be applied to the URL that matches a pattern defined by a regular expression.
The transformations will be applied according to the order in which they are defined.
```
    "transformations": [
        {
            "urlPattern": ".*",
            "actions": [
                {
                    "phase": "OriginRequest",
                    "uses":  "setHeaders",
                    "with": {
                        "x-header": "example of transformation"
                    }         
                }
            ]  
        } 
    ]
```