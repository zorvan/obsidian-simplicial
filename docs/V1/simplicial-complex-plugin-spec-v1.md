# Obsidian Simplicial Complex Plugin
### Product Specification — Engineering Handoff

**Version:** 0.2 (Engineering Review Incorporated)  
**Status:** Gap-filled, ready for implementation  
**Audience:** Solo developer  
**Date:** 2026-03-29  
**Changelog:** v0.2 integrates critical engineering review — face generation cap, lazy evaluation, rename tracking, content hashing, concave blob fix, node pinning, sleep mode, color stability via label hash, and △ keyboard shortcut.

---

## Table of Contents

1. [Product Vision & Goals](#1-product-vision--goals)
2. [Data Model & Schema](#2-data-model--schema)
3. [Plugin Architecture](#3-plugin-architecture)
4. [Rendering Pipeline](#4-rendering-pipeline)
5. [UX & Interaction Spec](#5-ux--interaction-spec)
6. [Phased Roadmap](#6-phased-roadmap)
7. [Known Constraints & Open Questions](#7-known-constraints--open-questions)
8. [Critical Implementation Checklist](#8-critical-implementation-checklist)

---

## 1. Product Vision & Goals

### 1.1 What This Is

A plugin for [Obsidian](https://obsidian.md) that overlays a **simplicial complex** representation on top of your vault — a parallel graph system that models *coherent clusters of meaning* rather than pairwise links.

Where Obsidian's native graph says:

> "Note A links to Note B"

This plugin says:

> "Notes A, B, and C form a unit that only makes sense together."

That distinction is the entire product.

### 1.2 Core Thesis

Standard knowledge graphs are fundamentally pairwise. Hypergraphs generalize this but suffer from visual and cognitive complexity. **Simplicial complexes** offer the right balance:

- They encode higher-order coherence (triangles, tetrahedra)
- They carry built-in hierarchy (faces ⊂ cofaces)
- They support rigorous topological analysis when needed
- They can be rendered as soft, organic regions — not geometric noise

The primary interface is **organic and ambient** (soft blobs, breathing layout). The underlying model is **mathematically precise** (simplices stored exactly, faces auto-generated, weights and labels as first-class metadata). The formal geometric view is a toggle away, not a redesign.

### 1.3 What This Is Not

- **Not a replacement for Obsidian's native graph.** It is a parallel view.
- **Not a tag or grouping system.** Simplices encode *coherence*, not categorization.
- **Not a full topology engine** (in v1). That's v3 territory.
- **Not a database.** No schema enforcement, no forms, no required fields.

### 1.4 Design Principles

| Principle | Implementation |
|---|---|
| Structure lives underneath, atmosphere on top | Organic blobs = projection. Simplices = source of truth. |
| Metadata is discovered, not entered | Labels and weights are optional and delayed, never required at creation time. |
| Interaction reveals, not manipulates | Hover and focus expose structure. No physics dragging. |
| Future math must be possible without redesign | Data model is mathematically valid from day one. |
| One data model, two views | Organic (v1) and Formal/Geometric (v3) are projections of the same simplex store. |

---

## 2. Data Model & Schema

### 2.1 Core TypeScript Interfaces

```typescript
// A node corresponds to one Obsidian note (identified by note title or path)
type NodeID = string; // e.g. "startup" or "Philosophy/emergence"

// A simplex: the fundamental unit of meaning
interface Simplex {
  nodes: NodeID[];      // sorted, normalized — ["capital", "startup", "talent"]
  weight?: number;      // optional float [0.1, 1.0] — defaults to 1.0 if absent
  label?: string;       // optional human name — "founding engine"
  colorKey?: string;    // stable color bucket — derived from label hash, never user-set directly
}

// The full complex: what the plugin stores and reasons over
interface SimplicialComplex {
  simplices: Map<string, Simplex>;  // key = normalizedKey(nodes)
}

// A vault node: position + velocity for layout
interface LayoutNode {
  id: NodeID;
  px: number;           // canvas x position
  py: number;           // canvas y position
  vx: number;           // velocity x
  vy: number;           // velocity y
  isVirtual: boolean;   // TRUE if no markdown file exists for this node
  isPinned: boolean;    // TRUE if user double-clicked to fix position
  displayAlpha: number; // current alpha for smooth 150ms lerp transitions
}
```

### 2.2 Normalization Rules

Every simplex is **canonically identified** by its sorted, lowercased node set. This is non-negotiable — it prevents duplicate simplices from different orderings or capitalizations and is required for correct face generation.

```typescript
function normalizeKey(nodes: NodeID[]): string {
  // CRITICAL: toLowerCase() — Obsidian is case-insensitive for note titles.
  // "Startup" and "startup" must resolve to the same node.
  return [...nodes].map(n => n.toLowerCase().trim()).sort().join('|');
}
// ["Talent", "Startup", "Capital"] → "capital|startup|talent"
// ["startup", "capital", "talent"] → "capital|startup|talent"  ← same key ✓
```

On insertion, always normalize before storing:

```typescript
function addSimplex(complex: SimplicialComplex, s: Simplex): void {
  const normalized = { ...s, nodes: [...s.nodes].sort() };
  const key = normalizeKey(normalized.nodes);
  complex.simplices.set(key, normalized);
  generateFaces(complex, normalized); // auto-generate lower-dimensional faces
}
```

### 2.3 Face Generation

When a simplex `[A, B, C]` is added, all its faces must also exist in the complex. This is what makes it mathematically valid. Generate them automatically on insertion.

**⚠ Subset Explosion Guard:** A 10-node simplex generates 2¹⁰ − 11 = 1,013 faces. A 15-node simplex generates 32,756. Without a cap, an accidentally large cluster causes a UI freeze.

**Rules:**
- **Hard cap:** Only auto-generate faces for simplices of dimension ≤ 4 (5 nodes). For anything larger, store the top-level simplex only and log a warning: `"Simplex too large for face generation (dim > 4). Faces not expanded."` 
- **Lazy evaluation:** Do not store all sub-faces at parse time for dim-4 simplices. Instead, compute faces on-demand when `InteractionController` or the renderer requests membership queries for a specific high-order simplex.

```typescript
const MAX_FACE_GEN_DIM = 4; // hard cap — simplices beyond this are stored but not expanded

function generateFaces(complex: SimplicialComplex, simplex: Simplex): void {
  const d = dim(simplex);
  if (d > MAX_FACE_GEN_DIM) {
    console.warn(`[Simplicial] Simplex dim=${d} exceeds cap. Faces not auto-generated.`);
    return; // store only, no expansion
  }
  const nodes = simplex.nodes;
  // Generate all proper subsets of size >= 2
  for (let size = 2; size < nodes.length; size++) {
    for (const subset of combinations(nodes, size)) {
      const key = normalizeKey(subset);
      if (!complex.simplices.has(key)) {
        // Auto-generated faces: no user metadata, marked accordingly
        complex.simplices.set(key, {
          nodes: [...subset].sort(),
          autoGenerated: true,
          userDefined: false,
        });
      }
    }
  }
}

// Lazy face query — used by renderer/interaction for large simplices
function getFacesLazy(simplex: Simplex, targetDim: number): NodeID[][] {
  return [...combinations(simplex.nodes, targetDim + 1)];
}

// Combination utility
function* combinations<T>(arr: T[], k: number): Generator<T[]> {
  if (k === 0) { yield []; return; }
  for (let i = 0; i <= arr.length - k; i++) {
    for (const rest of combinations(arr.slice(i + 1), k - 1)) {
      yield [arr[i], ...rest];
    }
  }
}
```

**Important:** Auto-generated faces should be visually distinguished (lighter rendering, no label in panel) from user-defined simplices, but stored with the same structure.

### 2.4 Simplex Dimension Enum

```typescript
// Dimension = number of nodes - 1
// dim 0 → point (node)
// dim 1 → edge (2 nodes)
// dim 2 → triangle / cluster (3 nodes)
// dim 3 → tetrahedron / core (4 nodes)
// dim 4+ → higher-order (v3 territory, not rendered in v1)

function dim(simplex: Simplex): number {
  return simplex.nodes.length - 1;
}
```

Cap rendered dimension at **3** in v1. Higher-order simplices are stored but not drawn (log a warning).

### 2.5 Encoding Syntax in Markdown / Frontmatter

Users define simplices directly inside their notes. Two supported syntaxes:

#### Option A — Inline shorthand (preferred for daily use)

```markdown
△ startup capital talent
△ startup regulation market
△△ startup product market users
```

- `△` = 2-simplex (triangle)
- `△△` = 3-simplex (tetrahedron / core)
- Space-separated node IDs following the symbol

#### Option B — YAML Frontmatter (preferred for metadata)

```yaml
---
simplices:
  - nodes: [startup, capital, talent]
    label: "founding engine"
    weight: 0.9
  - nodes: [startup, regulation, market]
    weight: 0.6
---
```

**Parser priority:** If both are present, YAML frontmatter wins for that note.

**Node ID resolution:** Node IDs in simplex syntax are matched to Obsidian notes using `app.metadataCache.getFirstLinkpathDest(id, sourcePath)`. This is the correct Obsidian API for resolving link-style node names — it respects aliases, folder context, and wikilink conventions.

```typescript
function resolveNodeId(rawId: string, sourcePath: string, app: App): TFile | null {
  return app.metadataCache.getFirstLinkpathDest(rawId.trim(), sourcePath);
}
```

The canonical `NodeID` stored in the model should be the **TFile path** (e.g. `"Philosophy/emergence.md"`), not the display title. Display title is derived at render time. This is what makes rename tracking possible.

If no matching file exists, create a virtual node (see §2.1 `isVirtual: true`), rendered as a hollow circle. Virtual nodes participate fully in the simplicial model — they are not second-class.

### 2.6 Metadata Schema

| Field | Type | Default | Semantics |
|---|---|---|---|
| `weight` | `number` (0.1–1) | `1.0` | Cohesion intensity. Affects blob density and force strength. Minimum 0.1 — zero weight is invisible and confusing. |
| `label` | `string \| null` | `null` | Optional human name for the simplex. Shown on hover in side panel. |
| `colorKey` | `string \| null` | `null` | Stable color bucket, derived from label hash on creation. Never user-set directly. Ensures "founding engine" is always the same color across restarts. |
| `autoGenerated` | `boolean` | `false` | Set to `true` for faces auto-created by face generation. Not user-editable. |
| `userDefined` | `boolean` | `true` | `false` for system-inferred suggestions not yet confirmed by user. |

**LayoutNode fields** (see §2.1 interface):

| Field | Type | Default | Semantics |
|---|---|---|---|
| `isVirtual` | `boolean` | `false` | Node exists in a simplex but has no corresponding vault file. |
| `isPinned` | `boolean` | `false` | User double-clicked — forces are ignored for this node. Persisted to plugin data. |
| `displayAlpha` | `number` | `1.0` | Current rendered opacity. Lerped toward target on each frame. Never set directly from interaction — always lerped. |

Weight is **felt, not displayed** — it drives visual density and force strength, never shown as a number in the UI.

### 2.7 Color Stability via Label Hash

Colors must be **deterministic across restarts**. A simplex should not change color because the plugin reloaded. Assign `colorKey` once at simplex creation time using a hash of the label:

```typescript
const COLOR_PALETTE = ['purple', 'teal', 'coral', 'pink', 'blue', 'amber'] as const;
type ColorKey = typeof COLOR_PALETTE[number];

function hashLabel(label: string | undefined): ColorKey {
  if (!label) return 'purple'; // default for unlabeled simplices
  // Simple, stable djb2 hash
  let h = 5381;
  for (let i = 0; i < label.length; i++) {
    h = ((h << 5) + h) ^ label.charCodeAt(i);
    h = h >>> 0; // unsigned 32-bit
  }
  return COLOR_PALETTE[h % COLOR_PALETTE.length];
}

// Called once when a simplex is first created or its label is first set
function assignColor(simplex: Simplex): Simplex {
  return { ...simplex, colorKey: hashLabel(simplex.label) };
}
```

**Rules:**
- `colorKey` is set on creation and updated only when the `label` changes.
- Auto-generated faces inherit the `colorKey` of their parent simplex.
- Unlabeled user-defined simplices use `'purple'` as neutral default.
- Rendering maps `colorKey` to the RGB triple used in §4.6.

---

## 3. Plugin Architecture

### 3.1 Component Overview

```
Vault (Markdown files)
       │
       ▼
┌─────────────┐
│  VaultIndex │  Watches file events, parses simplex syntax
└──────┬──────┘
       │ VaultEvents (stream of changes)
       ▼
┌──────────────────┐
│ SimplicialModel  │  Source of truth — stores nodes + simplices
└──────┬───────────┘
       │
       ├──────────────────────┐
       ▼                      ▼
┌──────────────┐    ┌──────────────────┐
│ LayoutEngine │    │ InteractionCtrl  │
│ (forces)     │    │ (hover, focus,   │
└──────┬───────┘    │  solidify)       │
       │            └────────┬─────────┘
       ▼                     │
┌──────────────┐             │
│   Renderer   │◄────────────┘
│  (Canvas 2D) │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ MetadataPanel│  Obsidian ItemView — label, weight slider
└──────────────┘
```

### 3.2 File Structure

```
simplicial-complex/
├── main.ts                   # Plugin entry — wires everything together
│
├── core/
│   ├── types.ts              # All TypeScript interfaces (Simplex, NodeID, etc.)
│   ├── model.ts              # SimplicialModel class
│   ├── faces.ts              # Face generation + combination utilities
│   ├── normalize.ts          # Key normalization, node ID resolution
│   └── hash.ts               # Label → colorKey hash (§2.7) — zero dependencies
│
├── data/
│   ├── vault-index.ts        # VaultIndex class — watches + parses vault
│   └── parser.ts             # Parses △ syntax and YAML frontmatter
│
├── layout/
│   └── engine.ts             # LayoutEngine — force simulation + sleep mode
│
├── render/
│   ├── renderer.ts           # Main Renderer class — draw loop
│   ├── blobs.ts              # Blob drawing: capsule-union metaball approach
│   └── edges.ts              # Edge deduplication + drawing
│
├── interaction/
│   └── controller.ts         # InteractionController — hover, focus, pin, repulsion
│
├── ui/
│   ├── view.ts               # Main canvas view (WorkspaceLeaf)
│   └── panel.ts              # MetadataPanel (ItemView)
│
├── manifest.json
└── styles.css
```

### 3.3 main.ts — Plugin Entry

```typescript
export default class SimplicialPlugin extends Plugin {
  model: SimplicialModel;
  index: VaultIndex;
  engine: LayoutEngine;
  renderer: Renderer;
  controller: InteractionController;

  async onload() {
    this.model   = new SimplicialModel();
    this.index   = new VaultIndex(this.app, this.model);
    this.engine  = new LayoutEngine(this.model);
    this.controller = new InteractionController(this.model);
    this.renderer = new Renderer(this.model, this.engine, this.controller);

    // Register the canvas view
    this.registerView('simplicial-view', leaf =>
      new SimplicialView(leaf, this.renderer, this.controller)
    );

    // Register the metadata panel
    this.registerView('simplicial-panel', leaf =>
      new MetadataPanel(leaf, this.model)
    );

    this.addRibbonIcon('network', 'Simplicial Graph', () => {
      this.activateView();
    });

    this.addCommand({
      id: 'open-simplicial',
      name: 'Open simplicial graph',
      callback: () => this.activateView(),
    });

    // Initial vault scan
    await this.index.fullScan();
  }

  async activateView() {
    this.app.workspace.detachLeavesOfType('simplicial-view');
    await this.app.workspace.getLeaf(true).setViewState({
      type: 'simplicial-view',
      active: true,
    });
  }

  onunload() {
    this.renderer.destroy();
    this.index.destroy();
  }
}
```

### 3.4 VaultIndex — Real-Time Vault Watcher

Responsibilities:
- Listen to `vault.on('modify')`, `vault.on('create')`, `vault.on('delete')`, **and `vault.on('rename')`**
- Parse simplex syntax from changed files
- Emit normalized `VaultEvent` objects to the model
- Debounce file events by **100ms** to prevent thrash
- **Content hashing** to break write→parse→write loops (replaces the write-lock flag from v0.1)

```typescript
type VaultEvent =
  | { type: 'node:add';    nodeId: NodeID }
  | { type: 'node:remove'; nodeId: NodeID }
  | { type: 'node:rename'; oldId: NodeID; newId: NodeID }  // NEW
  | { type: 'simplex:add'; simplex: Simplex }
  | { type: 'simplex:remove'; key: string };

class VaultIndex {
  // Content hashing — key: file path, value: hash of last content written by this plugin
  private lastWrittenHash: Map<string, number> = new Map();

  constructor(private app: App, private model: SimplicialModel) {
    this.app.vault.on('modify', debounce(this.onFileChange.bind(this), 100));
    this.app.vault.on('create', debounce(this.onFileChange.bind(this), 100));
    this.app.vault.on('delete', this.onFileDelete.bind(this));
    this.app.vault.on('rename', this.onFileRename.bind(this)); // NEW
  }

  // Call this after writing to a vault file — stores content hash to suppress own events
  recordWrite(path: string, content: string): void {
    this.lastWrittenHash.set(path, djb2Hash(content));
  }

  private async onFileChange(file: TFile) {
    const content = await this.app.vault.read(file);
    const currentHash = djb2Hash(content);

    // Suppress events caused by this plugin's own writes
    if (this.lastWrittenHash.get(file.path) === currentHash) {
      return; // our own write, skip re-parse
    }

    this.processFile(file, content);
  }

  private onFileRename(file: TFile, oldPath: string) {
    // oldPath is the full path before rename
    const oldId = oldPath;
    const newId  = file.path;
    this.model.updateNodeId(oldId, newId); // preserves px, py, pinned state
  }

  async fullScan() {
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      const content = await this.app.vault.read(file);
      this.processFile(file, content);
    }
  }

  private processFile(file: TFile, content: string) {
    this.model.setNode(file.path, { isVirtual: false });
    const simplices = parseSimplices(content, file.path, this.app);
    simplices.forEach(s => this.model.addSimplex(s));
  }
}

// Shared djb2 hash — same function used in §2.7 color hash and here
function djb2Hash(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
    h = h >>> 0;
  }
  return h;
}
```

### 3.5 SimplicialModel — Source of Truth

The model **never** contains UI or layout logic. It is pure, deterministic, and independently testable.

```typescript
class SimplicialModel {
  nodes: Map<NodeID, LayoutNode> = new Map();
  simplices: Map<string, Simplex> = new Map();

  // Public write API
  setNode(id: NodeID, opts?: Partial<Pick<LayoutNode, 'isVirtual'>>): void { ... }
  removeNode(id: NodeID): void { ... }

  // Rename support — preserves px, py, isPinned, displayAlpha
  updateNodeId(oldId: NodeID, newId: NodeID): void {
    const existing = this.nodes.get(oldId);
    if (!existing) return;
    this.nodes.set(newId, { ...existing, id: newId });
    this.nodes.delete(oldId);
    // Update all simplex node arrays that reference oldId
    this.simplices.forEach((s, key) => {
      if (s.nodes.includes(oldId)) {
        const updated = { ...s, nodes: s.nodes.map(n => n === oldId ? newId : n).sort() };
        this.simplices.delete(key);
        this.simplices.set(normalizeKey(updated.nodes), updated);
      }
    });
  }

  addSimplex(s: Simplex): void { /* normalize + generateFaces + assignColor */ }
  removeSimplex(key: string): void { /* remove + cleanup orphan auto-faces */ }
  updateMetadata(key: string, meta: Partial<Pick<Simplex, 'label' | 'weight'>>): void {
    // If label changed, recompute colorKey
    const s = this.simplices.get(key);
    if (!s) return;
    const updated = { ...s, ...meta };
    if (meta.label !== undefined) updated.colorKey = hashLabel(meta.label);
    this.simplices.set(key, updated);
  }

  // Public read API
  getSimplicesForNode(id: NodeID): Simplex[] { ... }
  getNeighbors(id: NodeID): NodeID[] { ... }
  getSimplicesByDim(dim: number): Simplex[] { ... }
  getAllNodes(): LayoutNode[] { ... }
}
```

**Critical invariant:** `SimplicialModel` never touches canvas, DOM, or Obsidian workspace APIs. If you find yourself importing from `obsidian` inside `model.ts`, stop — it belongs in a different layer.

### 3.6 Obsidian API Surface Used

| API | Where Used | Purpose |
|---|---|---|
| `vault.on('modify/create/delete')` | VaultIndex | Real-time file watching |
| `vault.read(file)` | VaultIndex | Read file content for parsing |
| `vault.getMarkdownFiles()` | VaultIndex | Full vault scan on load |
| `Plugin.registerView()` | main.ts | Register canvas view + panel |
| `WorkspaceLeaf` | view.ts | Host the canvas element |
| `ItemView` | panel.ts | Side panel for metadata |
| `Plugin.addCommand()` | main.ts | Command palette integration |
| `Plugin.addRibbonIcon()` | main.ts | Sidebar button |
| `app.workspace.getLeaf()` | main.ts | Open views |
| `Menu` (ContextMenu) | controller.ts | Right-click → "Form simplex" |

Do **not** use:
- `MetadataCache` for link resolution — use your own node resolution
- Obsidian's built-in graph API — it's pairwise and not extensible

---

## 4. Rendering Pipeline

### 4.1 Canvas Setup

```typescript
class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr: number;
  private W: number = 0;
  private H: number = 0;
  private animFrame: number | null = null;

  init(container: HTMLElement) {
    this.canvas = container.createEl('canvas');
    this.ctx = this.canvas.getContext('2d')!;
    this.dpr = window.devicePixelRatio || 1;
    this.resize();
    window.addEventListener('resize', this.resize.bind(this));
    this.startLoop();
  }

  private resize() {
    const r = this.canvas.parentElement!.getBoundingClientRect();
    this.W = r.width;
    this.H = r.height;
    this.canvas.width  = this.W * this.dpr;
    this.canvas.height = this.H * this.dpr;
    this.canvas.style.width  = `${this.W}px`;
    this.canvas.style.height = `${this.H}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }
}
```

### 4.2 Rendering Layer Order

Each frame draws layers in strict order (painter's algorithm):

```
1. Clear canvas
2. Simplex blobs — dim 3 (cores)      ← largest, most transparent, drawn first
3. Simplex blobs — dim 2 (clusters)   ← medium
4. Simplex blobs — dim 1 (edges/caps) ← smallest
5. Edge lines                          ← thin, low opacity
6. Node halos (hovered node only)
7. Node circles
8. Node labels
```

Each blob layer is itself drawn in three passes for the soft glow effect (see §4.5).

### 4.3 Force Simulation (LayoutEngine)

The layout is a **continuous simulation** — never fully settled, always breathing gently. However, a perpetual `requestAnimationFrame` loop drains battery. The engine implements a **sleep/wake cycle** based on total kinetic energy.

```typescript
class LayoutEngine {
  private REPULSION   = 2400;
  private COHESION    = 0.005;
  private GRAVITY     = 0.0007;
  private NOISE       = 0.12;
  private DAMPING     = 0.84;

  // Sleep mode
  private SLEEP_THRESHOLD = 0.01;  // total kinetic energy below this → sleep
  private isAsleep = false;
  private animFrame: number | null = null;

  start(renderFn: () => void) {
    const loop = () => {
      this.tick(/* nodes, simplices, bounds */);
      renderFn();
      if (!this.isAsleep) {
        this.animFrame = requestAnimationFrame(loop);
      }
    };
    this.animFrame = requestAnimationFrame(loop);
  }

  wake() {
    if (this.isAsleep) {
      this.isAsleep = false;
      this.start(this.renderFn); // restart loop
    }
  }

  tick(nodes: LayoutNode[], simplices: Simplex[], bounds: Rect) {
    // ... (repulsion, cohesion, gravity, noise, integration — see below)

    // Sleep check — after integration
    const kineticEnergy = nodes.reduce((sum, n) => sum + n.vx * n.vx + n.vy * n.vy, 0);
    if (kineticEnergy < this.SLEEP_THRESHOLD) {
      this.isAsleep = true; // loop will not re-schedule next frame
    }
  }
}
```

**Wake triggers:** Call `engine.wake()` from `InteractionController` on:
- `mousemove` entering canvas
- `vault.on('modify')` / `vault.on('create')` events
- Any simplex add/remove in model

**Sleep is transparent to the user** — the last rendered frame persists on canvas. On wake, the simulation resumes from current positions with no visual jump.

```typescript
  tick(nodes: LayoutNode[], simplices: Simplex[], bounds: Rect) {
    // 1. Node-node repulsion (O(n²), acceptable for n < 200)
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const dx = b.px - a.px, dy = b.py - a.py;
        const d2 = dx * dx + dy * dy + 1;
        const f  = this.REPULSION / d2;
        a.vx -= f * dx; a.vy -= f * dy;
        b.vx += f * dx; b.vy += f * dy;
      }

    // 2. Simplex cohesion
    simplices.forEach(s => {
      const ns = s.nodes.map(id => nodes.find(n => n.id === id)).filter(Boolean);
      const cx = ns.reduce((a, n) => a + n!.px, 0) / ns.length;
      const cy = ns.reduce((a, n) => a + n!.py, 0) / ns.length;
      const w  = s.weight ?? 1.0;
      ns.forEach(n => {
        n!.vx += (cx - n!.px) * this.COHESION * w;
        n!.vy += (cy - n!.py) * this.COHESION * w;
      });
    });

    // 3. Center gravity + noise + integrate
    const cx = bounds.width / 2, cy = bounds.height / 2;
    nodes.forEach(n => {
      if (n.isPinned) return; // pinned nodes ignore all forces
      n.vx += (cx - n.px) * this.GRAVITY + (Math.random() - 0.5) * this.NOISE;
      n.vy += (cy - n.py) * this.GRAVITY + (Math.random() - 0.5) * this.NOISE;
      n.vx *= this.DAMPING;
      n.vy *= this.DAMPING;
      n.px  = Math.max(50, Math.min(bounds.width  - 50, n.px + n.vx));
      n.py  = Math.max(50, Math.min(bounds.height - 50, n.py + n.vy));
    });

    // Sleep check
    const ke = nodes.reduce((s, n) => s + n.vx * n.vx + n.vy * n.vy, 0);
    if (ke < this.SLEEP_THRESHOLD) this.isAsleep = true;
  }
```

**Tuning notes:**
- If nodes are too clustered → increase `REPULSION`
- If clusters feel loose → increase `COHESION` or `weight` values
- If layout sleeps too quickly / feels stiff → decrease `SLEEP_THRESHOLD`
- If layout never calms → increase `DAMPING` toward 0.92
- For n > 150 nodes: replace O(n²) repulsion loop with Barnes–Hut quad-tree

### 4.4 Blob Geometry Utilities

The convex hull approach fails for non-convex node arrangements (L-shapes, rings). The **capsule-union metaball** approach handles any topology correctly without needing alpha shape geometry.

**Core idea:** Render the blob as the union of all pairwise capsules between simplex nodes, drawn with `globalCompositeOperation = 'source-over'` into an offscreen canvas, then composite the result with a blur pass to achieve organic softness.

```typescript
// Blob rendering into offscreen canvas — called once per simplex per frame
function renderBlobToOffscreen(
  simplex: Simplex,
  nodes: LayoutNode[],
  blobR: number
): HTMLCanvasElement {
  const ns = resolveNodes(simplex, nodes);
  if (!ns.length) return emptyCanvas();

  // Size the offscreen canvas to the bounding box + margin
  const xs = ns.map(n => n.px), ys = ns.map(n => n.py);
  const margin = blobR * 2.5;
  const x0 = Math.min(...xs) - margin, y0 = Math.min(...ys) - margin;
  const w  = Math.max(...xs) - x0 + margin, h = Math.max(...ys) - y0 + margin;

  const oc = document.createElement('canvas');
  oc.width = w; oc.height = h;
  const octx = oc.getContext('2d')!;
  octx.translate(-x0, -y0);

  // Draw a capsule for every pair of nodes
  octx.fillStyle = '#ffffff';
  if (ns.length === 1) {
    octx.beginPath();
    octx.arc(ns[0].px, ns[0].py, blobR, 0, Math.PI * 2);
    octx.fill();
  } else {
    for (let i = 0; i < ns.length; i++) {
      for (let j = i + 1; j < ns.length; j++) {
        drawCapsule(octx, { x: ns[i].px, y: ns[i].py }, { x: ns[j].px, y: ns[j].py }, blobR);
        octx.fill();
      }
      // Also draw a circle at each node center to fill gaps
      octx.beginPath();
      octx.arc(ns[i].px, ns[i].py, blobR, 0, Math.PI * 2);
      octx.fill();
    }
  }

  // Apply blur for organic softness — this is the metaball effect
  octx.filter = `blur(${blobR * 0.5}px)`;
  // (Blur applied by compositing back to main canvas below)
  return oc;
}

// Composite the offscreen blob onto the main canvas with color + alpha
function compositeBlob(
  ctx: CanvasRenderingContext2D,
  oc: HTMLCanvasElement,
  color: [number,number,number],
  alpha: number,
  offset: { x: number, y: number }
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.filter = `blur(${12}px)`; // softening pass on composite
  ctx.drawImage(oc, offset.x, offset.y);
  ctx.filter = 'none';
  // Tint: multiply mode approximated via globalCompositeOperation
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
  ctx.fillRect(offset.x, offset.y, oc.width, oc.height);
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
}
```

**Performance note:** Offscreen canvas creation is cheap but `ctx.filter = blur()` can be expensive on large canvases. Cache the offscreen canvas per simplex and only redraw it when node positions change significantly (threshold: any node moves > 2px since last blobrender).

**Collinear node fallback:** If all nodes are collinear (detected by checking if the cross products of consecutive vectors are all near-zero), draw a single elongated capsule along the axis. This avoids the degenerate case where `sortByAngle` produces identical angles.

### 4.5 Blob Rendering — Three-Pass Glow

Each simplex is drawn in **three concentric passes** to achieve organic softness:

```typescript
function renderBlob(
  ctx: CanvasRenderingContext2D,
  simplex: Simplex,
  nodes: LayoutNode[],
  baseAlpha: number,
  focusState: FocusState
): void {
  const ns  = resolveNodes(simplex, nodes);
  if (!ns.length) return;

  const [r, g, b] = colorForSimplex(simplex);
  const blobR     = 36 + (simplex.weight ?? 1.0) * 24 + (dim(simplex) === 3 ? 20 : 0);

  // Determine effective alpha based on focus state
  const alpha = focusState.isActive
    ? (focusState.involvesSimplex(simplex) ? baseAlpha : baseAlpha * 0.18)
    : baseAlpha;

  // Pass 1 — outer haze
  ctx.fillStyle = `rgba(${r},${g},${b},${alpha * 0.15})`;
  drawBlobShape(ctx, ns, blobR * 2.0);
  ctx.fill();

  // Pass 2 — middle glow
  ctx.fillStyle = `rgba(${r},${g},${b},${alpha * 0.42})`;
  drawBlobShape(ctx, ns, blobR * 1.38);
  ctx.fill();

  // Pass 3 — core fill
  ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
  drawBlobShape(ctx, ns, blobR);
  ctx.fill();
}

function drawBlobShape(
  ctx: CanvasRenderingContext2D,
  ns: LayoutNode[],
  blobR: number
): void {
  const pts = ns.map(n => ({ x: n.px, y: n.py }));
  if (ns.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, blobR, 0, Math.PI * 2);
  } else if (ns.length === 2) {
    drawCapsule(ctx, pts[0], pts[1], blobR);
  } else {
    drawSmoothClosed(ctx, expandPoints(sortByAngle(pts), blobR));
  }
}
```

### 4.6 Simplex Color Assignment

Colors are fixed per semantic role, not dynamically assigned. Use these as defaults:

```typescript
const SIMPLEX_COLORS: Record<string, [number, number, number]> = {
  'default-purple': [127, 119, 221],   // cognitive / foundational clusters
  'default-teal':   [29,  158, 117],   // growth / product clusters
  'default-coral':  [216, 90,  48],    // context / constraint clusters
  'neutral':        [136, 135, 128],   // auto-generated faces, unclassified
};
```

Color assignment strategy:
1. If simplex has a `label`, map to a semantic color bucket (user-defined mapping or auto-assigned on creation)
2. If auto-generated face → `neutral`
3. Future v2: let users assign colors per simplex via metadata

### 4.7 Base Alpha Values by Dimension

| Dimension | Default Alpha | Focused Alpha | Unfocused Alpha |
|---|---|---|---|
| dim 1 (edge/capsule) | 0.10 | 0.18 | 0.03 |
| dim 2 (cluster/triangle) | 0.13 | 0.18 | 0.03 |
| dim 3 (core/tetrahedron) | 0.07 | 0.11 | 0.02 |

Dim-3 simplices are intentionally more transparent — they span many nodes and would overwhelm the visual if too opaque.

### 4.8 Node Rendering

```typescript
function renderNode(
  ctx: CanvasRenderingContext2D,
  node: LayoutNode,
  isHovered: boolean,
  isActive: boolean,
  primarySimplex: Simplex | null,
  isDark: boolean
): void {
  const alpha  = isActive ? 1.0 : 0.20;
  const radius = isHovered ? 7 : 5;
  const [r, g, b] = primarySimplex ? colorForSimplex(primarySimplex) : SIMPLEX_COLORS['neutral'];

  // Halo for hovered node
  if (isHovered) {
    ctx.beginPath();
    ctx.arc(node.px, node.py, 15, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${r},${g},${b},0.10)`;
    ctx.fill();
  }

  // Node circle
  ctx.beginPath();
  ctx.arc(node.px, node.py, radius, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
  ctx.fill();

  // Label
  ctx.font    = `${isHovered ? '500' : '400'} 12px system-ui, sans-serif`;
  ctx.fillStyle  = isDark
    ? `rgba(255,255,255,${isActive ? 0.78 : 0.16})`
    : `rgba(0,0,0,${isActive ? 0.62 : 0.16})`;
  ctx.textAlign  = 'center';
  ctx.fillText(node.id, node.px, node.py - 13);
}
```

### 4.9 Edge Rendering

Edges are drawn **once per unique node pair** even if they appear in multiple simplices. Use a `Set<string>` to deduplicate:

```typescript
function renderEdges(
  ctx: CanvasRenderingContext2D,
  simplices: Simplex[],
  nodes: Map<NodeID, LayoutNode>,
  showEdges: boolean,
  focusState: FocusState
): void {
  if (!showEdges) return;
  const drawn = new Set<string>();

  simplices.forEach(s => {
    const ns = s.nodes.map(id => nodes.get(id)).filter(Boolean) as LayoutNode[];
    const isActive = !focusState.isActive || focusState.involvesSimplex(s);
    const [r, g, b] = colorForSimplex(s);

    for (let i = 0; i < ns.length; i++)
      for (let j = i + 1; j < ns.length; j++) {
        const key = [ns[i].id, ns[j].id].sort().join('|');
        if (drawn.has(key)) continue;
        drawn.add(key);
        ctx.strokeStyle = `rgba(${r},${g},${b},${isActive ? 0.22 : 0.06})`;
        ctx.lineWidth   = isActive ? 1 : 0.5;
        ctx.beginPath();
        ctx.moveTo(ns[i].px, ns[i].py);
        ctx.lineTo(ns[j].px, ns[j].py);
        ctx.stroke();
      }
  });
}
```

---

## 5. UX & Interaction Spec

### 5.1 Interaction Philosophy

> Interaction should **reveal structure**, not manipulate layout.

The user never drags nodes. Never forces layout. The system responds to attention — hover focuses, move away releases.

All interactions have **no required actions**: you can open the view and just watch. Every interactive feature is additive.

### 5.2 Hover — Focus Mode

**Trigger:** Cursor within 20px of a node center.

**Effect:**
- Hovered node: full opacity, halo ring, enlarged (r=7)
- Simplices containing hovered node: full opacity
- Nodes connected to hovered node (via any shared simplex): full opacity
- Everything else: fades to ~20% opacity (not invisible — still perceptible)
- Side panel: shows node name + cluster memberships

**Release:** Cursor moves away → all fades restored over ~150ms (lerp on `displayAlpha` in render loop, not instant snap)

**Transition timing:** Use linear interpolation per frame — `displayAlpha = lerp(displayAlpha, targetAlpha, 0.12)`. Do not use CSS transitions.

```typescript
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
```

### 5.3 Node Pinning (Double-Click)

**Problem it solves:** If two nodes overlap due to identical simplex memberships, the user cannot read their labels. Without dragging, there is no way to separate them.

**Solution — two-part interaction:**

**Part A: Click-and-hold repulsion**
- User clicks and holds a node (> 200ms hold threshold)
- `InteractionController` applies a temporary `HOLD_REPULSION` force (3× normal repulsion) radially outward from that node to all neighbors
- Neighbors push away gently; labels become readable
- Force stops when mouse is released
- Engine wakes if sleeping

```typescript
// In InteractionController
onMousedown(nodeId: NodeID) {
  this.holdTimer = setTimeout(() => {
    this.holdNode = nodeId;
    engine.wake();
  }, 200);
}
onMouseup() {
  clearTimeout(this.holdTimer);
  this.holdNode = null;
}

// In LayoutEngine.tick — after normal forces
if (controller.holdNode) {
  const held = nodes.find(n => n.id === controller.holdNode);
  if (held) {
    nodes.forEach(n => {
      if (n === held) return;
      const dx = n.px - held.px, dy = n.py - held.py;
      const d2 = dx * dx + dy * dy + 1;
      n.vx += (dx / d2) * HOLD_REPULSION;
      n.vy += (dy / d2) * HOLD_REPULSION;
    });
  }
}
```

**Part B: Double-click to pin**
- Double-click a node → `node.isPinned = true`
- Pin indicator: small lock icon (or filled diamond) rendered above the node label
- Pinned node ignores all LayoutEngine forces (see §4.3 tick — `if (n.isPinned) return`)
- Double-click again to unpin
- Pinned node positions are **persisted to plugin data** (survive reload)

```typescript
// Persistence structure in plugin data
interface PinnedState {
  [nodeId: string]: { px: number; py: number };
}
```

### 5.4 Dimension Filter

**UI element:** Three toggle buttons at bottom-left: `edges` / `clusters` / `cores`

**Behavior:**
- `edges` on/off → show/hide dim-1 simplex capsules and all edge lines
- `clusters` on/off → show/hide dim-2 simplex blobs
- `cores` on/off → show/hide dim-3 simplex blobs

All three default to **on**. State persists in plugin settings (`app.saveData()`).

**Important:** Toggling does not affect the underlying model. It is purely a rendering filter.

### 5.4 Solidify Action — Creating Simplices

This is the primary creative interaction.

**Method 1 — Lasso select (v2, optional)**
- Hold `Shift`, click-drag a region
- All nodes within lasso are selected
- "Form simplex" prompt appears
- User confirms → simplex created in model + written to a designated vault file

**Method 2 — Command palette (v1, ship this first)**
- Open command palette: `Simplicial: Form simplex from open note`
- Plugin reads current note's links → suggests candidate simplex
- User confirms or modifies node list
- Simplex written to note's frontmatter

**Method 3 — Suggestion + click (v2)**
- Plugin detects closed triads (A–B, B–C, A–C) automatically
- Renders a faint dotted outline around the potential simplex
- "Form?" label on hover
- Click to confirm

**On confirmation:**
- Simplex added to `SimplicialModel`
- Written to persistent storage (see §5.7)
- Visual: existing blob solidifies slightly (damping noise reduced for that simplex for ~2 seconds)

### 5.5 Metadata Panel

**Location:** Right-side Obsidian leaf (`ItemView`)  
**Trigger:** Click a simplex blob OR hover for 1+ second

**Panel content:**

```
┌─────────────────────────┐
│  SIMPLEX                │
│                         │
│  Nodes                  │
│  startup · capital ·    │
│  talent                 │
│                         │
│  Label                  │
│  [founding engine     ] │ ← text input, optional
│                         │
│  Weight                 │
│  ●────────○──────────○  │ ← slider, 0.0–1.0, step 0.1
│  0.9                    │
│                         │
│  [ Promote to note ↗ ]  │ ← creates a new Obsidian note
│                         │
│  dim: 2  ·  auto: no    │ ← metadata footer
└─────────────────────────┘
```

**Label field behavior:**
- Optional — shows placeholder "unnamed" if empty
- On change: updates model + saves to frontmatter of the note that defined this simplex
- 500ms debounce before write

**Weight slider behavior:**
- Changes `simplex.weight` in model immediately (live preview in canvas)
- Saves to frontmatter on `mouseup`
- Minimum value: 0.1 (do not allow 0 — zero weight simplex is invisible and confusing)

**Promote to note button:**
- Creates a new Obsidian note titled after the simplex label (or `simplex-<key>` if no label)
- The new note's content is pre-filled with links to all member nodes
- The simplex entry in the source note is updated to reference this new node too
- This creates a "conceptual compression" — the cluster becomes a first-class note

### 5.6 Contextual Right-Click Menu

Right-clicking a node shows:

```
startup
──────────────────
Open note
Focus here
──────────────────
Add to simplex...
Remove from complex
```

Right-clicking a simplex blob:

```
founding engine
──────────────────
Edit metadata
Dissolve simplex
──────────────────
Show in formal view  (v3)
```

### 5.7 Persistence of User-Defined Simplices

Simplices are persisted **inside vault files** — not in a separate plugin database. This is essential: the vault stays the source of truth.

#### Mode A — Frontmatter-First (Recommended Default)

Write simplex definitions to the **YAML frontmatter of the note they conceptually belong to**. This is more Obsidian-native, distributes data across the vault (reducing single-file corruption risk), and plays well with Obsidian Sync — each note conflict is local and bounded.

```yaml
---
# startup.md
simplices:
  - nodes: [startup, capital, talent]
    label: "founding engine"
    weight: 0.9
  - nodes: [startup, regulation, market]
    label: "market context"
    weight: 0.6
---
```

**Write loop prevention:** After writing to a note's frontmatter, record a content hash to suppress the resulting `vault.on('modify')` event (see `VaultIndex.recordWrite()`). This replaces the write-lock flag from v0.1, which fails under Obsidian Sync.

```typescript
// After writing frontmatter:
const newContent = serializeFrontmatter(file, updatedSimplices);
await app.vault.modify(file, newContent);
vaultIndex.recordWrite(file.path, newContent); // suppress own event
```

**Multi-device / Obsidian Sync:** When Device B receives a file change, it parses and re-imports from frontmatter. Since simplices are stored in the file itself, sync is convergent — no separate state file to conflict.

#### Mode B — Central File

Write all simplices to `_simplicial.md` in the vault root. Simpler for read-heavy setups, but creates a single point of failure and is more prone to sync conflicts in multi-device use.

```markdown
<!-- _simplicial.md — managed by Simplicial Complex Plugin -->

△ startup capital talent
label: founding engine
weight: 0.9

△△ startup product market users
label: growth loop
weight: 0.5
```

**Sync conflict mitigation for Mode B:** The `VaultIndex` uses `djb2Hash` on file content (same function as §2.7). On `modify` event, if `hash(currentContent) === lastWrittenHash`, the event is suppressed entirely. This handles the case where Obsidian Sync delivers the plugin's own write back as an external change.

**Default setting:** `persistenceMode: 'source-note'` (Mode A). Users can switch to `'central-file'` in settings.

### 5.8 Settings Page

```typescript
interface PluginSettings {
  // Persistence
  persistenceMode: 'source-note' | 'central-file'; // default: 'source-note'
  centralFile: string;                              // default: '_simplicial.md'

  // Rendering filters (persisted)
  showEdges: boolean;                               // default: true
  showClusters: boolean;                            // default: true
  showCores: boolean;                               // default: true
  maxRenderedDim: number;                           // default: 3 (cap at 3, store higher)

  // Layout behaviour
  noiseAmount: number;                              // default: 0.12 (breathing intensity)
  sleepThreshold: number;                           // default: 0.01 (kinetic energy cutoff)

  // Appearance
  darkMode: 'auto' | 'force-light' | 'force-dark'; // default: 'auto'

  // Node state (persisted across sessions)
  pinnedNodes: { [nodeId: string]: { px: number; py: number } };
}
```

### 5.9 Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl/Cmd + Shift + G` | Open simplicial graph view |
| `Ctrl/Cmd + Shift + S` | Insert `△ ` at cursor in active note (△ input workaround) |
| `Escape` | Clear focus / deselect / unpin pinned focus |
| `1` | Toggle edges |
| `2` | Toggle clusters |
| `3` | Toggle cores |
| `F` | Focus on hovered node (locks focus until Escape) |
| `P` | Open metadata panel for hovered simplex |
| Double-click node | Toggle pin (fixes position, persists across reload) |
| Click-and-hold node | Momentary repulsion — push overlapping neighbors apart |

The `Ctrl/Cmd + Shift + S` shortcut is registered as an Obsidian editor command (not a global command), so it only fires when a markdown editor is focused. It inserts the literal `△ ` character followed by a space, leaving the cursor ready to type node names.

---

## 6. Phased Roadmap

### Phase 1 — Core (Ship This)

- [ ] `core/types.ts` — interfaces (Simplex, LayoutNode with isVirtual/isPinned/displayAlpha)
- [ ] `core/normalize.ts` — `normalizeKey` with `.toLowerCase()`, `resolveNodeId` via `metadataCache`
- [ ] `core/hash.ts` — `djb2Hash` shared by color assignment + write-loop prevention
- [ ] `core/faces.ts` — face generation with dim ≤ 4 hard cap + `getFacesLazy`
- [ ] `core/model.ts` — `SimplicialModel` with `updateNodeId` for rename support
- [ ] `data/parser.ts` — △ syntax + YAML frontmatter parser
- [ ] `data/vault-index.ts` — file watcher with `vault.on('rename')` + content hash suppression
- [ ] `layout/engine.ts` — force simulation with sleep/wake cycle + pinned node bypass
- [ ] `render/blobs.ts` — capsule-union metaball renderer (offscreen canvas + blur composite)
- [ ] `render/renderer.ts` — main draw loop, layer order, lerp on `displayAlpha`
- [ ] `interaction/controller.ts` — hover, click-and-hold repulsion, double-click pin
- [ ] `ui/view.ts` — canvas leaf with resize handling + dark mode detection
- [ ] `ui/panel.ts` — metadata panel (label input, weight slider, promote button)
- [ ] Persistence to note frontmatter (Mode A default) + content hash write guard
- [ ] `Ctrl/Cmd + Shift + S` editor command for △ insertion
- [ ] Settings page with all fields from §5.8
- [ ] Pinned node positions persisted to plugin data

### Phase 2 — Interaction

- [ ] Lasso-select to create simplex (Shift + drag)
- [ ] System-suggested closures — triad detection + dotted outline UI
- [ ] Promote to note (conceptual compression — see §5.5)
- [ ] Right-click context menus for nodes and simplex blobs
- [ ] Mode B persistence (central `_simplicial.md`) as user-selectable option
- [ ] Virtual node styling (hollow circles, distinct from real notes)

### Phase 3 — Formal Mode + Analysis

- [ ] Toggle: Organic View ↔ Formal/Geometric View (crisp triangles, wireframe tetras)
- [ ] Betti number display (connected components, holes, voids)
- [ ] Simplex centrality (nodes with highest simplex membership count)
- [ ] Gap detection ("A–B and B–C exist but not A–C — close this triangle?")
- [ ] Filtration slider (show only simplices with weight ≥ threshold)
- [ ] Barnes–Hut quad-tree repulsion for vaults > 150 nodes

---

## 7. Known Constraints & Open Questions

### Constraints

| Area | Constraint | Status |
|---|---|---|
| **Performance — layout** | Force simulation is O(n²). Sleep mode (§4.3) mitigates CPU drain at rest. For n > 150, replace with Barnes–Hut quad-tree. | Mitigated in v1, full fix in v3 |
| **Performance — blobs** | Offscreen canvas + blur per simplex is expensive if redrawn every frame. Cache offscreen canvas; only redraw when any member node moves > 2px. | Must implement cache |
| **Face explosion** | A k-node simplex generates 2ᵏ − k − 1 faces. Hard cap at dim ≤ 4 + lazy evaluation above that (§2.3). | Resolved |
| **Concave blobs** | Convex hull misrepresents L-shaped node groups. Replaced with capsule-union metaball renderer (§4.4). | Resolved |
| **Rename tracking** | Notes renamed in Obsidian would break simplex references. `vault.on('rename')` → `model.updateNodeId()` preserves positions (§3.4). | Resolved |
| **Write→parse loop** | Plugin writes to vault file, triggering its own `modify` event. Content hashing in `VaultIndex.recordWrite()` suppresses own events (§3.4, §5.7). | Resolved |
| **Canvas text + dark mode** | Canvas 2D text doesn't inherit CSS variables. Detect via `matchMedia('(prefers-color-scheme:dark)')` at init; re-detect on Obsidian theme change event. | Must implement |
| **`△` input** | U+25B3 is not typeable on most keyboards. `Ctrl/Cmd + Shift + S` editor command inserts it (§5.9). Also accept `simplex:` as alternative keyword in parser. | Resolved |
| **Node ID canonicalization** | `normalizeKey` must use `.toLowerCase().trim()` — Obsidian is case-insensitive for titles. Canonical ID = TFile path, not display title. | Resolved |

### Open Questions — Decisions Made

The following questions from v0.1 are now resolved:

1. **Multi-vault support:** Out of scope for v1. Index current vault only. Revisit if explicitly requested.

2. **Virtual nodes:** ✅ Create virtual node (`isVirtual: true`), rendered as hollow circle. Participates fully in model and layout.

3. **Link-inferred vs. simplex-defined edges:** ✅ Simplex takes priority. If a simplex edge covers a raw link edge between two notes, suppress the raw link edge in rendering. Avoids double-drawing.

4. **Simplex dissolution on `△` deletion:** ✅ Yes — remove simplex and clean up auto-generated orphan faces immediately. Apply brief visual dissolve (blob alpha lerps to 0 over 400ms before removal from render list).

5. **Concurrent edits to `_simplicial.md`:** ✅ Resolved via content hashing (§3.4) + frontmatter-first default (§5.7). Write-lock flag from v0.1 is deprecated — it fails under Obsidian Sync.

### Remaining Open Questions

1. **Alias resolution:** Obsidian notes can have `aliases` in frontmatter. Should a node named `"VC"` in a simplex resolve to a note whose alias is `"VC"` but whose title is `"Venture Capital"`? Recommendation: yes — use `metadataCache` alias resolution. Requires additional lookup step in `resolveNodeId`.

2. **Simplex ownership on promote-to-note:** When a simplex is promoted to a note (§5.5), which file owns the simplex definition going forward — the new note, or the original source note? Recommendation: transfer ownership to the new note; update source note's frontmatter to remove the simplex entry.

---

## 8. Critical Implementation Checklist

These are the items most likely to cause hard-to-debug failures if skipped or done out of order. Complete them before writing any rendering or UI code.

### Must Do First (Before Any Other Code)

- [ ] **Define `normalizeKey` with `.toLowerCase().trim()`** in `core/normalize.ts`. Every other module depends on this. Write a unit test: `normalizeKey(["Talent", "STARTUP", "capital"])` must equal `normalizeKey(["startup", "talent", "capital"])`.

- [ ] **Define the canonical NodeID as TFile path**, not display title. A function `resolveNodeId(rawLabel, sourcePath, app) → TFile | null` must be the single resolution point. Never resolve node IDs inline anywhere else.

- [ ] **Write `djb2Hash` once in `core/hash.ts`**, export it, and import it everywhere it's needed (color assignment in §2.7 and write-loop suppression in §3.4). Do not duplicate the implementation.

- [ ] **Implement the dim ≤ 4 hard cap in `generateFaces`** before running any real vault data through the model. Test with a 6-node simplex and confirm faces are not expanded.

### Must Do Before Rendering

- [ ] **Register `vault.on('rename')`** in VaultIndex and wire it to `model.updateNodeId()`. If you skip this, renaming any note silently breaks all simplices containing it.

- [ ] **Implement `VaultIndex.recordWrite(path, content)`** and the hash-check guard in `onFileChange` before writing any persistence code. Without this, every plugin write triggers a redundant re-parse.

- [ ] **Implement the sleep/wake cycle** in LayoutEngine before shipping. A perpetual `requestAnimationFrame` in Obsidian will cause visible CPU usage and battery drain even on an idle vault.

- [ ] **Cache offscreen canvases per simplex** in the blob renderer. Recreating and blurring a canvas every frame for every simplex will cause frame drops even with 10 simplices.

### Must Do Before Release

- [ ] **Register `Ctrl/Cmd + Shift + S`** as an Obsidian editor command that inserts `△ `. Without this, onboarding a new user requires explaining a Unicode character entry method — and most won't bother.

- [ ] **Persist pinned node positions** to `app.saveData()` on every pin/unpin event. If pinned positions are lost on reload, the interaction feels broken.

- [ ] **Dark mode detection:** Call `matchMedia('(prefers-color-scheme:dark)').matches` at canvas init and store the result. Register a listener on Obsidian's `'css-change'` event to re-detect and redraw when the user switches themes.

- [ ] **Test alias resolution** — create a note with `aliases: [VC]` in frontmatter, reference it as `△ startup VC talent` in a simplex, and confirm it resolves correctly via `metadataCache`.

---

*End of specification — v0.2*

*Implementation entry point: `core/types.ts` → `core/normalize.ts` → `core/hash.ts` → `core/faces.ts` → `core/model.ts`. These five files have zero Obsidian API dependencies and are fully unit-testable. Write tests for them before touching the plugin scaffolding.*



# Appendix A: Layout Engine Physics & Implementation Details

This appendix provides the mathematical foundation and technical implementation details for the **LayoutEngine**. The goal of the engine is to maintain an "organic, breathing" layout while ensuring mathematical stability across higher-order simplicial structures.

---

## A.1 Node-Node Repulsion (Inverse-Square Law)

To prevent node overlap and ensure visual clarity, a global repulsion force is applied between every pair of nodes. This follows an **Inverse-Square Law** to simulate electrostatic repulsion.

**Formula:**
$$F_r = \frac{G}{d^2 + \epsilon}$$

| Variable | Value | Description |
| :--- | :--- | :--- |
| $G$ | 2400 | Global repulsion constant |
| $d$ | $dist(a, b)$ | Euclidean distance between nodes $a$ and $b$ |
| $\epsilon$ | 1.0 | Softening constant to prevent division by zero |

---

## A.2 Simplex Cohesion (Centroid Attraction)

Simplices act as "gravitational wells". Nodes belonging to the same simplex are pulled toward the geometric center (**centroid**) of that cluster rather than toward each other individually.

**Implementation Logic:**
1.  **Calculate Centroid ($C$):** The arithmetic mean of all node positions in the simplex: 
    $$C = \frac{1}{k} \sum_{i=1}^{k} n_i$$
2.  **Apply Attraction Force:** Each node $n_i$ is pulled toward $C$ with a force vector:
    $$F_{attraction} = (C - n_i) \cdot \text{CohesionMultiplier} \cdot w$$
3.  **Weight Scaling ($w$):** The force is scaled by the simplex's metadata weight ($0.1$ to $1.0$).

---

## A.3 Dynamic Optimization & Performance

As the vault grows, the $O(n^2)$ repulsion calculation becomes a performance bottleneck. The following strategies ensure the plugin remains responsive:

* **Barnes-Hut Approximation:** Utilize a Quadtree to group distant nodes. Instead of calculating individual forces for every pair, treat distant clusters as a single center of mass with a total aggregate repulsion.
* **Kinetic Energy Sleep:** To preserve system resources (CPU/Battery), monitor the total kinetic energy of the system:
    $$E_k = \sum (v_x^2 + v_y^2)$$
    If $E_k$ drops below a threshold (e.g., $0.01$), the `LayoutEngine` loop is suspended until a user interaction or vault modification occurs.
* **Breathing Noise:** A small random vector (Noise = $0.12$) is added to every node per tick to maintain the organic "breathing" effect and prevent the layout from reaching a static, "dead" state.

---

## A.4 Core Tick Implementation (TypeScript)

The following logic is executed within the `requestAnimationFrame` loop to update node positions:

```typescript
// Velocity integration with damping and breathing noise
nodes.forEach(n => {
  // Add random perturbation for the "breathing" effect
  n.fx += (Math.random() - 0.5) * NOISE;
  n.fy += (Math.random() - 0.5) * NOISE;

  // Integrate forces into velocity and apply damping (friction)
  n.vx = (n.vx + n.fx) * DAMPING;
  n.vy = (n.vy + n.fy) * DAMPING;

  // Update positions and clamp to canvas bounds
  n.px = Math.max(50, Math.min(bounds.width  - 50, n.px + n.vx));
  n.py = Math.max(50, Math.min(bounds.height - 50, n.py + n.vy));
});
``` 

# Appendix B : Emergent Engine

TODO

- detects soft clusters (not just triangles)
- feeds suggestions gradually
- influences blob density before formalization
- density-based cluster hints (not just triads)
- temporal strengthening (based on edits)


## ⚠️ 1. Limited Emergence Layer

### Current State

Simplices are primarily user-defined
Automatic suggestions are limited to triadic closure detection

### Risk

Over-relies on explicit user action
Underutilizes the organic, cognitive interface
Reduces the sense of discovery in the system

### Why It Matters
The system is intended to feel like structure emerges from thought.
Right now, emergence is too discrete and rule-based.

### Recommendation
Introduce a lightweight emergence layer:

Density-based cluster hints (beyond strict triangles)
Soft grouping based on co-occurrence and proximity
Temporal reinforcement (clusters strengthen with repeated edits)


## ⚠️ 2. Layout May Drift Toward Traditional Graph Behavior

### Current State

Force-directed layout
Node-to-node forces dominate spatial organization

### Risk

Visual output may resemble conventional graph tools
Weakens the intended “ambient conceptual space” feel

### Why It Matters
The goal is not to visualize connections, but to feel conceptual fields.

### Missing Piece

No true field-based layout model

### Recommendation
Shift toward simplex-driven spatial influence:

Treat simplices as field generators, not just constraints
Nodes are positioned by overlapping simplex influence fields
Layout becomes region-centric rather than edge-centric

## ⚠️ 3. Interaction Model Is Slightly Too Conservative

### Current State

Hover, click, and (future) lasso interactions
Binary actions (select / create / view)

### Risk

Lacks progressive feedback loops
Misses opportunities for guided discovery

### Why It Matters
A cognitive system should guide recognition, not just respond to commands.

### Recommendation
Add progressive interaction patterns:

“This region feels cohesive” → suggest naming
Gradual confidence indicators (not just yes/no states)
Subtle prompts based on user attention and repetition

## ⚠️ 4. Cognitive Pipeline Stops Too Early

### Current State

Suggestion → simplex creation

### Risk

Jumps too quickly from detection to formalization
Misses intermediate cognitive states

### Why It Matters
The system should support progressive formalization, not abrupt structure creation.

### Desired Flow

weak cluster → suggested → explored → confirmed → labeled → promoted

### Recommendation
Introduce intermediate states:

“Soft clusters” that persist without being formal simplices
Confidence gradients before confirmation
Delayed naming and promotion mechanisms
