# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Fixed

## [2.6.0] - 2026-08-07

### Upstream (Origin) Server Metrics
Added observability for the requests Speedis makes to upstream/origin servers, including latency histograms and error counters, plus a new Grafana dashboard section.
### Added
- New Prometheus histogram `speedis_upstream_requests_duration` measuring the duration (ms) of requests to origin servers, with labels `origin`, `method` and `statusCode` (buckets from 1 ms to 10 s).
- New Prometheus counter `speedis_upstream_requests_errors_total` tracking failed upstream requests that never got an HTTP response (timeouts, connection errors), with labels `origin`, `method` and `code`.
- New **Upstream** section in the Grafana dashboard with *Requests per second*, *Average Latency* and *Origin responses* panels built on the new metrics.
### Changed
- Upstream calls in `_fetch` (`origin.js`) are now timed with `performance.now()` and reported through a server-decorated `recordUpstreamRequest` hook. Instrumentation is only active when metrics are enabled, so there is zero overhead otherwise. Decoration is used instead of a direct import to avoid the `origin.js -> metrics.js -> cache.js -> origin.js` import cycle.
- Updated dependencies: `fastify` ^5.8.5 -> ^5.11.2, `opossum` ^9.0.0 -> ^10.0.0 (major), `redis` ^6.0.0 -> ^6.2.0, `jose` ^6.2.3 -> ^6.2.8, `@fastify/cors` ^11.2.0 -> ^11.3.0, `@fastify/etag` ^6.1.0 -> ^6.2.0, `sax` ^1.6.0 -> ^1.6.1.
### Fixed
- (none)

