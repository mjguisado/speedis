# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Fixed

## [2.0.2] - 2026-03-23

### Fixed

- Fixed crash in distributed request coalescing when Redis circuit breaker is disabled
  - The code in `cache.js` line 137 was accessing `server.redisBreaker.opened` without checking if the circuit breaker exists
  - This caused a runtime error when `opts.redis.redisBreaker` was set to `false` in configuration
  - Now uses optional chaining (`?.`) to safely check the circuit breaker state

