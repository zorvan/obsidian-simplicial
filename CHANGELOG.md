# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- `.gitignore` file for proper repository hygiene
- `LICENSE` file (MIT)
- `SPEC.md` engineering specification
- `CONTRIBUTING.md` contributor guidelines
- `CHANGELOG.md` (this file)
- ESLint configuration with TypeScript rules
- Prettier configuration
- GitHub Actions CI/CD workflow (lint, type-check, build, test)
- Linting and formatting scripts to `package.json`

### Changed
- Removed `tsc` dummy dependency from `package.json`
- Updated TODO documentation to clarify research-only items

### Fixed
- Missing LICENSE file referenced in README
- Missing SPEC.md file referenced in README and CONTRIBUTING

---

## [0.1.0] - Initial Development Version

### Core Features
- Organic blob renderer with metaball capsule-union approach
- Force-directed layout with Barnes-Hut O(n log n) optimization
- Sleep mode for zero idle CPU usage
- Dual view modes: organic blobs and formal geometric rendering
- Hover focus system with ambient context revelation
- Dimension filter (edges, clusters, cores)
- Node pinning with persistence across sessions
- Rename tracking without losing layout positions
- Real-time vault change detection and updates

### Simplices
- Inline shorthand syntax (△, △△)
- YAML frontmatter with metadata (label, weight)
- Automatic face generation (capped at dimension 4)
- Two persistence modes: source-note and central-file

### Inference
- Edge inference from links, tags, title/content overlap, folders
- Suggestion system for triangle closures and soft clusters
- Temporal decay for older simplices
- Simplex centrality measures

### Analysis
- Betti number display (β₀, β₁, β₂)
- Simplex centrality per node and global hub identification
- Filtration controls with weight/confidence/decayed-weight metrics

### Interaction
- Context menu for node/simplex actions
- Lasso-select creation
- Promote simplex to note
- Dissolve simplex
- Metadata side panel with editing capabilities
- Lifecycle state progression for inferred simplices

### Performance
- Progressive loading for large vaults
- Viewport culling for render efficiency
- Text measurement caching
- Debounced settings saves

---

[Unreleased]: https://github.com/zorvan/obsidian-simplicial/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/zorvan/obsidian-simplicial/releases/tag/v0.1.0
