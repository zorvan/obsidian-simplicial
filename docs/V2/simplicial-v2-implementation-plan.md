# Simplicial Complex Plugin — v2 Implementation Plan

**Project:** simplicial-complex  
**Based on:** Code review + blog post analysis (April 2026)  
**Status:** Planning  
**Author:** Review by Claude / Owner: Amin Razavi

---

## Context and Thesis

The v1 plugin has a clean architecture and a working inference pipeline, but it solves the wrong problem. It finds and displays clusters of related notes — which reflects what you already know. The stated goal was *generation and discovery of higher-order relations* — which requires surfacing what you do *not* yet know.

The core mismatch (from the spec addendum, not yet resolved in code):

| Dimension | What v1 computes | What it should compute |
|-----------|-----------------|----------------------|
| 1-simplex | similarity | relation |
| 2-simplex | stronger similarity | interaction / bridge |
| 3-simplex | strongest similarity | synthesis / void |

The v2 plan makes one fundamental shift: **from detecting presence to detecting absence**. A simplicial complex's topology is defined not just by what simplices exist, but by the *holes* between them. Those holes — Betti numbers β₁ and β₂ — are the shape of questions your thinking has not yet answered.

---

## Gap Analysis Summary

### Gap 1 — Domain derived from folder structure

**Location:** `data/inference/graph.ts`, `buildRawGraph()`

```ts
domain: ctx.topFolder || ctx.folder || ""
```

`domain` drives diversity scoring in `scoreCandidate()`. But folder structure reflects your existing organizational mental model, not conceptual proximity. Two notes in `/research/` share a domain only because you filed them there. A note on Byzantine fault tolerance and one on distributed consensus belong to the same conceptual domain regardless of folder.

**Effect:** Domain diversity bonuses in `insightScore` measure filing diversity, not conceptual tension. The inference engine rewards well-organized vaults, not intellectually cross-cutting ones.

### Gap 2 — Betti numbers are absent

**Location:** `core/model.ts`, `getAnalysisSummary()`

The analysis summary computes connected components (β₀). β₁ and β₂ are never computed or surfaced. These are the most important topological invariants for the stated use case:

- **β₁** — count of 1-dimensional holes (cycles without interior fillers). Each is a loop of pairwise-connected ideas with no synthesizing note at the center.
- **β₂** — count of 2-dimensional voids (closed surfaces without interior). Three ideas forming a triangle with no synthesis is a β₁ hole; four ideas forming a hollow tetrahedron is a β₂ void.

These holes are *generative prompts expressed as topology*. The system already builds the simplicial complex. It never asks what shape the emptiness has.

### Gap 3 — No filtration

**Location:** Missing entirely (listed as P1 in TODO)

Filtration is the process of building the complex incrementally, adding simplices in order of weight from highest to lowest. Each threshold crossing where a new simplex appears — especially when a triangle or tetrahedron closes — is a topological event. Watching the complex build is where emergence becomes legible.

Without filtration, the user sees a single static snapshot at one threshold. The topology's evolution — and with it, the sense that structure is *emerging* rather than just *being displayed* — is invisible.

### Gap 4 — Inferred simplices are silent

**Location:** `ui/panel.ts`, `renderPanel()`

The panel renders node paths, dimension badge, confidence score, and source type. It does not explain *why* the structure was inferred, *what the structural tension is*, or *what question the triangle poses*.

An inferred bridge shows `node-a.md · node-b.md · node-c.md / dim 2 / inferred-bridge`. The user sees what was found, not what it means. Without an explanation layer, the system asks the user to judge structures they don't understand.

### Gap 5 — Only temporal decay, no reinforcement

**Location:** `data/inference/rules/temporal-decay.ts`

Decay is implemented and well-calibrated by note role. But a complex that only decays converges toward silence. There is no positive feedback loop: opening a note that participates in a simplex doesn't strengthen it; following an inferred link doesn't reinforce it; writing a note that completes an open triad doesn't trigger a birth event. Relevance signals from actual use are discarded.

### Gap 6 — Interaction model is passive judgment

**Location:** `interaction/controller.ts`, `ui/panel.ts`

The user can promote or dissolve. That's a management interface. There is no discovery interface — nothing that says "here's a question this structure is asking" or "this void needs something written into it." The system surfaces candidates for evaluation, not provocations for thinking.

---

## v2 Architecture Changes

The following diagram shows where new components insert into the existing pipeline:

