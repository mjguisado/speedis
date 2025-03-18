# Speedis - HTTP Cache based on Redis

## Overview
Speedis is a high-performance HTTP caching layer that leverages Redis for storage.<br/>
In the implementation, the guidelines established in [RFC 9110](https://www.rfc-editor.org/rfc/rfc9111.html) on HTTP Semantics and [RFC 9111](https://www.rfc-editor.org/rfc/rfc9111.html) on HTTP Caching have been followed.<br/>
It optimizes response times by reducing direct requests to the origin servers.<br/>
It implements mechanisms to protect the origin servers against overloading.<br/>

## Features
- **Redis-based caching**: Leverages `Redis` to efficiently store and retrieve cached responses.
- **Fast and lightweight**: Built with `Fastify` to ensure high performance and efficient request handling.
- **Request coalescing**: Consolidates multiple similar requests into a single one.
- **Circuit breaker mechanism**: Implements `Opossum` to prevent cascading failures.
- **Prometheus metrics**: Exposes application metrics via `prom-client`.

## Description

Speedis is built on top of the [Fastify](https://fastify.dev/) web framework.<br/>
This framework allows users to extend its functionality by implementing [plugins](https://fastify.dev/docs/latest/Reference/Plugins/).<br/>
The core of Speedis is developed as a Fastify plugin.<br/>
Speedis creates an instance of the plugin for each origin configuration file.<br/>
Requests are routed to the corresponding plugin instance using a prefix in the URL path.<br/>

Speedis implements clustering using Node’s built-in cluster module to fully utilize the potential of multi-core systems and enhance the performance of Node.js applications.<br/>
Clustering enables the creation of multiple worker processes to handle incoming requests, improving performance and optimizing system resource utilization.<br/>
By default, Speedis uses [os.availableParallelism()](https://nodejs.org/api/os.html#osavailableparallelism) to create as many workers as possible.<br/>

## Speedis main configuration
The file ./conf/speedis.conf contains a JSON object with the general configuration of the Speedis server.<br/>
The following table describes the supported fields.<br/>

| Field | Type | Mandatory | Default | Description |
|-------|------|-----------|---------|-------------|
| `maxNumberOfWorkers` | Number | `false` | [os.availableParallelism()](https://nodejs.org/api/os.html#osavailableparallelism) | This parameters limits the number of workers. |
| `port` | Number | `false` | 3001 | The port on which the main service is running. |
| `logLevel` | String | `false` | `info` | Logging level for the main service (`trace`, `debug`, `info`, `warn`, `error`, `fatal`). |
| `metricServerPort` | Number | `false` | 3003 | The port on which the metrics service is running. |  
| `metricServerLogLevel` | String | `false` | `info` | Logging level for the metric service (`trace`, `debug`, `info`, `warn`, `error`, `fatal`). |  

This is an example of the main configuration file.<br/>
```
{
  "maxNumberOfWorkers": 4,
  "port": 8001,
  "logLevel": "warn",
  "metricServerPort": 8003,
  "metricServerLogLevel": "warn"
} 
```

## Origin configuration file
The remote server to be cached is referred to as an `origin` in Speedis.<br/>
The configuration of Speedis’ behavior for each origin server is defined in a configuration file located in ./conf/origin/, which contains a JSON object.<br/>
The following table describes the supported fields.<br/>

| Field | Type | Mandatory | Default | Description |
|-------|------|-----------|---------|-------------|
| `id` | String | `true` | | Origin’s ID |
| `prefix` | String | `true` | | URL path prefix used to route incoming requests to this origin. |
| `logLevel` | String | `true` | `info` | Logging level for this origin (`trace`, `debug`, `info`, `warn`, `error`, `fatal`). |
| `exposeErrors` |  Boolean | | |  This parameter defines whether descriptive error messages are included in the response body (`true` or `false`). |
| `redis` |  Object | `true` | | Speedis uses [node-redis](https://github.com/redis/node-redis) to connect to the Redis database where the cached contents are stored.<br />This object defines the connection details.<br />Its format is almost identical to the [createClient configuration](https://github.com/redis/node-redis/blob/master/docs/client-configuration.md).<br />The main difference is that, since the configuration is in JSON format, parameters defined as JavaScript entities in the original client configuration are not supported. |
| origin | Object | true | | This object defines all the details related to the origin management. Its format is detailed below. |

The following table describes the supported fields in the origin configuration object.<br/>

| Field | Type | Mandatory | Default | Description |
|-------|------|-----------|---------|-------------|
| `httpxOptions` |  Object | `true` | |  Speedis leverages Node’s native [http](https://nodejs.org/api/http.html)/[https](https://nodejs.org/api/https.html) libraries to make requests to the origin server.<br />This field is used to define the request options.<br />Its format is almost identical to the original [options](https://nodejs.org/api/http.html#httprequestoptions-callback).<br />The main difference is that, since the configuration is in JSON format, parameters defined as JavaScript entities in the original options are not supported. |
| `agentOptions` |  Object | `true` | |  Speedis allows to use an [Agent](https://nodejs.org/api/https.html#class-httpsagent) to manage connection persistence and reuse for HTTP clients.<br/>This field is used to configure the agent.<br />Its format is almost identical to the original [https options](https://nodejs.org/api/https.html#class-httpsagent) or [http options](https://nodejs.org/api/http.html#new-agentoptions).|



In each origin’s configuration file, there is an attribute, origin.httpxOptions, used to define the request options.<br/>
```
"httpxOptions": {
    "protocol": "http:",
    "host": "mocks",
    "family": 4,
    "port": 3030,
    "method": "GET",
    "headers": {},
    "timeout": 2000
},
```
It is also possible to use an [Agent](https://nodejs.org/api/https.html#class-httpsagent) to manage connection persistence and reuse for HTTP clients.<br/>
Another attribute, origin.agentOptions, is used to configure the agent.<br/>
```
"agentOptions": {
    "keepAlive": true
},
```
Their formats are almost identical to the standard formats defined for [request options](https://nodejs.org/api/http.html#httprequestoptions-callback) and [agents](https://nodejs.org/api/http.html#new-agentoptions).<br/>
Specifically, since the configuration is in JSON format, parameters defined as JavaScript entities are not supported.<br/>
Support for HTTP/2 is pending.<br/>

Speedis supports transformations at different phases of a request:<br/>
- **ClientRequest**: Apply transformations to the request received by Speedis from the client (via HAProxy).
- **ClientResponse**: Apply transformations to the response sent by Speedis to the client (via HAProxy).
- **OriginRequest**: Apply transformations to the request sent by Speedis to the origin server.
- **OriginResponse**: Apply transformations to the response received by Speedis from the origin server.
- **CacheRequest**: Apply transformations to the request sent by Speedis to the cache (Redis).
- **CacheResponse**: Apply transformations to the response received by Speedis from the cache (Redis).

In each origin’s configuration file, you can define the transformation to be applied to the URL that matches a pattern defined by a regular expression.<br/>
The transformations will be applied according to the order in which they are defined.<br/>
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

## Reverse proxy

Incorporating a reverse proxy is a [recommended practice](https://fastify.dev/docs/latest/Guides/Recommendations/#use-a-reverse-proxy).<br/>
In the specific case of Speedis, the main reasons for using it are to facilitate serving multiple domains and to handle TLS termination.<br/>
We propose using HAProxy as the reverse proxy and have included a configuration file example in ./conf/haproxy/haproxy.cfg.<br/>
In the HAProxy configuration file, the different domains being served are defined.<br/>
Depending on the domain through which a request is received, the request path sent to the origin is modified by adding the prefix of the plugin instance that will handle it.<br/>
Additionally, this folder contains a script to generate a self-signed certificate for the domain used in the configuration.<br/>
In the included example, the following workflow is defined<br/><br/>
https://mocks.speedis/v1/items?x=1&y=2 -> http://speedis:3001/mocks/v1/items?x=1&y=2 -> http://mocks:3030/v1/items?x=1&y=2<br/><br/>
Note: Proper DNS resolution is required for mocks.speedis, speedis, and mocks to function correctly.<br/>

## Installation

```sh
# Clone the repository
git clone https://github.com/mjguisado/speedis.git
cd speedis

# Install dependencies
npm install
```

## Usage
### Running the server
```sh
npm start
```

### Running in development mode
```sh
npm run dev
```

### Environment Variables
| Variable | Description | Default |
|----------|-------------|---------|
| `REDIS_URL` | Redis server connection URL | `redis://localhost:6379` |

## API Endpoints
### Caching a response
```http
GET /cache/:key
```
Retrieves a cached value by key.

### Storing a response in cache
```http
POST /cache/:key
```
Stores a new response under the given key.

### Invalidating a cache entry
```http
DELETE /cache/:key
```
Removes a cache entry by key.

## Docker Support
You can run Speedis using Docker:
```sh
docker build -t speedis .
docker run -p 3000:3000 -e REDIS_URL=redis://your-redis speedis
```

## Monitoring with Prometheus
Speedis exposes metrics at `/metrics`, which can be scraped by Prometheus for performance monitoring.

## Contributing
Contributions are welcome! Feel free to submit issues or pull requests.

## License
TBD


