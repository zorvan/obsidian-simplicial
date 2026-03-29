# Spec Addendum: Emergent Simplex Inference Engine

**Addendum to:** `simplicial-complex-plugin-spec.md` (v0.2)  
**Version:** A.1  
**Status:** Design complete — supersedes the simplex generation logic in §2.3 and §3.4  
**Date:** 2026-03-30

---

## Problem Statement

The v0.2 spec generates simplices from metadata co-membership: shared tags, shared folders, shared titles. This produces higher-order structures that reflect the classification you already know. A triangle of three stories isn't insight — it's a folder with extra steps.

The fundamental mismatch:

| Dimension | What the system computes | What you expect |
|---|---|---|
| 1-simplex | similarity | relation |
| 2-simplex | stronger similarity | interaction |
| 3-simplex | strongest similarity | synthesis / system |

This addendum replaces the similarity model with a **tension model**. Higher simplices are earned — they represent structural gaps, cross-domain bridges, and role heterogeneity. Most candidate simplices should be rejected. The ones that survive should feel surprising.

---

## Architectural Change

Insert a new layer between `VaultIndex` and `SimplicialModel`:

```
VaultIndex
    │
    ▼
RawGraph               ← pairwise links, tags, folders, roles
    │
    ▼
SimplexInferenceEngine ← NEW: applies insight rules, scores candidates
    │
    ▼
SimplicialModel        ← only receives high-value simplices
    │
    ▼
LayoutEngine → Renderer
```

`SimplexInferenceEngine` is the only component allowed to call `model.addSimplex()` for inferred simplices. The user can still define simplices explicitly via `△` syntax — those bypass inference entirely and go directly to the model.

**Key invariant:** `SimplicialModel` does not know whether a simplex was user-defined or inferred. That distinction lives in `Simplex.source`.

```typescript
type SimplexSource =
  | 'user-defined'     // explicit △ syntax or frontmatter
  | 'inferred-bridge'  // open triad detection
  | 'inferred-cross'   // cross-domain diversity
  | 'inferred-nucleus' // project nucleus (action node present)
  | 'suggested'        // candidate, not yet confirmed by user
```

---

## New File: `inference/engine.ts`

```
obsidian-simplicial/
├── inference/
│   ├── engine.ts        # SimplexInferenceEngine — orchestrates all rules
│   ├── roles.ts         # NoteRole extraction from tags, content, properties
│   ├── graph.ts         # RawGraph construction from vault links
│   ├── rules/
│   │   ├── open-triad.ts      # Rule 1: bridge triangles
│   │   ├── role-diversity.ts  # Rule 2: role heterogeneity
│   │   ├── domain-cross.ts    # Rule 3: cross-domain constraint
│   │   └── temporal-decay.ts  # Rule 4: recency weighting
│   └── scorer.ts        # InsightScore computation
```

---

## Core Concept: The Raw Graph

Before inference runs, build a `RawGraph` from the vault. This is a weighted pairwise graph — not yet simplicial.

```typescript
interface RawEdge {
  a: NodeID;
  b: NodeID;
  strength: number;     // [0.0, 1.0] — see strength computation below
}

interface RawGraph {
  nodes: Map<NodeID, NoteProfile>;
  edges: Map<string, RawEdge>;   // key: normalizeKey([a, b])
}

interface NoteProfile {
  id: NodeID;
  role: NoteRole;
  domain: string;         // top-level folder name
  tags: string[];
  modifiedAt: number;     // Unix timestamp
  linkCount: number;      // outgoing links from this note
}
```

### Edge Strength Computation

```typescript
function computeEdgeStrength(a: NoteProfile, b: NoteProfile, app: App): number {
  let strength = 0.0;

  // Explicit links — strongest signal (bidirectional, counted once)
  const aLinksB = hasExplicitLink(a.id, b.id, app);
  const bLinksA = hasExplicitLink(b.id, a.id, app);
  if (aLinksB && bLinksA) strength += 0.8;   // mutual link: very strong
  else if (aLinksB || bLinksA) strength += 0.5;   // one-way link: strong

  // Rare tag overlap — uncommon shared concepts
  const sharedRare = sharedRareTags(a.tags, b.tags);
  strength += sharedRare.length * 0.15;

  // Common tag penalty — "writing", "idea", etc. add noise, not signal
  const sharedCommon = sharedCommonTags(a.tags, b.tags);
  strength -= sharedCommon.length * 0.10;

  // Same domain penalty — we want cross-domain tension
  if (a.domain === b.domain) strength -= 0.15;

  return Math.max(0.0, Math.min(1.0, strength));
}
```

