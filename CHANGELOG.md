# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Fixed

## [2.2.0] - 2026-05-25

### Added
- Runtime fallback in `cache.js` that guarantees `cacheSettings.methods` is always defined (baseline `["GET", "HEAD", "POST"]`), even when the user overrides `defaultCacheSettings` without providing `methods`.
- Tests covering CORS behaviour, cache `methods` default and fallback, every conditional rule of the origin validator (Redis dependency, authentication requirement, http1x/http2 exclusivity, circuit breaker options, Bearer requirements, distributed coalescing, BFF/variantsTracker requirements), CORS schema validation, and default-value application through Ajv across modules that use `oneOf`/`allOf`/`if-then`.

### Changed
- **BREAKING**: CORS configuration is now defined **exclusively per origin**. The global `cors` field in `speedis.json` (and the corresponding shallow-merge logic in `app.js`) has been removed. Migration: move any `cors` block from `speedis.json` into each origin file that needs it. If an origin omits `cors`, no CORS headers are added to its responses (this is the default).
- `defaultCacheSettings.methods` default is now `["GET", "HEAD", "POST"]` (was `["GET", "HEAD"]`). POST is included to support caching SOAP and GraphQL endpoints out of the box, as permitted by RFC 9111 §3.
- `conf/loadConfigsToRedis.sh` rewritten to iterate over every `*.json` file in `conf/origins/`. The Redis key for each origin is derived from the filename (`<name>.json` → `speedis:config:origins:<name>`). The script now respects `REDIS_URL` (default `redis://redis:6379`) and uses `set -euo pipefail` with progress messages.
- `conf/speedis.json` updated: `originsConfigsKeys` now points to `speedis:config:origins:cache` (matching the actual `cache.json` file).
- `doc/Configuration.md`: per-origin CORS section rewritten; `Vary` header limitation documented; `methods` documented in `cacheSettings`; `headersToForward`/`headersToExclude` defaults and semantics corrected; `purgePath` default and effective endpoint documented; `CacheRequest`/`CacheResponse` BFF phase descriptions clarified; `@fastify/cors` upstream defaults explicitly marked.

### Fixed
- Origin validator conditional rule #2 (authentication required for private caching) was effectively dead: it inspected `cacheable.private` while the actual field is `cacheable.cacheSettings.private`. As a result, configurations declaring `private: true` without `origin.authentication` passed validation and only failed at request time with HTTP 401/500. The rule now correctly inspects both `defaultCacheSettings.private` and every `cacheable.cacheSettings.private`.
- Shallow merge of CORS between the (now removed) global config and per-origin config could silently override an origin's intended `origin` setting with `false`, because Ajv injected defaults into the per-origin `cors` block before the merge. Removing the global tier eliminates the merge entirely.
- `conf/loadConfigsToRedis.sh` referenced `origins/mocks.json` which did not exist, so the script failed on its first invocation.
- Typo `conf/origin` (singular) corrected to `conf/origins` in `doc/Configuration.md`.

