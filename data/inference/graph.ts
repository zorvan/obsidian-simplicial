import type { RawGraph, RawEdge, NoteProfile, InferenceContext, InferenceConfig } from "./types";
import { clusterByContent, assignHybridDomains } from "../clustering";

export function normalizeKeyPair(a: string, b: string): string {
  return [a, b].sort().join("|");
}

function sharedTags(a: string[], b: string[]): string[] {
  const set = new Set(a);
  return b.filter((tag) => set.has(tag));
}

export function computeEdgeStrength(
  a: NoteProfile,
  b: NoteProfile,
  contexts: Map<string, InferenceContext>,
  config: InferenceConfig,
): number {
  let strength = 0;
  const ctxA = contexts.get(a.id);
  const ctxB = contexts.get(b.id);
  const aLinksB = ctxA?.outgoingLinks.has(b.id) ?? false;
  const bLinksA = ctxB?.outgoingLinks.has(a.id) ?? false;

  if (aLinksB && bLinksA) strength += 0.8;
  else if (aLinksB || bLinksA) strength += 0.5;

  const shared = sharedTags(a.tags, b.tags);
  const allTags = [...contexts.values()].flatMap((c) => [...c.tags]);
  const tagCounts = new Map<string, number>();
  for (const tag of allTags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  const totalNotes = contexts.size;
  const rare = new Set<string>();
  const common = new Set<string>();
  for (const [tag, count] of tagCounts.entries()) {
    if (count / totalNotes < config.tagRarityThreshold) rare.add(tag);
    else common.add(tag);
  }
  const sharedRare = shared.filter((tag) => rare.has(tag));
  const sharedCommon = shared.filter((tag) => common.has(tag));

  strength += sharedRare.length * 0.15;
  strength -= sharedCommon.length * 0.10;

  // Same domain bonus (notes in same conceptual area are more likely related)
  if (a.domain && b.domain && a.domain === b.domain) {
    strength += 0.15;
  }

  return Math.max(0, Math.min(1, strength));
}

export function buildRawGraph(
  contexts: InferenceContext[],
  config: InferenceConfig,
): RawGraph {
  const nodes = new Map<string, NoteProfile>();
  const ctxMap = new Map<string, InferenceContext>(contexts.map((c) => [c.path, c]));

  let domainMap: Map<string, string>;
  if (config.domainSource === 'content-cluster') {
    domainMap = clusterByContent(contexts, { k: config.contentClusterCount });
  } else if (config.domainSource === 'hybrid') {
    const contentClusters = clusterByContent(contexts, { k: config.contentClusterCount });
    domainMap = assignHybridDomains(contexts, contentClusters);
  } else {
    domainMap = new Map(contexts.map(c => [c.path, c.topFolder || c.folder || ""]));
  }

  for (const ctx of contexts) {
    nodes.set(ctx.path, {
      id: ctx.path,
      role: ctx.role,
      domain: domainMap.get(ctx.path) || ctx.topFolder || ctx.folder || "",
      tags: [...ctx.tags],
      modifiedAt: ctx.modifiedAt,
      linkCount: ctx.outgoingLinks.size,
    });
  }

  const edges = new Map<string, RawEdge>();
  const nodeArr = [...nodes.values()];

  for (let i = 0; i < nodeArr.length; i++) {
    for (let j = i + 1; j < nodeArr.length; j++) {
      const a = nodeArr[i];
      const b = nodeArr[j];
      const strength = computeEdgeStrength(a, b, ctxMap, config);
      const key = normalizeKeyPair(a.id, b.id);
      edges.set(key, { a: a.id, b: b.id, strength });
    }
  }

  return { nodes, edges };
}

export function getEdgeStrength(aId: string, bId: string, graph: RawGraph): number {
  const key = normalizeKeyPair(aId, bId);
  return graph.edges.get(key)?.strength ?? 0;
}

export function getNeighborsAbove(id: string, threshold: number, graph: RawGraph): string[] {
  const result: string[] = [];
  for (const edge of graph.edges.values()) {
    if (edge.strength < threshold) continue;
    if (edge.a === id) result.push(edge.b);
    else if (edge.b === id) result.push(edge.a);
  }
  return result;
}
