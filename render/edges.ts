import type { LayoutNode, NodeID, Simplex } from "../core/types";
import { colorForSimplex } from "./palette";

export function renderEdges(
  ctx: CanvasRenderingContext2D,
  simplices: Simplex[],
  nodes: Map<NodeID, LayoutNode>,
  showEdges: boolean,
  focusState: { isActive: boolean; involvesSimplex(simplex: Simplex): boolean },
): void {
  if (!showEdges) return;
  const drawn = new Set<string>();

  simplices.forEach((simplex) => {
    const ns = simplex.nodes.map((id) => nodes.get(id)).filter(Boolean) as LayoutNode[];
    const isActive = !focusState.isActive || focusState.involvesSimplex(simplex);
    const [r, g, b] = colorForSimplex(simplex);
    for (let i = 0; i < ns.length; i++) {
      for (let j = i + 1; j < ns.length; j++) {
        const key = [ns[i].id, ns[j].id].sort().join("|");
        if (drawn.has(key)) continue;
        drawn.add(key);
        ctx.strokeStyle = `rgba(${r},${g},${b},${isActive ? 0.22 : 0.06})`;
        ctx.lineWidth = isActive ? 1 : 0.5;
        ctx.beginPath();
        ctx.moveTo(ns[i].px, ns[i].py);
        ctx.lineTo(ns[j].px, ns[j].py);
        ctx.stroke();
      }
    }
  });
}
