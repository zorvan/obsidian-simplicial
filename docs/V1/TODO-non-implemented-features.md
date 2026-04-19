# TODO: Remaining and Partially Implemented Features

**Last Updated:** March 30, 2026
**Status:** Updated against current implementation
**Source:** Codebase review of `layout/`, `render/`, `data/inference/`, `core/`, `ui/`

This document no longer lists features that have already landed. It tracks:

- Features now implemented and removed from the active TODO
- Features that are partially implemented and need follow-up
- Features that still appear to be genuinely missing

## Implemented Since The Original TODO

These items were previously listed as non-implemented, but are now present in the codebase.

### Performance and Scale

**Barnes-Hut quad-tree repulsion**
- Implemented in [layout/engine.ts](/home/zorvan/Work/projects/qwen3/simplicial-complex/layout/engine.ts)
- Includes quadtree construction, center-of-mass aggregation, and Barnes-Hut force approximation

**Inference engine optimization**
- Implemented in [data/inference.ts](/home/zorvan/Work/projects/qwen3/simplicial-complex/data/inference.ts)
- Uses inverted indexing and candidate pruning instead of naive all-pairs comparison

**Canvas rendering performance improvements**
- Implemented in [render/renderer.ts](/home/zorvan/Work/projects/qwen3/simplicial-complex/render/renderer.ts)
- Includes text width caching, viewport culling, reduced label work, and visible-node rendering only

### Emergent Inference and Suggestions

**Soft clusters**
- Implemented in [data/inference.ts](/home/zorvan/Work/projects/qwen3/simplicial-complex/data/inference.ts) and [data/inference/engine.ts](/home/zorvan/Work/projects/qwen3/simplicial-complex/data/inference/engine.ts)
- Soft-cluster suggestions are emitted as inferred simplices with confidence and suggestion overlays

**Delayed naming and promotion, basic form**
- Partially realized through inferred/suggested simplices and promotion actions in [ui/panel.ts](/home/zorvan/Work/projects/qwen3/simplicial-complex/ui/panel.ts)
- Users can inspect, label, weight, promote, or dissolve suggestions without immediate formalization

## Partially Implemented Follow-Up Work

These areas have meaningful groundwork in the code, but the original ambition is not fully complete.

### P1 - Performance Follow-Up

**Progressive loading and virtual scrolling**
- Current state: viewport culling is implemented in [render/renderer.ts](/home/zorvan/Work/projects/qwen3/simplicial-complex/render/renderer.ts)
- Missing: true progressive data loading, spatial indexing, chunked hydration, and large-vault streaming behavior
- Priority: Medium

### P1 - Emergence Follow-Up

**Advanced suggestion ranking and filtering**
- Current state: confidence scoring, thresholds, and suggestion overlays exist
- Missing: user-tunable ranking modes, feedback learning, richer filtering, and explanation controls
- Priority: Medium

**Intermediate cognitive states**
- Current state: there is at least a lightweight state progression of inferred -> suggested -> promoted/dissolved
- Missing: explicit multi-stage lifecycle such as weak cluster -> explored -> confirmed -> labeled -> promoted
- Priority: Medium

**Delayed naming and promotion, full workflow**
- Current state: users can defer naming and later promote inferred simplices
- Missing: persistent pre-formal states that strengthen over time without becoming ordinary inferred simplices
- Priority: Medium

## Remaining Non-Implemented Features

These still appear absent or substantially incomplete in the current codebase.

### P1 - Core Analysis Features

**Betti number display**
- Reason: Topological analysis promised in the spec is not surfaced in the UI
- Current gap: [core/model.ts](/home/zorvan/Work/projects/qwen3/simplicial-complex/core/model.ts) reports connected components, but not Betti numbers for holes or voids
- Priority: Medium

**Simplex centrality measures**
- Reason: Users still cannot identify nodes with highest simplex participation or structural influence
- Current gap: analysis summary does not compute simplex-membership centrality or expose ranked hubs
- Priority: Medium

**Filtration slider**
- Reason: There is no UI for progressively filtering simplices by weight or decayed strength
- Current gap: thresholds exist in inference settings, but not an exploration slider over rendered structure
- Priority: Medium

### P1 - Enhanced Emergence

**Density-based cluster hints**
- Reason: Current inference detects pairwise relations, triads, and soft clusters, but not broader density-based groupings
- Current gap: no clustering algorithm such as DBSCAN, community detection, or density field grouping
- Priority: Medium

**Temporal strengthening**
- Reason: The code includes temporal decay, but not reinforcement from repeated edits or recurring interaction
- Current gap: no positive strengthening loop based on user behavior or edit recurrence
- Priority: Medium

### P2 - Advanced Interaction and Layout

**Field-based layout model**
- Reason: Layout is still force-directed and edge/simplex cohesion based, not field-driven
- Current gap: no region-generating fields or simplex-attractor zones
- Priority: Low

**Progressive interaction patterns**
- Reason: Suggestions are visible, but the interaction model is still mostly binary selection, hover, drag, promote, dissolve
- Current gap: no guided discovery flow, staged confidence prompts, or progressive onboarding cues
- Priority: Low

### Future / Research

**ML-enhanced semantic embeddings**
- Reason: Inference remains symbolic and rule-based
- Current gap: no embedding model, semantic vector index, or model-assisted relation scoring
- Priority: Low

**Graph neural networks for structure prediction**
- Reason: No learned graph prediction pipeline exists
- Current gap: no training, inference, or graph-learning workflow
- Priority: Low

## Suggested Next Steps

### Recommended Near-Term

1. Add a filtration slider for weight/confidence/decayed strength exploration.
2. Add simplex centrality metrics to the analysis summary and panel UI.
3. Upgrade viewport culling into true large-vault progressive rendering.
4. Add density-based clustering to complement triad-based emergence.

### Recommended Mid-Term

1. Introduce explicit lifecycle states for inferred structures.
2. Add temporal strengthening from edit recurrence and user interactions.
3. Improve suggestion ranking and filtering controls.

### Long-Term / Experimental

1. Explore embedding-based semantic similarity.
2. Prototype learned graph-structure suggestions.

## Success Criteria

- Large vaults remain responsive while rendering and inference run.
- Suggested structures feel explainable and progressively discoverable.
- Analysis surfaces more than connectivity, including centrality and topology.
- The TODO stays focused on real gaps, not already shipped work.
