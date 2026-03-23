# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Fixed

## [2.0.0] - 2026-03-23

### Removed

- OAuth2 Module: Completely removed OAuth2 active authentication module and plugin (~1,500 lines of code)
  - Removed src/modules/oauth2.js and src/plugins/oauth2.js
  - Removed Keycloak integration, Docker setup, and configuration files
  - Removed OAuth2 documentation and related assets
  - Migration Note: Speedis now focuses exclusively on passive authentication for user identification in private caching. The origin.authentication configuration extracts user IDs from existing credentials (Basic/Bearer) but does not manage login flows. For active OAuth2 flows, use an external authentication gateway.

### Changed

- Mock Server: Complete authentication system refactor
  - Centralized authentication logic into reusable functions (handleItems, handleStatus)
  - Moved authentication configuration to Fastify plugin options
  - Added flexible per-route authentication override capability
  - Implemented Basic and Bearer (JWT/JWE) authentication validation
  - Added private endpoints (/private/items/:uuid, /private/status/:statusCode/:uuid)
  - Enhanced responses with user_id and auth_scheme metadata
  - Eliminated ~90 lines of duplicated code
- Architecture: Simplified Redis module and configuration validator by removing OAuth2 dependencies
- Dependencies: Updated npm dependencies to latest compatible versions

### Fixed

- Release script now includes package-lock.json in release commits and tags (previously only package.json was committed)

### Added

- Repository: Added package-lock.json to version control for better dependency reproducibility

