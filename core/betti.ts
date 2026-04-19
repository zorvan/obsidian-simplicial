import type { SimplicialModel } from "./model";
import type { NodeID, Simplex, BettiResult, Hole } from "./types";

interface Edge {
  a: NodeID;
  b: NodeID;
}

interface Triangle {
  nodes: [NodeID, NodeID, NodeID];
  edges: Edge[];
}

interface Tetrahedron {
  nodes: [NodeID, NodeID, NodeID, NodeID];
  triangles: Triangle[];
}

/**
 * Compute Betti numbers (β₀, β₁, β₂) for a simplicial complex.
 * 
 * β₀ = number of connected components (already computed in model)
 * β₁ = number of unfilled triangular holes (1-dimensional cycles)
 * β₂ = number of hollow tetrahedra (2-dimensional voids)
 * 
 * For practical purposes with vault sizes < 1000 simplices, we use
 * a direct enumeration approach rather than full boundary matrix rank computation.
 */
export function computeBetti(model: SimplicialModel, maxDim: 1 | 2 = 2): BettiResult {
  const simplices = [...model.simplices.values()];
  const nodes = [...model.nodes.keys()];

  const edges = simplices.filter(s => s.nodes.length === 2);
  const triangles = simplices.filter(s => s.nodes.length === 3);
  const tetrahedra = simplices.filter(s => s.nodes.length === 4);

  const b0 = computeConnectedComponents(nodes, edges);

  const b1Holes: Hole[] = [];
  if (maxDim >= 1) {
    b1Holes.push(...findUnfilledTriangles(nodes, edges, triangles));
  }

  const b2Holes: Hole[] = [];
  if (maxDim >= 2) {
    b2Holes.push(...findHollowTetrahedra(triangles, tetrahedra));
  }

  return {
    b0,
    b1: b1Holes.length,
    b2: b2Holes.length,
    holes: [...b1Holes, ...b2Holes],
  };
}

function computeConnectedComponents(nodeIds: NodeID[], edges: Simplex[]): number {
  if (nodeIds.length === 0) return 0;
  
  const adjacency = new Map<NodeID, Set<NodeID>>();
  for (const node of nodeIds) {
    adjacency.set(node, new Set());
  }
  
  for (const edge of edges) {
    const [a, b] = edge.nodes;
    adjacency.get(a)?.add(b);
    adjacency.get(b)?.add(a);
  }

  let components = 0;
  const visited = new Set<NodeID>();
  
  for (const node of nodeIds) {
    if (visited.has(node)) continue;
    
    components++;
    const stack = [node];
    
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!visited.has(neighbor)) {
          stack.push(neighbor);
        }
      }
    }
  }
  
  return components;
}

/**
 * Find unfilled triangles (β₁ holes).
 * A β₁ hole exists when three nodes are pairwise connected by edges,
 * but no 2-simplex (triangle) exists connecting all three.
 */
function findUnfilledTriangles(
  nodeIds: NodeID[],
  edges: Simplex[],
  triangles: Simplex[],
): Hole[] {
  const holes: Hole[] = [];
  
  const edgeSet = new Set<string>();
  for (const edge of edges) {
    const [a, b] = edge.nodes.sort();
    edgeSet.add(`${a}|${b}`);
  }
  
  const triangleSet = new Set<string>();
  for (const tri of triangles) {
    triangleSet.add(tri.nodes.sort().join("|"));
  }
  
  const adjacency = new Map<NodeID, Set<NodeID>>();
  for (const node of nodeIds) {
    adjacency.set(node, new Set());
  }
  for (const edge of edges) {
    const [a, b] = edge.nodes;
    adjacency.get(a)?.add(b);
    adjacency.get(b)?.add(a);
  }

  for (let i = 0; i < nodeIds.length; i++) {
    const a = nodeIds[i];
    const neighbors = [...(adjacency.get(a) ?? [])];
    
    for (let j = 0; j < neighbors.length; j++) {
      for (let k = j + 1; k < neighbors.length; k++) {
        const b = neighbors[j];
        const c = neighbors[k];
        
        const bNeighbors = adjacency.get(b);
        if (!bNeighbors?.has(c)) continue;
        
        const sortedNodes = [a, b, c].sort();
        const triangleKey = sortedNodes.join("|");
        
        if (!triangleSet.has(triangleKey)) {
          holes.push({
            dimension: 1,
            boundaryNodes: sortedNodes,
            missingSimplex: sortedNodes,
          });
        }
      }
    }
  }
  
  return holes;
}

/**
 * Find hollow tetrahedra (β₂ voids).
 * A β₂ void exists when four nodes form a closed surface of 4 triangles,
 * but no 3-simplex (tetrahedron) exists connecting all four.
 */
function findHollowTetrahedra(
  triangles: Simplex[],
  tetrahedra: Simplex[],
): Hole[] {
  const holes: Hole[] = [];
  
  const triangleSet = new Set<string>();
  const triangleNodes = new Map<string, NodeID[]>();
  
  for (const tri of triangles) {
    const sorted = tri.nodes.sort();
    const key = sorted.join("|");
    triangleSet.add(key);
    triangleNodes.set(key, sorted);
  }
  
  const tetraSet = new Set<string>();
  for (const tet of tetrahedra) {
    tetraSet.add(tet.nodes.sort().join("|"));
  }
  
  const edgeToTriangles = new Map<string, Set<string>>();
  
  for (const [triKey, nodes] of triangleNodes) {
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        const edge = [nodes[i], nodes[j]].sort().join("|");
        if (!edgeToTriangles.has(edge)) {
          edgeToTriangles.set(edge, new Set());
        }
        edgeToTriangles.get(edge)!.add(triKey);
      }
    }
  }
  
  const tetraCandidates = new Map<string, Set<NodeID>>();
  
  for (const [edge, tris] of edgeToTriangles) {
    if (tris.size < 2) continue;
    
    const triList = [...tris];
    for (let i = 0; i < triList.length; i++) {
      for (let j = i + 1; j < triList.length; j++) {
        const nodes1 = triangleNodes.get(triList[i])!;
        const nodes2 = triangleNodes.get(triList[j])!;
        
        const set1 = new Set(nodes1);
        const set2 = new Set(nodes2);
        
        const shared = [...set1].filter(n => set2.has(n));
        if (shared.length !== 2) continue;
        
        const unique1 = [...set1].filter(n => !set2.has(n))[0];
        const unique2 = [...set2].filter(n => !set1.has(n))[0];
        
        if (!unique1 || !unique2) continue;
        
        const allNodes = [unique1, unique2, ...shared].sort();
        const tetraKey = allNodes.join("|");
        
        if (!tetraCandidates.has(tetraKey)) {
          tetraCandidates.set(tetraKey, new Set(allNodes));
        }
      }
    }
  }
  
  for (const [tetraKey, nodes] of tetraCandidates) {
    if (tetraSet.has(tetraKey)) continue;
    
    const nodeList = [...nodes].sort();
    if (nodeList.length !== 4) continue;
    
    let faceCount = 0;
    for (let i = 0; i < 4; i++) {
      const faceNodes = nodeList.filter((_, idx) => idx !== i).sort();
      if (triangleSet.has(faceNodes.join("|"))) {
        faceCount++;
      }
    }
    
    if (faceCount === 4) {
      holes.push({
        dimension: 2,
        boundaryNodes: nodeList,
        missingSimplex: nodeList,
      });
    }
  }
  
  return holes;
}
