import type { SimplicialModel } from "./model";
import type { NodeID, Simplex, RenderFilterMetric } from "./types";

export interface FiltrationEvent {
  threshold: number;
  type: 'component-merge' | 'triangle-close' | 'void-open' | 'void-fill' | 'edge-appear';
  nodes: NodeID[];
  description: string;
}

interface SimplexWithWeight {
  key: string;
  simplex: Simplex;
  weight: number;
}

/**
 * Compute topological events that occur during filtration.
 * Events are detected by sorting simplices by weight and tracking
 * when the complex changes topology.
 */
export function computeFiltrationEvents(
  model: SimplicialModel,
  metric: RenderFilterMetric,
): FiltrationEvent[] {
  const events: FiltrationEvent[] = [];
  
  const simplices = [...model.simplices.entries()].map(([key, simplex]) => ({
    key,
    simplex,
    weight: getSimplexWeight(simplex, metric),
  })).sort((a, b) => b.weight - a.weight);

  const appearedNodes = new Set<NodeID>();
  const appearedEdges = new Map<string, Set<NodeID>>(); // node -> connected component
  const appearedTriangles = new Set<string>();
  let componentCounter = 0;

  for (const { key, simplex, weight } of simplices) {
    const dim = simplex.nodes.length - 1;
    
    if (dim === 0) {
      // Node appears
      for (const node of simplex.nodes) {
        if (!appearedNodes.has(node)) {
          appearedNodes.add(node);
          appearedEdges.set(node, new Set([node]));
          componentCounter++;
          events.push({
            threshold: weight,
            type: 'edge-appear',
            nodes: [node],
            description: `Node ${node} appears`,
          });
        }
      }
    } else if (dim === 1) {
      // Edge appears - check for component merge
      const [a, b] = simplex.nodes;
      const compA = appearedEdges.get(a);
      const compB = appearedEdges.get(b);
      
      if (compA && compB && compA !== compB) {
        // Merge components
        const merged = new Set([...compA, ...compB]);
        for (const node of merged) {
          appearedEdges.set(node, merged);
        }
        componentCounter--;
        events.push({
          threshold: weight,
          type: 'component-merge',
          nodes: [a, b],
          description: `Components merge via ${a} ↔ ${b}`,
        });
      }
    } else if (dim === 2) {
      // Triangle appears - check if it closes a hole
      const triangleKey = simplex.nodes.sort().join("|");
      
      // Check if this triangle fills a previously open 1-dimensional hole
      const edges = getTriangleEdges(simplex.nodes);
      const allEdgesExisted = edges.every(edge => {
        const edgeKey = edge.sort().join("|");
        return simplices.some(s => 
          s.simplex.nodes.length === 2 && 
          s.simplex.nodes.sort().join("|") === edgeKey &&
          s.weight > weight
        );
      });
      
      if (allEdgesExisted && !appearedTriangles.has(triangleKey)) {
        appearedTriangles.add(triangleKey);
        events.push({
          threshold: weight,
          type: 'triangle-close',
          nodes: simplex.nodes,
          description: `Triangle closes: ${simplex.nodes.join(" · ")}`,
        });
      }
    }
  }

  return events.sort((a, b) => b.threshold - a.threshold);
}

function getSimplexWeight(simplex: Simplex, metric: RenderFilterMetric): number {
  if (metric === "confidence") return simplex.confidence ?? simplex.weight ?? 0;
  if (metric === "decayed-weight") return simplex.decayedWeight ?? simplex.weight ?? simplex.confidence ?? 0;
  return simplex.weight ?? simplex.decayedWeight ?? simplex.confidence ?? 0;
}

function getTriangleEdges(nodes: NodeID[]): [NodeID, NodeID][] {
  const edges: [NodeID, NodeID][] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      edges.push([nodes[i], nodes[j]]);
    }
  }
  return edges;
}

/**
 * Get unique threshold values where events occur, for slider markers.
 */
export function getEventThresholds(events: FiltrationEvent[]): number[] {
  const thresholds = new Set(events.map(e => Math.round(e.threshold * 100) / 100));
  return [...thresholds].sort((a, b) => a - b);
}
