# Circuit breaker test
We are going to run some tests to observe the effects of the circuit breaker mechanism on the origin.

## Without circuit breaker
First, we modify the configuration file for the mocks origin, located at ./conf/origins/mocks.json, to ensure that the circuit breaker mechanisms is disabled (circuitBreaker = false) and to the coalescing mechanisms are disabled—both for requests arriving at the same instance (requestCoalescing = false) and across different instances (lock = false).
Once modified, we proceed to start the environment:
```sh
docker compose up --build -d
```
To visualize the effects, we will use a dashboard that we will import into Grafana.
Follow this [instructions to import](./Grafana.md) it into the grafana instance.

The next step is to generate load on the platform using [artillery](https://www.artillery.io/).
Specifically, we will use a scenario where 500 requests per second are sent to the same resource for 15 minutes.
```sh
artillery run --scenario-name 'overflow' ./artillery/load-test.yml
```
In the request sent to the mocks server (origin), we specify that the response should be delayed by 500ms and that it will remain valid in the cache for 5 seconds.

After the initial moments, the number of incoming requests to Speedis stabilizes at around 500 req/s, while the number of requests to the origin is significantly lower, at around 40-45 req/s. This translates to a workload reduction of more than 90% on the origin server for these requests. Additionally, the response time for requests reaching the origin remains around 500ms, as configured, whereas requests served from the cache have a significantly lower response time of approximately 30ms. This improvement is a direct result of using a cache.
<img src="./img/without_coalescing.png"/>

Now, we provoke an outage in the origin server.
```sh
docker stop mocks
```

Now, we recover the origin server.
```sh
docker start mocks
```
