# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Fixed

## [2.4.0] - 2026-05-28

### Added

  - Plain-text fingerprint mode for BFF cache-key actions. Both
    `xmlsax:xmlBodyFingerprint` and `xmlxpath:xpathBodyFingerprint` now
    accept `algorithm: false` in their `with` block. When set, the extracted
    element values are joined with `:` and stored verbatim in
    `target.bodyFingerprint` (no hashing). Useful for readable cache keys
    while debugging or when the discriminator is already low-cardinality
    and the hash adds no value.

  ### Changed

  - Fingerprint composition now joins extracted values with `:` instead of
    concatenating them without a separator. Applies to both hashed and
    plain modes. **Cache-key impact**: previously hashed entries do not
    collide with newly generated keys — expect a one-time miss wave after
    upgrade on origins using `xmlBodyFingerprint` or `xpathBodyFingerprint`.
  - `src/actions/xmlsax.js`: internal `results` array renamed to `parts`,
    matching the naming already used in `xmlxpath.js`. No behavioral change.

