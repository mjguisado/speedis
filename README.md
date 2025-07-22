

# Speedis (Gonzales).

**Speedis is a High-Performance Shared HTTP Cache with Geographical Distribution Capability and OAuth2-based Access Control**

In the implementation, the guidelines established in [RFC 9110](https://www.rfc-editor.org/rfc/rfc9111.html) on HTTP Semantics and [RFC 9111](https://www.rfc-editor.org/rfc/rfc9111.html) on HTTP Caching have been followed.
In the design of Speedis, special attention has been given to incorporating mechanisms to protect the origin servers against overloading.

Implementing a shared HTTP cache provides benefits among which the following are highlighted:
- **Reduced Latency**: A shared cache allows multiple clients or services to access the same cache, reducing the time spent fetching data from the origin server. This leads to faster response times and improved user experience.
- **Decreased Load on Origin Servers**: By caching frequently requested content, a shared cache reduces the number of requests that need to reach the origin server, lowering its load and ensuring better resource utilization.
- **Increased Efficiency**: Shared caches can serve data to multiple clients, maximizing the use of cached content and minimizing redundant data fetching from the origin server.
- **Improved Scalability**: A shared cache can easily scale as more clients or services are added, enabling consistent performance without overloading the origin infrastructure.
- **Cost Savings**: By reducing the number of origin server requests, shared caches can lower bandwidth and infrastructure costs, especially for high-traffic applications.
- **Consistency Across Multiple Clients**: Since the cache is shared, all clients access the same cached data, ensuring consistency in the responses and reducing discrepancies in what data is served.
- **Faster Content Delivery**: Shared caches, especially when distributed geographically, can serve content from locations closer to users, ensuring faster content delivery and reducing latency.

## Features.

### Fast and lightweight.
Speedis is built on [Node.js](https://nodejs.org), using the [Fastify](https://fastify.dev/) web framework to ensure [high performance](https://fastify.dev/benchmarks/) and efficient request handling.
This framework allows users to extend its functionality by implementing [plugins](https://fastify.dev/docs/latest/Reference/Plugins/).
The core of Speedis is developed as a Fastify plugin.
Speedis creates an instance of the plugin for each origin configuration file.
Requests are routed to the corresponding plugin instance using a prefix in the URL path.

### Backend-For-Frontend (BFF)
Speedis can apply various transformations to incoming requests and outgoing responses throughout their lifecycle.
These transformations are designed to adapt the data and behavior of the origin server to meet the specific needs of different clients.
The architecture follows a Backend For Frontend (BFF) pattern, allowing for client-specific optimizations.
Speedis includes a set of functions, called actions, that allow changes to be made.
To simplify management, these functions are grouped into libraries.
Speedis allows easy extension of this model by adding custom actions libraries.

### Shared storage backend.
In a distributed HTTP caching system, a common issue arises when new instances are added to the cache pool.
If these instances do not share the same storage for cached objects (e.g., a shared backend or replication mechanism), they start in a “cold” state with no cached data.
As a result, these new instances must fetch content from the origin server, leading to increased latency and higher load on the backend until their cache is sufficiently populated.
This cold start problem in distributed HTTP Caches can cause inconsistencies in response times and reduce the overall effectiveness of the caching layer, especially during scaling events or instance replacements.
Mitigating this issue often requires cache warming techniques, consistent hashing strategies, or a shared storage backend.

Speedis address this issue by using [Redis](https://redis.io/) as a shared storage backend, efficiently storing and retrieving cached responses.
This ensures that all instances can access the same cache data, preventing cold starts and reducing the need for multiple calls to the origin server.
Speedis leverages the [JSON capabilities](https://redis.io/docs/latest/develop/data-types/json/) available as an extension module in [Redis Stack](https://redis.io/docs/latest/operate/oss_and_stack/) and Redis Enterprise to store cache entries in JSON format.

For environments where the cache must comply with enterprise-grade standards (linear scalability, high availability, predictable performance, 24/7 support, etc.), using Redis Enterprise in any of its variants— the fully managed Redis database-as-a-service, [Redis Cloud](https://redis.io/cloud/) or the self-managed [Redis Software](https://redis.io/software/)— is highly recommended.

### Request coalescing.
[Cache stampede](https://en.wikipedia.org/wiki/Cache_stampede) or or Dogpile Problem is a problem that occurs when multiple clients request the same resource simultaneously, but the cached version is expired or unavailable.
Since the cache does not contain a valid response, all requests are forwarded to the origin server at the same time, causing a sudden surge in load.
This can lead to performance degradation, increased latency, and even server overload.
Speedis implements request coalescing, a mechanism that prevents multiple identical requests from being sent to the origin server simultaneously.
When multiple clients request the same resource while it is being fetched, request coalescing ensures that only one request is forwarded to the origin, while the other requests wait for the response to be cached.
Once the response is available, all waiting requests reuse the cached result, reducing the load on the origin server and improving performance.
Speedis can not only coalesce requests arriving at a single instance but also coalesce requests across multiple instances.
It achieves it by implementing a [locking mechanism](https://en.wikipedia.org/wiki/Cache_stampede#Locking) using a [distributed lock pattern with Redis](https://redis.io/docs/latest/develop/use/patterns/distributed-locks/), ensuring maximum protection for the origin server.

You can find more information about the effects of the Request Coalescing mechanism in the origin server in [doc/Coalescing.md](./doc/Coalescing.md).

### Handling origin unavailability with Circuit Breaker.
Speedis also implements a Circuit Breaker mechanism to handle situations where the origin of the cache becomes unavailable unavailable (e.g., due to network failures, server downtime, or high latency)
This situation can lead to several issues:
- **Increased Latency**: Requests that would normally be served from the cache must be redirected to the origin, causing higher response times.
- **Overloading the Origin**: Repeated failed attempts to fetch data from the origin can further burden an already overloaded or down server, exacerbating the problem.
- **Unreliable User Experience**: The cache’s inability to serve data can result in errors or poor performance, negatively impacting the user experience.
Speedis addresses these challenges by incorporating a circuit breaker mechanism.
This mechanism acts as a safeguard against repeated failed requests to the origin.
When the system detects a failure threshold (e.g., multiple failed requests within a short period), the circuit breaker opens and prevents further requests to the origin, thereby avoiding overloading the server.
Instead, it can return a default response or serve stale cached data, ensuring a more stable and reliable user experience even when the origin is unavailable.

You can find more information about the effects of the Circuit Breaker mechanism in the origin server in [doc/CircuitBreaker.md](./doc/CircuitBreaker.md).

### Handling Redis unavailability with Circuit Breaker.
Speedis also implements a Circuit Breaker mechanism to handle situations where the Redis database used to store cache entries becomes unavailable.
When enabled, it prevents the application from forwarding requests to the origin server if Redis is down.
This is particularly useful in scenarios where the origin server cannot handle the full traffic load on its own and relies on Redis to absorb most of the read pressure.
If Redis is unavailable and this setting is enabled, Speedis will return an error response (e.g., HTTP 503) instead of attempting to contact the origin.
This helps protect backend systems from overload and potential cascading failures.

### Clustering.
Speedis implements clustering using Node’s built-in [cluster](https://nodejs.org/api/cluster.html) module to fully utilize the potential of multi-core systems and enhance the performance of Node.js applications.
Clustering enables the creation of multiple worker processes to handle incoming requests, improving performance and optimizing system resource utilization.
By default, Speedis uses [os.availableParallelism()](https://nodejs.org/api/os.html#osavailableparallelism) to create as many workers as possible.
It is highly recommended that the environment where Speedis runs has multiple CPUs in order to fully benefit from the clustering functionality. Perform tests to determine the optimal number of CPUs for your case. Keep in mind that, in addition to the thread workers, an additional thread is required to control the cluster’s activity, so a **minimum of three CPUs is recommended**.

###  Geographically Distributed Cache.
When the clients of a cache are geographically distributed, geographically distributing the cache itself provides additional benefits compared to a local cache, among which the following are highlighted:
- **Reduced Latency**: By placing cache instances closer to end users, geographically distributed caches can significantly reduce response times, improving the overall performance and user experience.
- **Improved Availability**: A distributed cache ensures high availability by replicating cached data across multiple locations. If one region or data center experiences issues, other regions can continue to serve requests, minimizing downtime.
- **Load Balancing**: Distributing the cache across multiple geographical locations helps balance the load, preventing any single server or data center from becoming a bottleneck and improving scalability.
- **Disaster Recovery**: In the event of a regional failure (e.g., network outage, power failure), the cache can continue to operate from other regions, ensuring service continuity and reducing the risk of downtime.
- **Scalability**: A geographically distributed cache can easily scale to meet growing demands by adding more cache nodes in various locations, providing a seamless way to expand without a major overhaul.
As previously mentioned, Speedis uses Redis to store cache entries.

The Enterprise versions of Redis implement [Active-Active geo-distributed databases](https://redis.io/docs/latest/operate/rs/databases/active-active/).
With Active-Active databases, applications can read and write to the same data set from different geographical locations seamlessly and with latency less than one millisecond (ms), without changing the way the application connects to the database.
The features of these databases make it easier to geographically distribute Speedis instances, so that each instance can connect by default to the nearest replica of the database.
This way, all the benefits outlined earlier in this section and in the ‘Shared Storage Backend’ section are achieved.
Additionally, in case of issues between Speedis instances and Redis, the instances can temporarily connect to any of the other replicas of the database, maintaining service continuity.

## Reverse proxy.
Incorporating a [reverse proxy](https://en.wikipedia.org/wiki/Reverse_proxy) is a [recommended practice](https://fastify.dev/docs/latest/Guides/Recommendations/#use-a-reverse-proxy).
In the specific case of Speedis, the main reasons for using it are to facilitate serving multiple domains and to handle TLS termination.
We propose using HAProxy as the reverse proxy and have included a configuration file example in ./conf/haproxy/haproxy.cfg.
In the HAProxy configuration file, the different domains being served are defined.
Depending on the domain through which a request is received, the request path sent to the origin is modified by adding the prefix of the plugin instance that will handle it.
Additionally, this folder contains a script to generate a self-signed certificate for the domain used in the configuration.
In the included example, the following workflow is defined

https://mocks.local/v1/items?x=1&y=2 -> http://speedis:3001/mocks/v1/items?x=1&y=2 -> http://mocks:3030/v1/items?x=1&y=2

Note: Proper DNS resolution is required for mocks.local, speedis, and mocks to function correctly.

### OAuth2-based Access Control
Speedis can be used as a backend for web or mobile applications. In modern applications, securing access to sensitive resources is crucial. Speedis relies on OAuth2 to provide limited access to the resources it caches. Specifically, Speedis uses the Authentication Code Flow, implementing the roles of Resource Server and Client. If you are not familiar with OAuth2, you can refer to a brief [introduction](./doc/OAuth2.md) focusing on the parts of the framework used in Speedis.

### Observability.
The application exposes operational metrics using Prometheus, a powerful open-source monitoring and alerting toolkit. These metrics provide valuable insights into the performance, health, and resource usage of the application, enabling proactive monitoring and troubleshooting. Prometheus can scrape these metrics at regular intervals, allowing for the collection, storage, and visualization of key performance data in real time.

## Speedis configuration.
You can find more information about Speedis configuration in [doc/Configuration.md](./doc/Configuration.md).

## Getting Started.
This repository includes examples of how to deploy Speedis using [Docker Compose](./doc/Docker.md) or in a [Kubernetes cluster](./doc/Kubernetes.md).
To facilitate testing Speedis’ capabilities, some additional components are also included in the deployment.

## Contributing.
Contributions are welcome! Feel free to submit issues or pull requests.

## License.
This project is licensed under the **Server Side Public License (SSPL) v1.0**.

The SSPL ensures that if you use this software to provide a service to others, you must make publicly available not only any modifications to the software but also the complete source code of all supporting components required to run the service. This guarantees that the community benefits from all improvements and that the project remains truly open.

For more details, please refer to the [SSPL license text](https://www.mongodb.com/licensing/server-side-public-license).
