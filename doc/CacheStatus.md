# `x-speedis-cache-status` reference

Every response Speedis emits carries an `x-speedis-cache-status` header whose value follows the format `<STATUS> from <hostname>`. The hostname comes from `os.hostname()` of the worker that produced the response (useful to identify which Speedis instance served the request when running behind a load balancer).

The Prometheus metrics `speedis_http_responses_total` and `speedis_http_responses_duration` use the `<STATUS>` prefix as their `cacheStatus` label, so this table is also the authoritative key for dashboard breakdowns (see [Grafana.md](./Grafana.md)).

## Status values

| Status | Source (module) | HTTP code | Meaning |
|--------|-----------------|-----------|---------|
| `CACHE_HIT` | `cache.js` | 200 | A fresh entry was found in Redis and served directly. `Age` reflects how long the entry has been cached. |
| `CACHE_HIT_REVALIDATED` | `cache.js` | 200 | The cached entry was stale; Speedis revalidated it conditionally and the origin returned `200` with a fresh body, which has been re-stored. |
| `CACHE_HIT_REVALIDATED_304` | `cache.js` | 200 | The cached entry was stale; the origin replied `304 Not Modified` and Speedis refreshed the entry's freshness without reading a new body. |
| `CACHE_HIT_NOT_REVALIDATED` | `cache.js` | 5xx (typically `504`/`503`/`500`) | The cached entry was stale and revalidation failed (timeout, breaker open, network error), but the cached `Cache-Control` includes `must-revalidate` or `proxy-revalidate`, so Speedis is not allowed to return stale content. The error code from the underlying failure is propagated. |
| `CACHE_HIT_NOT_REVALIDATED_STALE` | `cache.js` | 200 | Same situation as above, but the cached `Cache-Control` does **not** forbid serving stale, so Speedis returns the stale entry. This is the path that keeps latency flat during an origin outage when the circuit breaker is enabled. |
| `CACHE_MISS` | `cache.js` | passthrough | No cached entry existed, or the origin response was not cacheable. Speedis forwarded the response as-is. |
| `CACHE_FAILED_MISS` | `cache.js` | 5xx | No cached entry existed and the request to the origin failed (timeout → `504`, breaker open → `503`, anything else → `500`). |
| `CACHE_NO_LOCK` | `cache.js` | 503 | `distributedRequestsCoalescing` is enabled and Speedis exhausted `retryCount` attempts to acquire the Redis lock guarding the refresh. |
| `CACHE_REDIS_OUTAGE` | `cache.js` | 503 | The Redis circuit breaker is open and `disableOriginOnRedisOutage: true`, so Speedis refused to fall through to the origin. |
| `CACHE_ERROR_400` | `cache.js` | 400 | The request was syntactically invalid (e.g. `If-None-Match: "*"` mixed with other tags — see RFC 9110 §13.1.2). |
| `CACHE_ERROR_500` | `cache.js` | 500 | An unexpected exception was caught while processing the cacheable flow. The log line carries the underlying error. |
| `CACHE_NOT_ENABLED` | `origin.js` | passthrough | The request matched no cacheable pattern, so Speedis behaved as a plain proxy. |
| `CACHE_STATUS_UNDEFINED` | `plugins/speedis.js` | passthrough | Defensive fallback when an upstream code path forgot to set the header. Should never be observed in normal operation — its presence in the Grafana dashboard is a signal of a code-level regression. |

## Where each status is set in the code

If you need to trace exactly which branch emits a given status, search `src/` with:

```sh
grep -rn "x-speedis-cache-status" src/modules/ src/plugins/
```

The full list lives in three files:

- `src/modules/cache.js` — every status whose source is `cache.js` in the table above.
- `src/modules/origin.js` — `CACHE_NOT_ENABLED` (set inside `proxy()`).
- `src/plugins/speedis.js` — `CACHE_STATUS_UNDEFINED` (set as a defensive fallback in the catch-all route).

## See also

- [CircuitBreaker.md](./CircuitBreaker.md) — how `CACHE_HIT_NOT_REVALIDATED_STALE` and `CACHE_NO_LOCK` behave under origin outages.
- [Coalescing.md](./Coalescing.md) — when `CACHE_NO_LOCK` is reached.
- [Grafana.md](./Grafana.md) — how the `cacheStatus` label feeds the dashboard.

> **When adding a new status:** update this table, the corresponding source file, and the Grafana dashboard at `./conf/grafana/Speedis-dashboard.json`.
