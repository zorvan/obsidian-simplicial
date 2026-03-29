import { getEdgeStrength, getNeighborsAbove } from "../graph";
import type { CandidateSimplex, InferenceConfig, RawGraph } from "../types";

function canonicalKey(nodes: string[]): string {
  return [...nodes].sort().join("|");
}

function averageInternalStrength(nodes: string[], graph: RawGraph): { average: number; density: number } {
  if (nodes.length < 2) return { average: 0, density: 0 };

  let total = 0;
  let connected = 0;
  const pairCount = (nodes.length * (nodes.length - 1)) / 2;

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const strength = getEdgeStrength(nodes[i], nodes[j], graph);
      total += strength;
      if (strength > 0) connected++;
    }
  }

  return {
    average: pairCount > 0 ? total / pairCount : 0,
    density: pairCount > 0 ? connected / pairCount : 0,
  };
}

export function detectDensityClusters(graph: RawGraph, config: InferenceConfig): CandidateSimplex[] {
  const denseThreshold = Math.max(0.22, config.linkStrengthThreshold * 0.7);
  const minCoreNeighbors = 2;
  const minDensity = 0.6;
  const minAverageStrength = Math.max(0.16, config.closureThreshold * 0.8);

  const visited = new Set<string>();
  const emitted = new Set<string>();
  const candidates: CandidateSimplex[] = [];

  for (const nodeId of graph.nodes.keys()) {
    if (visited.has(nodeId)) continue;

    const seedNeighbors = getNeighborsAbove(nodeId, denseThreshold, graph);
    if (seedNeighbors.length < minCoreNeighbors) continue;

    const cluster = new Set<string>([nodeId]);
    const queue = [nodeId];
    visited.add(nodeId);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const neighbors = getNeighborsAbove(current, denseThreshold, graph);
      if (neighbors.length < minCoreNeighbors) continue;

      for (const neighbor of neighbors) {
        cluster.add(neighbor);
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }

    if (cluster.size < 3) continue;

    const sortedCluster = [...cluster].sort();
    const trimmedCluster = sortedCluster.length > 5
      ? sortedCluster
          .map((id) => ({
            id,
            strength: getNeighborsAbove(id, denseThreshold, graph)
              .filter((neighbor) => cluster.has(neighbor))
              .reduce((sum, neighbor) => sum + getEdgeStrength(id, neighbor, graph), 0),
          }))
          .sort((a, b) => b.strength - a.strength)
          .slice(0, 5)
          .map(({ id }) => id)
          .sort()
      : sortedCluster;

    const stats = averageInternalStrength(trimmedCluster, graph);
    if (stats.density < minDensity || stats.average < minAverageStrength) continue;

    const key = canonicalKey(trimmedCluster);
    if (emitted.has(key)) continue;
    emitted.add(key);

    candidates.push({
      nodes: trimmedCluster,
      source: "inferred-cross",
      label: "density cluster",
      weight: Math.min(0.95, Math.max(0.35, (stats.average * 0.7) + (stats.density * 0.3))),
      triadScore: Number((stats.average * trimmedCluster.length).toFixed(2)),
    });
  }

  return candidates;
}