**What counts as a "rare" tag?** A tag used by fewer than `TAG_RARITY_THRESHOLD` percent of vault notes (default: 5%). Common tags like `#writing`, `#idea`, `#story`, `#research` that appear on hundreds of notes are penalized, not rewarded.

```typescript
function classifyTags(
  allTags: Map<string, number>,  // tag → note count
  totalNotes: number,
  threshold = 0.05
): { rare: Set<string>; common: Set<string> } {
  const rare = new Set<string>();
  const common = new Set<string>();
  allTags.forEach((count, tag) => {
    if (count / totalNotes < threshold) rare.add(tag);
    else common.add(tag);
  });
  return { rare, common };
}
```

---

## Rule 1: Open Triad Detection (Bridge Triangles)

This is the highest-value inference rule. It finds places where the graph *almost* closes but doesn't — and proposes a triangle.

**Definition:**  
An open triad is a triple `(A, B, C)` where:
- `strength(A, B) ≥ LINK_THRESHOLD` (A and B are connected)
- `strength(B, C) ≥ LINK_THRESHOLD` (B and C are connected)  
- `strength(A, C) < CLOSURE_THRESHOLD` (A and C are NOT directly connected)

B is a bridge. The triangle says: *"A and C don't know each other, but they both need B — what does that mean?"*

```typescript
const LINK_THRESHOLD    = 0.4;   // minimum strength to count as "connected"
const CLOSURE_THRESHOLD = 0.25;  // maximum A–C strength to be "open"

function detectOpenTriads(graph: RawGraph): CandidateSimplex[] {
  const candidates: CandidateSimplex[] = [];
  const nodes = [...graph.nodes.keys()];

  for (const b of nodes) {
    // Find all nodes connected to B above threshold
    const bNeighbors = getNeighborsAbove(b, LINK_THRESHOLD, graph);

    // For each pair of B's neighbors (A, C)
    for (let i = 0; i < bNeighbors.length; i++) {
      for (let j = i + 1; j < bNeighbors.length; j++) {
        const a = bNeighbors[i], c = bNeighbors[j];

        // A and C must not already be strongly connected
        const acStrength = getEdgeStrength(a, c, graph);
        if (acStrength >= CLOSURE_THRESHOLD) continue;

        // Open triad score = how strong the bridge is, minus closure
        const triadScore =
          getEdgeStrength(a, b, graph) +
          getEdgeStrength(b, c, graph) -
          acStrength * 2;

        candidates.push({
          nodes: [a, b, c],
          source: 'inferred-bridge',
          bridgeNode: b,              // B is the bridge — used for visualization
          triadScore,
          label: null,
          weight: clamp(triadScore / 2, 0.3, 0.9),
        });
      }
    }
  }

  return candidates;
}
```

**Visualization treatment for bridge triangles:**  
- Render with a dashed or lighter blob outline to signal: *"this is a hypothesis, not a fact"*
- Mark the bridge node (B) with a subtle highlight
- In the metadata panel, label it "bridge triangle" with B named explicitly

---

## Rule 2: Role Diversity Constraint

Every inferred simplex of dimension ≥ 1 must pass a role diversity check. A simplex that consists only of notes with the same role is a folder cluster, not a structural insight.

### NoteRole Extraction

```typescript
type NoteRole =
  | 'action'     // contains tasks / TODOs — highest priority
  | 'project'    // has a status property or explicit project tag
  | 'research'   // academic / investigation framing
  | 'idea'       // concept or creative seed
  | 'creative'   // story, fiction, game design
  | 'reference'  // default / catch-all

function extractRole(file: TFile, cache: MetadataCache, content: string): NoteRole {
  const tags = (cache.getFileCache(file)?.tags ?? []).map(t => t.tag.toLowerCase());
  const fm   = cache.getFileCache(file)?.frontmatter ?? {};

  // Action: note contains open checkboxes
  if (/- \[ \]/.test(content)) return 'action';

  // Project: has status or project marker
  if (fm.status || tags.some(t => ['#project', '#plan', '#initiative'].includes(t)))
    return 'project';

  // Research
  if (tags.some(t => ['#research', '#paper', '#study', '#analysis'].includes(t)))
    return 'research';

  // Creative
  if (tags.some(t => ['#story', '#fiction', '#game', '#worldbuilding', '#writing'].includes(t)))
    return 'creative';

  // Idea / concept
  if (tags.some(t => ['#idea', '#concept', '#hypothesis', '#thought'].includes(t)))
    return 'idea';

  return 'reference';
}
```

