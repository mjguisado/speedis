# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Fixed

## [1.0.1] - 2026-03-19

### Changed
- Optimized cache PURGE operations: exact URLs now use direct UNLINK instead of SCAN iterator, improving performance

### Fixed
- PURGE now correctly deletes both GET and HEAD cache entries for the same URL