```
VaultIndex
    │
    ▼
ContentClusterer (NEW)         ← replaces topFolder-as-domain
    │
    ▼
RawGraph
    │
    ▼
SimplexInferenceEngine
    │
    ▼
SimplicialModel
    │
    ├──► BettiComputer (NEW)   ← computes β₁, β₂ from boundary matrices
    │         │
    │         ▼
    │    VoidIndex (NEW)       ← maps holes to the notes that bound them
    │
    ▼
LayoutEngine
    │
    ▼
Renderer
    │
    ├──► FiltrationSlider (NEW)    ← threshold sweep UI
    └──► ExplanationPanel (NEW)    ← replaces bare path/badge panel
```

`SimplicialModel` itself requires no changes. All new components read from it; none write to it except through existing channels.

---

## Implementation Plan

### Phase 1 — Semantic domain (replaces folder-as-domain)

**Priority:** P0  
**Files:** `data/inference/graph.ts`, new `data/clustering.ts`  
**Depends on:** nothing

**What to build:**

Replace `domain: ctx.topFolder` with a content-derived cluster label. Two approaches in increasing sophistication:

**Option A — TF-IDF topic clustering (no external dependencies)**

Build a term-frequency matrix over `contentTokens` (already computed in `InferenceContext`). Apply cosine similarity to cluster notes. Assign cluster IDs as domain labels. This runs entirely in TypeScript at index time.

```ts
// data/clustering.ts
export function clusterByContent(
  contexts: InferenceContext[],
  k: number = 8,          // number of clusters
  minClusterSize: number = 3,
): Map<string, string>    // path → cluster-id
```

Use k-means over TF-IDF vectors with k configurable in settings. Cache results; rebuild only on full vault rescan.

**Option B — Obsidian's own search index (preferred if API permits)**

Obsidian's `MetadataCache` and search plugin expose note similarity data. If accessible, this leverages an already-computed semantic model at zero extra cost.

**Fallback:** Keep `topFolder` as a tiebreaker when content clustering produces ambiguous results (small notes, mostly links).

**Settings addition:**

```ts
domainSource: 'folder' | 'content-cluster' | 'hybrid'
contentClusterCount: number  // default 8
```

---

### Phase 2 — Betti number computation

**Priority:** P0  
**Files:** new `core/betti.ts`, `core/model.ts` (analysis summary extension)  
**Depends on:** nothing (pure TypeScript, no external deps)

**What to build:**

Compute β₁ and β₂ from the simplicial complex stored in `SimplicialModel`.

**Algorithm sketch:**

A simplicial complex has boundary operators ∂₁ (edges → nodes), ∂₂ (triangles → edges), ∂₃ (tetrahedra → triangles). Betti numbers are:

- β₀ = dim(ker ∂₀) = connected components (already computed)
- β₁ = dim(ker ∂₁) − dim(im ∂₂)
- β₂ = dim(ker ∂₂) − dim(im ∂₃)

For vaults up to ~500 simplices, full boundary matrix rank computation via Gaussian elimination is fast enough. For larger vaults, use the practical shortcut: enumerate unfilled cycles directly.

**Practical proxy (simpler, sufficient for < 1000 simplices):**

```ts
// core/betti.ts

export interface BettiResult {
  b0: number;   // connected components
  b1: number;   // unfilled loops
  b2: number;   // hollow shells
  holes: Hole[];
}

export interface Hole {
  dimension: 1 | 2;
  boundaryNodes: NodeID[];    // the nodes forming the boundary
  missingSimplex: NodeID[];   // the simplex that would fill it
}

export function computeBetti(model: SimplicialModel): BettiResult
```

For β₁: find all triangles (3-node simplices). A triangle is a β₁ hole if all three edges exist as 1-simplices, but the triangle itself does not exist as a 2-simplex. Each such triangle is a question: these three things connect pairwise, but no synthesizing structure holds them.

For β₂: find all complete triangle sets forming a closed surface (every face of a tetrahedron exists as a 2-simplex) where the tetrahedron itself does not exist.

**Extension to `AnalysisSummary`:**

```ts
interface AnalysisSummary {
  // existing fields ...
  betti: BettiResult;
  holeCount: number;
}
```

Surface β₁ and β₂ in the panel header and as overlay indicators on the canvas.

---

### Phase 3 — Filtration slider