### Diversity Enforcement

```typescript
function passesDiversityConstraint(
  nodes: NoteProfile[],
  dim: number
): boolean {
  const roles   = new Set(nodes.map(n => n.role));
  const domains = new Set(nodes.map(n => n.domain));

  if (dim === 1) {
    // 2-simplex: at least 2 different roles OR 2 different domains
    return roles.size >= 2 || domains.size >= 2;
  }

  if (dim === 2) {
    // 3-simplex: at least 2 different domains AND at least 2 different roles
    // Bonus: if 3+ domains and 3+ roles, mark as "super-insight"
    return domains.size >= 2 && roles.size >= 2;
  }

  return true; // dim 0 (single node) always passes
}
```

**What gets rejected:**  
- Triangle of 3 stories from the same folder: ❌ rejected (same domain, same role)  
- Triangle of story + research + business plan: ✅ accepted  
- Tetrahedron of 4 ideas: ❌ rejected  
- Tetrahedron of idea + research + project + action: ✅ accepted — this is a "project nucleus"

---

## Rule 3: Domain Cross-Contamination (3-Simplex Qualification)

3-simplices are the rarest and most valuable structures. They should only exist when they represent something genuinely cross-domain.

```typescript
const MIN_DOMAINS_FOR_TETRA = 2;   // hard minimum
const SUPER_INSIGHT_DOMAINS  = 3;  // marks as "super-insight" class

function qualifiesAsCore(nodes: NoteProfile[]): {
  qualifies: boolean;
  isSuper: boolean;
  class: SimplexClass;
} {
  const domains = new Set(nodes.map(n => n.domain));
  const roles   = new Set(nodes.map(n => n.role));
  const hasAction = nodes.some(n => n.role === 'action');

  if (domains.size < MIN_DOMAINS_FOR_TETRA) {
    return { qualifies: false, isSuper: false, class: 'folder-cluster' };
  }

  const isSuper = domains.size >= SUPER_INSIGHT_DOMAINS && roles.size >= 3;
  const cls: SimplexClass = hasAction
    ? 'project-nucleus'
    : isSuper
    ? 'super-insight'
    : 'cross-domain-core';

  return { qualifies: true, isSuper, class: cls };
}

type SimplexClass =
  | 'folder-cluster'    // rejected — same-domain, no insight
  | 'bridge-triangle'   // open triad — hypothetical connection
  | 'cross-domain'      // 2+ domains, insight value
  | 'cross-domain-core' // 3+ simplex, 2+ domains
  | 'project-nucleus'   // contains an action node — priority rendering
  | 'super-insight'     // 3-simplex, 3+ domains, 3+ roles
```

### Visual Treatment by Class

| Class | Blob style | Label in panel |
|---|---|---|
| `bridge-triangle` | dashed outline, lighter fill | "Bridge — [B] connects [A] and [C]" |
| `cross-domain` | standard blob | cluster label |
| `project-nucleus` | stronger fill, node with action highlighted | "Project nucleus" |
| `super-insight` | brightest fill, subtle pulse animation | "Cross-domain synthesis" |
| `folder-cluster` | **not rendered** | — |

---

## Rule 4: Temporal Decay

Notes untouched for a long time should not dominate the graph. Apply decay to inferred simplex weights based on the recency of member notes.

```typescript
interface DecayConfig {
  halfLifeDays: number;      // default: 90 days — weight halves every 90 days
  minimumWeight: number;     // default: 0.1 — never fully invisible
  roleModifier: Record<NoteRole, number>; // action notes decay slower
}

const DEFAULT_DECAY: DecayConfig = {
  halfLifeDays: 90,
  minimumWeight: 0.1,
  roleModifier: {
    action:    0.3,  // actions decay slowly — they're current
    project:   0.5,
    research:  0.7,
    idea:      1.0,  // ideas decay at standard rate
    creative:  1.2,  // creative notes decay faster
    reference: 1.5,  // references decay fastest
  },
};

function applyTemporalDecay(
  baseWeight: number,
  nodes: NoteProfile[],
  config: DecayConfig = DEFAULT_DECAY
): number {
  const now = Date.now();

  // Use the most recently modified node — the simplex is as current as its freshest member
  const mostRecent = Math.max(...nodes.map(n => n.modifiedAt));
  const ageDays = (now - mostRecent) / (1000 * 60 * 60 * 24);

  // Average role modifier across nodes
  const avgModifier =
    nodes.reduce((sum, n) => sum + config.roleModifier[n.role], 0) / nodes.length;

  // Exponential decay: w = w₀ × 0.5^(age × modifier / halfLife)
  const decayFactor = Math.pow(0.5, (ageDays * avgModifier) / config.halfLifeDays);
  const decayed = baseWeight * decayFactor;

  return Math.max(config.minimumWeight, decayed);
}
```

