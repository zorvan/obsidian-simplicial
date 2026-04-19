# Simplicial Complex for Obsidian

A knowledge graph plugin that replaces pairwise links with **higher-order structure** — clusters of notes that only make sense together, rendered as a living, organic field.
My blog post about the motivation and process of creating this plugin : [blog post](https://zorvan.medium.com/i-built-a-tool-to-map-my-thoughts-it-failed-then-it-changed-how-i-think-01528fb40bf4)

---

![Version](https://img.shields.io/badge/version-0.3.0-green)
![Obsidian](https://img.shields.io/badge/obsidian-%3E%3D1.5.0-blueviolet)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## What This Is

Obsidian's built-in graph says: *"Note A links to Note B."*

This plugin says: *"Notes A, B, and C form a unit that only makes sense together."*

That difference — between connection and coherence — is the entire idea. The underlying structure is a [simplicial complex](https://en.wikipedia.org/wiki/Simplicial_complex): a mathematical object that encodes higher-order relationships between notes using triangles, tetrahedra, and beyond, rather than simple edges.

The interface is deliberately **organic and ambient**. Clusters appear as soft fields. Structure emerges over time. The math stays hidden until you want it.

![Screenshot-1](docs/images/Formal.png)
![Screenshot-2](docs/images/Ambient.png)

---

## Why Not Just Use Tags or Groups?

| | Tags | Groups | Links | **Simplices** |
|---|---|---|---|---|
| One-to-many | ✅ | ✅ | — | — |
| Pairwise connection | — | — | ✅ | ✅ |
| Higher-order coherence | — | — | — | ✅ |
| Overlapping clusters | ✅ | — | — | ✅ |
| Future topological analysis | — | — | — | ✅ |

Tags classify. Links connect. **Simplices encode coherence** — the idea that a set of notes, taken together, forms a meaningful unit that its members alone do not.

---

## Visual Overview

```
Organic view (default)          Formal view (v3)

  ·startup·                      startup ─── capital
 ╭───────────╮                      \       /
 │  capital  │  ←── 2-simplex         talent
 │           │       (cluster)
 │  talent   │
 ╰───────────╯

Soft blob = coherent cluster    Crisp triangle = same data
```

Both views are projections of the same underlying simplicial model. Toggle between them without changing your data.

---

## Features

### Core (v1–v2)

- **Organic blob renderer** — clusters visualized as soft, overlapping fields. Blobs use a capsule-union metaball approach that correctly handles any node arrangement, including non-convex shapes.
- **Living layout** — force simulation with simplex cohesion and gentle breathing. Layout never fully settles; it drifts quietly when idle, wakes on interaction or vault changes.
- **Sleep mode** — the render loop pauses when kinetic energy falls below threshold. No idle CPU drain.
- **Hover focus** — hovering a node reveals only its structural context. Everything else fades. No click required.
- **Dimension filter** — toggle edges, clusters (2-simplices), and cores (3-simplices and higher) independently.
- **Metadata panel** — optional label and weight per simplex. Weight is felt (blob density), not displayed as a number.
- **Node pinning** — double-click any node to fix its position across sessions. Click-and-hold to temporarily push overlapping neighbors apart.
- **Rename tracking** — renaming a note in Obsidian automatically updates all simplex references without losing layout positions.
- **Real-time updates** — vault changes (create, modify, delete, rename) update the graph live.
- **Formal/geometric view** — toggle between organic blobs and crisp geometric rendering with wireframe edges.
- **Lasso-select creation** — click and drag to draw a lasso around nodes, then open the create-simplex dialog directly on the canvas.
- **Promote simplex to note** — compress a cluster into a first-class vault concept. The new note links to all member nodes.
- **Filtration controls** — reveal structure layer by layer by weight threshold. Choose from weight, confidence, or decayed-weight metrics.
- **Simplex centrality analysis** — identify which notes anchor the most clusters. Displayed in the metadata panel and global analysis view.

### Analysis & Inference (v2+)

- **Edge inference** — infer lightweight edges from tags, outbound links, title/content overlap, and folder co-location.
- **Suggestion system** — detect triangle closures and soft clusters with configurable confidence threshold. Render suggestions directly on the canvas.
- **Temporal decay** — older simplices gradually lose strength, allowing your graph to naturally shift focus toward recent work.
- **Centrality measures** — simplex centrality per node, plus global hub identification.

### Topological Analysis (v3 — New!)

- **Betti numbers (β₀, β₁, β₂)** — real-time computation of topological invariants showing:
  - β₀: Connected components in your knowledge graph
  - β₁: Unfilled triangles (holes) representing missing connections
  - β₂: Hollow shells (voids) where 3D structure could form
- **Phantom hole visualization** — missing simplices rendered as dashed orange outlines on the canvas. Click to create the missing connection.
- **Hole-as-prompt interaction** — hover over a phantom hole to see which notes would complete the structure.
- **Live Betti HUD** — display current Betti numbers in the top-left corner of the canvas.

### Emergent Inference Engine (v3 — New!)

- **Semantic clustering** — automatically group notes by content similarity using TF-IDF vectorization and k-means clustering
- **Emergent edge detection** — discover relationships based on shared semantic domains, not just explicit links
- **Hybrid inference modes** — choose between:
  - **Emergent**: Graph-based semantic analysis with content clustering
  - **Legacy**: Rule-based heuristics (tags, links, folders)
  - **Hybrid**: Both systems working together
- **Domain-aware coloring** — notes colored by their semantic cluster or folder structure
- **Interaction reinforcement** — tracked interactions boost edge weights, making frequently-used connections stronger

### UI/UX Improvements (v3 — New!)

- **Floating canvas controls** — gear icon on the canvas opens real-time parameter adjustment panel
- **Dual-slider precision controls** — Link Threshold and Filtration use coarse+fine dual sliders for precise tuning
- **Adaptive value displays** — sliders show appropriate decimal precision (3 decimals for fine controls)
- **Reorganized settings panel** — Emergent options prioritized, Legacy options organized separately
- **Explanation cards** — human-readable explanations for inferred simplices in the metadata panel

---

## Defining Simplices

Simplices are defined directly in your vault files. Two syntaxes are supported:

### Inline shorthand

```markdown
△ startup capital talent
△ startup regulation market
△△ startup product market users
```

- `△` — a 2-simplex (3 nodes forming a cluster)
- `△△` — a 3-simplex (4 nodes forming a core)
- Node names are space-separated and matched to note titles (case-insensitive)

**Can't type △?** Use `Ctrl/Cmd + Shift + S` in any markdown editor — it inserts `△` at the cursor.

### YAML frontmatter (with metadata)

```yaml
---
simplices:
  - nodes: [startup, capital, talent]
    label: "founding engine"
    weight: 0.9
  - nodes: [startup, regulation, market]
    label: "market context"
    weight: 0.6
---
```

Frontmatter takes priority when both are present in the same note. Use it when you want to attach a label or weight to a simplex.

### Face generation

When you define `[A, B, C]`, the plugin automatically generates all sub-faces: `[A, B]`, `[B, C]`, `[A, C]`. This keeps the model mathematically valid. Auto-generated faces render more faintly than user-defined ones.

> **Note:** Face generation is capped at dimension 4 (5-node simplices) to prevent combinatorial explosion. Higher-order simplices are stored but faces are computed lazily on demand.

---

## Interaction Model

The plugin follows one principle: **interaction reveals structure, it does not manipulate it.**

| Action | Effect |
|---|---|
| Hover node | Focus mode — simplex fields intensify, unrelated nodes fade |
| Move away | Focus releases with a 150ms fade |
| Click-and-hold node | Momentary repulsion — push overlapping neighbors apart |
| Double-click node | Pin/unpin — fixes position across sessions |
| Toggle `1` / `2` / `3` | Show/hide edges, clusters, cores |
| `F` | Lock focus on hovered node until Escape |
| `P` | Open metadata panel for hovered simplex |
| `Escape` | Clear all focus and selection |

---

## Metadata

Every simplex can optionally carry:

**Label** — a human name for the cluster. Shown on hover in the side panel. Assigned lazily — never required at creation time.

**Weight** — cohesion intensity from 0.1 to 1.0. Affects blob density and the strength of attraction forces in the layout. Felt, not displayed. Defaults to 1.0.

Colors are deterministic by simplex order, with stable per-simplex variation inside each order family, so clusters do not all collapse into the same exact color.

---

## Persistence

By default, simplex definitions are written to the YAML frontmatter of the note they conceptually belong to. This keeps the vault as the single source of truth and works correctly under Obsidian Sync.

You can switch to a central `_simplicial.md` file in settings if you prefer to keep definitions in one place.

---

## Installation

### From Obsidian Community Plugins *(not yet available)*

1. Open Obsidian Settings → Community plugins
2. Search for "Simplicial Complex"
3. Install and enable

### Manual installation

1. Download the latest release from the [Releases](../../releases) page
2. Copy `main.js`, `manifest.json`, and `styles.css` to `.obsidian/plugins/simplicial-complex/` in your vault
3. Reload Obsidian and enable the plugin under Settings → Community plugins

### From source

```bash
git clone https://github.com/zorvan/simplicial-complex
cd simplicial-complex
npm install
npm run build
```

Copy the output to your vault's plugin directory as above.

---

## Configuration

Open Settings → Simplicial Complex to configure:

### Display & Interaction

| Setting | Default | Description |
|---|---|---|
| Persistence mode | `source-note` | Where simplex definitions are written — note frontmatter or a central file |
| Central file | `_simplicial.md` | Path for central file mode |
| Show edges | On | Render dim-1 simplex capsules and edge lines |
| Show clusters | On | Render dim-2 simplex blobs |
| Show cores | On | Render simplices with dimension 3 and higher |
| Max rendered dimension | 12 | Cap visual rendering (higher-order still stored) |
| Noise amount | 0.12 | Breathing intensity of the layout |
| Sleep threshold | 0.01 | Kinetic energy level at which the layout pauses |
| Dark mode | Auto | Follow system, or force light/dark |
| Formal mode | Off | Switch from ambient blobs to geometric rendering with analysis overlays |
| Label density | 0.5 | How many non-focused labels render before decluttering hides the rest |
| Metadata hover delay | 300ms | Time before metadata panel updates on node hover |

### Vault Linking

| Setting | Default | Description |
|---|---|---|
| Link graph baseline | Off | Always show note-to-note vault links as 1-simplices |
| Enable inferred edges | On | Use tags, links, titles, content, and folders to infer lightweight edges |
| Inference threshold | 0.25 | Minimum combined signal before an inferred edge is created |

### Edge Inference Weights (when enabled)

| Setting | Default | Description |
|---|---|---|
| Link weight | 0.25 | Strength added by a resolved outbound link |
| Mutual link bonus | 0.1 | Extra weight when both notes link each other |
| Shared tag weight | 0.15 | Weight contributed by each shared tag |
| Title overlap weight | 0.2 | Maximum title-token overlap contribution |
| Content overlap weight | 0.15 | Maximum body-text overlap contribution |
| Same folder weight | 0.1 | Boost when two notes share the same folder |
| Top folder weight | 0.05 | Boost when two notes share the same top-level folder |

### Suggestions & Analysis

| Setting | Default | Description |
|---|---|---|
| Show suggestions | On | Render closure and soft-cluster suggestions directly on the canvas |
| Suggestion threshold | 0.6 | Confidence level required before a suggestion is surfaced |
| Command simplex size | 3 | How many nodes the create-from-open-note command tries to include |

### Layout Optimization

| Setting | Default | Description |
|---|---|---|
| Sparse edge length | 150 | Preferred spacing for sparse link-only graphs |
| Sparse gravity boost | 1.5 | Extra centering force when the graph is mostly pairwise and sparse |

### Filtration

| Setting | Default | Description |
|---|---|---|
| Filtration metric | `weight` | Which simplex strength field the live filtration slider uses: weight, confidence, or decayed-weight |
| Filtration threshold | 0 | Hide simplices below this threshold in the active metric |

---

## Design Decisions

**Why simplicial complexes and not hypergraphs?**
Hypergraphs are more general but harder to visualize and reason about. Simplicial complexes are a mathematically well-behaved subset: they carry built-in hierarchy (every face of a simplex is also in the complex), support rigorous topological analysis (Betti numbers, persistent homology), and can be rendered elegantly as organic regions rather than geometric clutter.

**Why organic blobs and not crisp triangles?**
The primary use case is cognitive — building and navigating a personal knowledge base. Soft blobs are easier to perceive as "fields of meaning" than precise geometry. The formal geometric view (crisp triangles, wireframe tetrahedra) is planned for v3, when topological analysis becomes the focus.

**Why not store simplices in a database?**
The vault is the source of truth. Simplex definitions stored in frontmatter are human-readable, version-controllable, and survive plugin reinstalls and Obsidian Sync without conflict. The plugin reads from the vault; it does not own the data.

**One data model, two views.**
The organic renderer and the future formal renderer are both projections of the same `SimplicialModel`. Switching views requires no data migration.

---

## Architecture

The plugin is structured around a strict layering principle:

```
VaultIndex  →  SimplicialModel  →  LayoutEngine  →  Renderer
               (source of truth)   (forces)          (projection)
                      ↑
               InteractionController
```

`SimplicialModel` has zero Obsidian API dependencies — it is pure TypeScript and fully unit-testable in isolation. The renderer is a projection and contains no business logic. Interaction perturbs the layout; it never rebuilds it.

A full engineering specification is available at [`SPEC.md`](./SPEC.md).

---

## Mathematical Background

A **simplicial complex** K is a collection of simplices closed under the face operation: if σ ∈ K and τ ⊆ σ, then τ ∈ K.

In this plugin:

- A **0-simplex** is a note (node)
- A **1-simplex** is a coherent pair of notes (edge)
- A **2-simplex** is a coherent triple — the smallest unit of closure
- A **3-simplex** is a coherent quadruple — a "core"

The weight on each simplex defines a **weighted filtered complex**, which in v3 will support persistent homology analysis: revealing which conceptual clusters are robust (persist across weight thresholds) and which are incidental.

---

## Contributing

This project is in active early development. Issues and pull requests are welcome.

Before contributing, please read [`SPEC.md`](./SPEC.md) — particularly §8 (Critical Implementation Checklist) — to understand the architectural constraints that must be preserved.

Areas where contributions are most useful:

- Parser edge cases (special characters in note titles, nested frontmatter, aliases)
- Rendering performance (offscreen canvas caching, frame budget profiling)
- Mathematical analysis layer (Betti numbers, filtration, centrality measures)

---

## License

MIT — see [`LICENSE`](./LICENSE)

---

*"Standard knowledge graphs are fundamentally pairwise. This is not."*
