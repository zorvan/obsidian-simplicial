# Contributing to Simplicial Complex for Obsidian

Thank you for your interest in contributing! This plugin is in active early development. We welcome issues and pull requests.

---

## Quick Start

```bash
git clone https://github.com/zorvan/simplicial-complex
cd simplicial-complex
npm install
npm run build
```

Copy `main.js`, `manifest.json`, and `styles.css` to `.obsidian/plugins/simplicial-complex/` in your vault, then reload Obsidian.

---

## Before You Contribute

### Read the Spec

**[`SPEC.md`](./SPEC.md)** is the authoritative source for architectural decisions and constraints. Pay special attention to **§9 (Critical Implementation Constraints)** — these are non-negotiable and PRs violating them will be rejected.

### Key Principles

1. **Model purity**: `core/` must remain free of Obsidian API dependencies
2. **Renderer as projection**: No business logic in rendering code
3. **Vault as source of truth**: Simplex definitions live in vault files
4. **No silent failures**: Log errors and surface them to users
5. **Canonical keys**: Always sorted, always lowercased

---

## Development Workflow

### Build

```bash
npm run build        # Production build
npm run build:dev    # Development build with sourcemaps
```

### Type Check

```bash
npm run check
```

### Lint & Format

```bash
npm run lint         # Check for issues
npm run lint:fix     # Auto-fix what's possible
npm run format       # Format all TypeScript
npm run format:check # Verify formatting
```

### Test

```bash
npm test             # Compile and run tests
```

---

## Where Contributions Are Most Useful

### High Priority

1. **Parser edge cases** — Special characters in note titles, nested frontmatter, aliases, wikilink resolution
2. **Rendering performance** — Offscreen canvas caching, frame budget profiling, Barnes-Hut tuning
3. **Test coverage** — Layout engine, persistence round-trips, vault indexing
4. **Error handling** — Graceful degradation when file I/O fails

### Medium Priority

1. **Settings validation** — Runtime validation, migration scripts
2. **Accessibility** — Keyboard navigation, screen reader support
3. **Documentation** — Tutorial content, example vaults
4. **UI polish** — Filter sliders, legend improvements, HUD elements

### Research / Experimental

1. **Betti numbers** — Persistent homology computation
2. **ML embeddings** — Semantic similarity via vector models
3. **Graph neural networks** — Structure prediction
4. **Field-based layout** — Region-generating fields vs. current force model

---

## Pull Request Guidelines

### Before Submitting

- [ ] Code passes `npm run check` (no type errors)
- [ ] Code passes `npm run lint` (no ESLint errors)
- [ ] Code passes `npm run format:check` (Prettier compliant)
- [ ] Tests pass (`npm test`)
- [ ] New functionality includes tests
- [ ] Commit messages are clear and follow project style

### Commit Message Style

- Prefer clear, concise messages over verbose explanations
- Focus on "why" over "what" when possible
- Examples:
  - ✅ `Fix rename tracking for pinned nodes`
  - ✅ `Add viewport culling to renderer`
  - ❌ `update stuff`
  - ❌ `fix bug in thing`

### PR Description

Include:
- What this changes does
- Why this change is needed (link to issue if applicable)
- Screenshots for visual changes
- Any breaking changes or migration steps

---

## Reporting Issues

### Bug Reports

Include:
- Obsidian version
- Plugin version
- Steps to reproduce
- Expected vs actual behavior
- Vault file example (minimal, if possible)
- Screenshots/console logs if relevant

### Feature Requests

Include:
- What problem this solves
- How it fits the simplicial model (vs. tags/groups/links)
- Any mathematical/topological basis (if applicable)

---

## Design Philosophy

### Why Simlicial Complexes and Not Hypergraphs?

Hypergraphs are more general but harder to visualize and reason about. Simplicial complexes are mathematically well-behaved: they carry built-in hierarchy (every face of a simplex is also in the complex), support rigorous topological analysis (Betti numbers, persistent homology), and can be rendered elegantly as organic regions rather than geometric clutter.

### Why Organic Blobs and Not Crisp Triangles?

The primary use case is cognitive — building and navigating a personal knowledge base. Soft blobs are easier to perceive as "fields of meaning" than precise geometry. The formal geometric view (crisp triangles, wireframe tetrahedra) is available via toggle for when topological analysis becomes the focus.

### Why Not Store Simplices in a Database?

The vault is the source of truth. Simplex definitions stored in frontmatter are human-readable, version-controllable, and survive plugin reinstalls and Obsidian Sync without conflict. The plugin reads from the vault; it does not own the data.

---

## Code of Conduct

- Be respectful and constructive
- Focus on the technical merits of contributions
- When in doubt, ask before making large changes
- Review the SPEC before submitting PRs

---

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
