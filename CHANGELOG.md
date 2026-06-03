# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Fixed

## [2.5.0] - 2026-06-03

**Commit title:**
```
Add cache hit ratio metrics by URL pattern with Grafana dashboard
```

---

**Release note:**

### Cache Hit Ratio Metrics by URL Pattern

Added support for measuring cache performance with granularity by `urlPattern` and origin.

**New metrics**
- New Prometheus counter `speedis_cacheable_requests_total` with labels `origin`, `urlPattern` and `cacheStatus`, enabling calculation of hit ratio, offload and traffic distribution per URL pattern.

**Internal changes**
- Requests are now decorated with `cacheableUrlPattern` in the `onRequest` hook in `cache.js`, capturing the matching pattern from the `cacheable` configuration entry.

**Grafana dashboard**
- New **urlPattern** tab with a summary table per pattern showing: number of requests, percentage of total origin traffic and offload (hit ratio).
- Two time series charts: number of requests and offload per `urlPattern`.
- Filter variables `origin` and `urlpattern` to explore data by origin and URL pattern.