**Practical effect:** A triangle of writing ideas not touched in 8 months drops from weight 0.8 to ~0.15, which renders as a barely-visible ghost blob. It doesn't disappear — it becomes quiet. A triangle containing an active task note decays at one-third the speed.

A **temporal filter slider** in the UI (Phase 2) will let you cut off simplices below a decayed-weight threshold — effectively showing only what's currently active.

---

## Insight Score: The Final Gate

After all rules run and candidates are generated, rank them. Only pass candidates above `INSIGHT_THRESHOLD` to `SimplicialModel`.

```typescript
const INSIGHT_THRESHOLD = 0.45;  // tune this — lower = more noise, higher = more silence

interface ScoredCandidate extends CandidateSimplex {
  insightScore: number;
  class: SimplexClass;
  decayedWeight: number;
}

function scoreCandidate(
  candidate: CandidateSimplex,
  profiles: NoteProfile[],
  config: InferenceConfig
): ScoredCandidate {
  const nodes = candidate.nodes.map(id => profiles.find(p => p.id === id)!);
  const d = nodes.length - 1; // dimension

  // Base: triad score (structural tension)
  let score = candidate.triadScore ?? 0;

  // Role diversity bonus
  const uniqueRoles = new Set(nodes.map(n => n.role)).size;
  score += uniqueRoles * config.ROLE_DIVERSITY_WEIGHT;    // default: 0.2 per unique role

  // Domain diversity bonus
  const uniqueDomains = new Set(nodes.map(n => n.domain)).size;
  score += uniqueDomains * config.DOMAIN_DIVERSITY_WEIGHT; // default: 0.25 per unique domain

  // Action node bonus — presence of an action/task note boosts score
  const hasAction = nodes.some(n => n.role === 'action');
  if (hasAction) score += config.ACTION_BONUS;             // default: 0.3

  // Rare concept bonus
  const rareOverlap = countRareTagOverlap(nodes, config.rareTags);
  score += rareOverlap * config.RARE_TAG_WEIGHT;           // default: 0.15 per rare tag

  // Common tag penalty
  const commonOverlap = countCommonTagOverlap(nodes, config.commonTags);
  score -= commonOverlap * config.COMMON_TAG_PENALTY;      // default: 0.12 per common tag

  // Diversity constraint gate — hard reject if fails
  if (!passesDiversityConstraint(nodes, d)) {
    return { ...candidate, insightScore: 0, class: 'folder-cluster', decayedWeight: 0 };
  }

  // Classify
  const classification = d === 2
    ? qualifiesAsCore(nodes)
    : { qualifies: true, isSuper: false, class: 'cross-domain' as SimplexClass };

  if (!classification.qualifies) {
    return { ...candidate, insightScore: 0, class: 'folder-cluster', decayedWeight: 0 };
  }

  // Temporal decay
  const decayedWeight = applyTemporalDecay(candidate.weight ?? 1.0, nodes);

  return {
    ...candidate,
    insightScore: score,
    class: classification.class,
    decayedWeight,
  };
}

function runInference(
  graph: RawGraph,
  config: InferenceConfig
): Simplex[] {
  const triads     = detectOpenTriads(graph);
  const allCandidates = triads; // future: add more rule generators here

  return allCandidates
    .map(c => scoreCandidate(c, [...graph.nodes.values()], config))
    .filter(c => c.insightScore >= INSIGHT_THRESHOLD && c.class !== 'folder-cluster')
    .sort((a, b) => b.insightScore - a.insightScore)
    .map(c => ({
      nodes: c.nodes,
      weight: c.decayedWeight,
      label: c.label ?? null,
      source: c.source,
      simplexClass: c.class,
      insightScore: c.insightScore,
    }));
}
```

---

## Updated Dimensional Semantics