**Priority:** P0  
**Files:** `ui/view.ts`, `render/renderer.ts`, new `ui/filtration-control.ts`  
**Depends on:** existing weight/confidence fields on `Simplex`

**What to build:**

A slider (0.0 → 1.0) that sets a weight threshold. Only simplices with `weight >= threshold` (or `decayedWeight >= threshold`) are passed to the renderer. As the slider moves down, the complex builds; as it moves up, it dissolves.

The *topological events* — moments when a new connected component merges, when a triangle closes, when a void appears or fills — should be signaled visually. A brief pulse on the newly appearing simplex.

```ts
// ui/filtration-control.ts
export class FiltrationControl {
  onThresholdChange: (threshold: number) => void;
  
  // marks thresholds where topological events occur
  setEventMarkers(events: FiltrationEvent[]): void;
}

export interface FiltrationEvent {
  threshold: number;
  type: 'component-merge' | 'triangle-close' | 'void-open' | 'void-fill';
  nodes: NodeID[];
}
```

Pre-compute `FiltrationEvent` list when the model rebuilds. Mark these on the slider track so the user can navigate directly to structurally interesting thresholds.

**Renderer changes:** `Renderer.render()` already accepts simplices from the model. Add a `weightFilter: number` parameter to `renderFrame()`. No model changes required.

---

### Phase 4 — Explanation layer

**Priority:** P1  
**Files:** `ui/panel.ts`, new `data/explainer.ts`  
**Depends on:** Phase 1 (semantic domain), Phase 2 (Betti holes)

**What to build:**

Replace the bare path + badge display with a human-readable explanation of *why* the structure was inferred and *what question it poses*.

```ts
// data/explainer.ts
export function explainSimplex(
  simplex: Simplex,
  nodes: NoteProfile[],
  contexts: Map<string, InferenceContext>,
  holes: Hole[],
): SimplexExplanation

export interface SimplexExplanation {
  headline: string;       // one sentence: what the structure is
  tension: string;        // one sentence: what the gap/tension is
  prompt: string;         // one sentence: what writing could fill or use it
  signals: string[];      // the actual evidence (shared tags, mutual links, etc.)
}
```

Example output for an inferred bridge:

```
headline: "Three notes form a structural triangle with one missing link."
tension:  "Note A and B both connect to C, but A and C have never been connected."
prompt:   "What would a note directly relating 'Byzantine fault tolerance' and
           'consensus algorithms' say?"
signals:  ["A→C: mutual link", "B→C: shared rare tag #distributed-systems",
           "A–B direct link missing"]
```

For holes found by Betti computation:

```
headline: "A 1-dimensional hole in your complex."
tension:  "Notes A, B, C connect pairwise, but no synthesizing structure exists."
prompt:   "What's at the center of this triangle? Writing it would close the hole."
```

**Panel update:** Replace `renderPanel()` node list with `ExplanationCard` component showing headline + tension + prompt + collapsible signals. Keep the promote/dissolve actions.

---

### Phase 5 — Positive temporal reinforcement

**Priority:** P1  
**Files:** `data/inference/rules/temporal-decay.ts`, new `data/interaction-log.ts`, `main.ts`  
**Depends on:** nothing

**What to build:**

Track user interactions with notes that participate in simplices. Use interaction evidence to strengthen simplex weights.

```ts
// data/interaction-log.ts
export interface InteractionEvent {
  type: 'note-open' | 'link-follow' | 'triad-completion' | 'simplex-hover';
  involvedPaths: string[];
  timestamp: number;
}

export class InteractionLog {
  record(event: InteractionEvent): void;
  getRecentStrength(paths: string[], windowDays: number): number;
}
```

**Reinforcement rule:**

When a note is opened that participates in an inferred simplex, add a small weight bonus to that simplex (configurable, default +0.05, capped at 1.0). When the user hovers a simplex for > 3 seconds, record a hover event (weaker signal, default +0.01). When the user writes a new note that completes an open triad (creates a link that closes a Betti hole), record a `triad-completion` event and promote the resulting simplex at elevated confidence.

**Modified decay function:**

```ts
// temporal-decay.ts — extended
export function applyTemporalDecayWithReinforcement(
  baseWeight: number,
  nodes: NoteProfile[],
  interactionStrength: number,   // from InteractionLog
  config: DecayConfig,
): number
```

Interaction strength adds a reinforcement term that partially offsets decay. Ideas you keep returning to stay alive.

---

### Phase 6 — Void-as-prompt interaction

