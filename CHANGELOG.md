# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.2] - 2026-03-04

### Fixed

- Content Security Policy blocking resources by adding `useDefaults: false` to Helmet CSP configuration (#15)

## [0.3.1] - 2026-03-03

### Security

- Upgrade Fastify 4 to Fastify 5 to remediate CVE-2026-25223

### Changed

- Require Node.js 20 or later as the minimum supported version

### Documentation

- Update Node.js and Fastify version references across architecture and development docs

## [0.3.0] - 2026-03-03

### Added

- Bucket notification system with webhook delivery support
- Optional S3 API Route/Ingress for direct external access to the S3 endpoint

### Fixed

- HSTS header causing forced HTTPS redirects in non-TLS environments
- OpenShift liveness and readiness probes using an authenticated endpoint instead of the health endpoint

### Documentation

- Add S3 API Route and Ingress configuration documentation
- Add OpenShift quickstart deployment notes
- Fix broken documentation links

## [0.2.2] - 2026-02-10

### Added

- Internationalization (i18n) framework with multi-language support
- Language selector on the login page
- Web UI with storage browser for buckets and objects
- REST API backend with S3-compatible storage operations
- JWT-based optional authentication
- Helm chart for Kubernetes and OpenShift deployment

### Fixed

- Large file S3-to-S3 transfers failing by switching to stream-through approach
- PatternFly card layout warnings on mobile viewports
- Login error messages not using translated strings
- Folder name validation in the DestinationPicker component
- GitHub API calls proxied through backend for Content Security Policy compliance

### Documentation

- Add Helm quick start guide
- Remove cloud-specific storage class references from deployment docs

[Unreleased]: https://github.com/rh-aiservices-bu/s4/compare/v0.3.2...HEAD
[0.3.2]: https://github.com/rh-aiservices-bu/s4/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/rh-aiservices-bu/s4/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/rh-aiservices-bu/s4/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/rh-aiservices-bu/s4/releases/tag/v0.2.2
