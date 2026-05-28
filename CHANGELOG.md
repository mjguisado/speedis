# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Fixed

## [2.3.0] - 2026-05-28

Added

  - Authenticated cache purging. Optional per-origin purgeToken (string) under cache. When configured, requests to purgePath must carry
  X-Speedis-Purge-Token with a matching value; mismatched or missing tokens return HTTP 401. When purgeToken is absent, no token check is performed —
  preserving the previous open-by-default behavior for backward compatibility. Network-level isolation (HAProxy ACLs, internal-only ports) is still the
  primary defense; the token is defense in depth.
  - Header-based user identity on purge. Routes declared cacheSettings.private: true keyed cache entries by (transformed URL, transformed userId).
  Previously, purging such entries required an Authorization header so the userId could be derived from Basic credentials or a Bearer JWT — impractical
  for server-to-server invalidators that cannot mint user-scoped tokens. The new X-Speedis-Purge-UserID header carries the userId in clear, and Speedis
  re-applies the same idTransformation (hash / prefix / suffix) used at cache-write time so the resulting key matches the stored entry. If the header is
   absent on a purge to a private route, the cache key is built without a userId component, no entry matches, and the response is 404 — making "header
  missing" indistinguishable from "nothing was cached" at the HTTP level (the server logs disambiguate).
  - New exported helper getPurgeUserId(opts, request) in src/modules/authentication.js. Reads X-Speedis-Purge-UserID, applies
  origin.authentication.idTransformation when configured, returns null when the header is absent.

  Changed

  - src/modules/cache.js preValidation hook now branches at the top on isPurgeRequest: it validates X-Speedis-Purge-Token against opts.cache.purgeToken
  (when configured) and, for private routes, populates request.userId via getPurgeUserId. The non-purge path (reads via getUserId from Authorization) is
   unchanged.
  - src/modules/originConfigValidator.js: new optional property purgeToken (type string) under the cache schema, sitting next to purgePath. No default
  value — absence means no token enforcement.

  Migration / Compatibility

  - Fully backward compatible. The read path is untouched.
  - Existing deployments without purgeToken continue to accept unauthenticated purges.
  - Existing purgers that send Authorization against private routes keep working — the new header is an additional mechanism, the only viable one for
  callers that cannot supply user credentials (e.g. consumers of an internal event stream).

  Security note

  - X-Speedis-Purge-UserID is honored only on requests routed to isPurgeRequest (DELETE + purgePath prefix). It has no effect on read requests, so it
  cannot be used to spoof identity on GET/HEAD.
  - purgeToken is compared with a strict equality check. For real deployments consider rotating it, scoping it per origin (as the schema allows), and
  gating /purge/* at the network layer in addition.