**Priority:** P1  
**Files:** `render/renderer.ts`, `interaction/controller.ts`, `ui/panel.ts`  
**Depends on:** Phase 2 (Betti holes), Phase 4 (explanation layer)

**What to build:**

Surface unfilled voids as visual elements on the canvas — phantom simplices rendered at low opacity with a dashed boundary. Clicking a void opens the explanation panel with the Betti hole explanation and a "Write into this void" action.

**Renderer addition:**

```ts
// render/renderer.ts
renderVoids(holes: Hole[], nodes: LayoutNode[]): void
```

Draw unfilled triangles as dashed outlines with 20% opacity fill. Draw unfilled tetrahedra edges as dashed lines. Add a subtle pulse animation on discovery (once per session per hole).

**"Write into this void" action:**

Creates a new note in Obsidian with a pre-filled template:

```md
---
tags: [synthesis, generated-by-simplicial]
connects: [node-a, node-b, node-c]
---

# [Working title]

<!-- This note was prompted by a topological hole in your complex.
     A, B, and C connect pairwise. This note is the potential synthesis. -->
```

This closes the loop: the system identifies a structural gap, prompts writing, and the resulting note (if it links to A, B, and C) fills the hole on the next vault scan.

---

## Settings additions

The following settings should be added to `PluginSettings`:

```ts
// Domain
domainSource: 'folder' | 'content-cluster' | 'hybrid';
contentClusterCount: number;          // default 8

// Betti
enableBettiComputation: boolean;      // default true
bettiDisplayOnCanvas: boolean;        // default true (show void outlines)
maxBettiDim: 1 | 2;                   // default 1 (only triangular holes)

// Filtration
showFiltrationSlider: boolean;        // default true
filtrationMetric: 'weight' | 'confidence' | 'decayed-weight';

// Explanation
enableExplanationPanel: boolean;      // default true
explanationVerbosity: 'brief' | 'full';

// Reinforcement
enableInteractionReinforcement: boolean;  // default true
reinforcementStrength: number;            // default 0.05
reinforcementWindowDays: number;          // default 14
```

---

## File change summary

| File | Change type | Phase |
|------|------------|-------|
| `data/clustering.ts` | New | 1 |
| `data/inference/graph.ts` | Modify (`domain` source) | 1 |
| `core/betti.ts` | New | 2 |
| `core/model.ts` | Extend `AnalysisSummary` | 2 |
| `ui/filtration-control.ts` | New | 3 |
| `ui/view.ts` | Modify (embed filtration control) | 3 |
| `render/renderer.ts` | Modify (weight filter, void render) | 3, 6 |
| `data/explainer.ts` | New | 4 |
| `ui/panel.ts` | Modify (explanation card) | 4 |
| `data/interaction-log.ts` | New | 5 |
| `data/inference/rules/temporal-decay.ts` | Modify (reinforcement term) | 5 |
| `main.ts` | Modify (interaction event hooks) | 5 |
| `interaction/controller.ts` | Modify (void click, hover tracking) | 6 |
| `core/types.ts` | Extend `PluginSettings`, `AnalysisSummary` | all |

No changes to `layout/engine.ts`, `data/inference/engine.ts`, `data/inference/scorer.ts`, or persistence layer. The architectural separation holds cleanly.

---

## Success criteria

The v2 implementation succeeds when:

1. A user with no pre-tagged vault (no `#action`, `#project` tags, no deliberate folder hierarchy) still gets meaningful inferred simplices — because domain comes from content, not structure.

2. The panel for any inferred simplex contains one sentence that surprises the user — something about their own notes they had not consciously noticed.

3. The Betti hole display surfaces at least one unfilled triangle per 100 notes that the user confirms is a real gap in their thinking, not an artifact.

4. The filtration slider reveals at least one topological event (a triangle closing, a component merging) that the user finds significant.

5. After one week of use, the strongest simplices in the model correspond to ideas the user has actively engaged with — not just the most densely tagged notes at vault creation time.

---

## What v2 is not

v2 does not require machine learning, embeddings, or graph neural networks. The TODO lists these as long-term options. They are not on the critical path. The core failure of v1 is conceptual, not computational: it measures the wrong thing, surfaces the wrong signal, and presents outputs without meaning. All six gaps above are fixable in TypeScript with the existing architecture.

The goal is not a smarter graph view. It is a system that finds the shape of what you haven't thought yet.
