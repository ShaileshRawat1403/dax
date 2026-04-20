# Changelog

All notable changes to DAX will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.1] - 2026-04-20

### Added

- **Automated Release Workflow**: GitHub Actions now automates cross-platform builds and releases on tag push
- **Cross-Platform Binaries**: Release artifacts include darwin, linux, and win32 builds

### Fixed

- **Release Artifact Upload**: Fixed matrix artifact merging with `merge-multiple: true`
- **Release Archive Creation**: Fixed tar.gz path patterns for GitHub release

## [1.0.0] - 2026-04-16

### Added

- Initial release of DAX (standalone product)
- Full AI execution authority with governance
- TUI with session management, operator workstation, and multi-provider support
