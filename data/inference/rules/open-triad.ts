import type { CandidateSimplex, RawGraph, InferenceConfig } from "../types";
import { getNeighborsAbove, getEdgeStrength } from "../graph";

export function detectOpenTriads(graph: RawGraph, config: InferenceConfig): CandidateSimplex[] {
  const candidates: CandidateSimplex[] = [];
  const nodes = [...graph.nodes.keys()];
  const LINK_THRESHOLD = config.linkStrengthThreshold;
  const CLOSURE_THRESHOLD = config.closureThreshold;

  for (const b of nodes) {
    const bNeighbors = getNeighborsAbove(b, LINK_THRESHOLD, graph);
    for (let i = 0; i < bNeighbors.length; i++) {
      for (let j = i + 1; j < bNeighbors.length; j++) {
        const a = bNeighbors[i];
        const c = bNeighbors[j];

        const acStrength = getEdgeStrength(a, c, graph);
        if (acStrength >= CLOSURE_THRESHOLD) continue;

        const abStrength = getEdgeStrength(a, b, graph);
        const bcStrength = getEdgeStrength(b, c, graph);

        const triadScore = abStrength + bcStrength - acStrength * 2;
        const weight = Math.min(0.9, Math.max(0.3, triadScore / 2));

        candidates.push({
          nodes: [a, b, c],
          source: 'inferred-bridge',
          bridgeNode: b,
          triadScore,
          label: null,
          weight,
        });
      }
    }
  }

  return candidates;
}