Replace the dimensional table from §1.4 of the main spec:

| Dimension | Old meaning | New meaning | Render style |
|---|---|---|---|
| 1-simplex | similar | explicitly related (linked) | thin edge |
| 2-simplex | more similar | **interacting** — bridge or cross-domain | soft blob, dashed if bridge |
| 3-simplex | most similar | **systemic** — multi-domain, multi-role functional unit | strong blob, pulsed if super-insight |

A 3-simplex that fails diversity rules is **not rendered at all** — it collapses to a point or a 1-simplex visually. This is intentional: most of your current 3-simplices should disappear, and the ones that remain should feel earned.

---

## New Settings

Add to `PluginSettings` (§5.8 of main spec):

```typescript
interface InferenceSettings {
  // Inference mode
  inferenceMode: 'emergent' | 'taxonomic' | 'hybrid';
  // 'emergent'   = only tension-based (this addendum)
  // 'taxonomic'  = only metadata co-membership (original v0.2 behavior)
  // 'hybrid'     = both, with emergent simplices styled distinctly

  // Thresholds
  insightThreshold: number;       // default: 0.45 — minimum score to render
  linkStrengthThreshold: number;  // default: 0.40 — minimum edge strength to count
  closureThreshold: number;       // default: 0.25 — max A–C strength to be "open"
  tagRarityThreshold: number;     // default: 0.05 — tags used by < 5% of notes are "rare"

  // Temporal decay
  decayHalfLifeDays: number;      // default: 90
  decayMinimumWeight: number;     // default: 0.10

  // Diversity
  minDomainsForTriangle: number;  // default: 2
  minDomainsForTetra: number;     // default: 2
  minRolesForTetra: number;       // default: 2

  // Weights
  roleDiversityWeight: number;    // default: 0.20
  domainDiversityWeight: number;  // default: 0.25
  actionBonus: number;            // default: 0.30
  rareTagWeight: number;          // default: 0.15
  commonTagPenalty: number;       // default: 0.12
}
```

**Important:** `inferenceMode: 'hybrid'` is the recommended migration path. Users with existing `△`-defined simplices keep them. The inference engine adds new inferred simplices styled distinctly. They can promote inferred simplices to user-defined ones via the panel.

---

## Updated Panel UI (§5.5)

When a simplex is inferred (not user-defined), the metadata panel shows:

```
┌──────────────────────────────┐
│  BRIDGE TRIANGLE             │
│  inferred · not confirmed    │
│                              │
│  Nodes                       │
│  research-A · startup ·      │
│  game-mechanic-B             │
│                              │
│  Bridge node: startup        │
│  "research-A and             │
│   game-mechanic-B don't      │
│   directly connect"          │
│                              │
│  Insight score: 0.72         │
│  Domains: Research, Games    │
│  Roles: research, creative   │
│                              │
│  [ Confirm as real simplex ] │
│  [ Dismiss ]                 │
└──────────────────────────────┘
```

**Confirm** → converts `source: 'inferred-bridge'` to `source: 'user-defined'`, writes to frontmatter, stops being subject to decay.

**Dismiss** → adds to a `dismissedSimplices` blocklist. Never re-suggested.

---

## Migration from v0.2

1. Set `inferenceMode: 'hybrid'` initially — keeps your existing `△` simplices visible while adding inferred ones.
2. Run inference on your vault. Expect most existing 3-simplices to disappear (they were folder-clusters).
3. Review the inferred bridge triangles. Dismiss noise; confirm the ones that feel true.
4. After a week of use, switch to `inferenceMode: 'emergent'` — by then your confirmed simplices are the new baseline.

**Do not delete your `△` definitions.** They represent intentional structure. The inference engine adds a second layer of discovered structure on top of it.

---

## Performance Notes

Open triad detection is O(n × d²) where n = nodes and d = average degree. For typical personal vaults (n < 500, d < 20), this is fast. Run inference:

- **On vault load** (full scan)
- **On file modify/create/delete** (incremental — re-run only for affected nodes' neighborhoods)
- **Not on every frame** — inference results are cached until the next vault event

Debounce inference runs by **500ms** after vault events to batch rapid consecutive edits.

---

*End of addendum.*  
*Entry point: implement `inference/roles.ts` and `inference/graph.ts` first — both are Obsidian-API-independent and fully unit-testable. Then wire `SimplexInferenceEngine` into `main.ts` between `VaultIndex` and `SimplicialModel`.*
