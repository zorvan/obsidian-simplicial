import type { SimplicialModel } from "../../core/model";
import type { Hole } from "../../core/types";

export interface VisibleBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function drawPhantomHoles(
  ctx: CanvasRenderingContext2D,
  model: SimplicialModel,
  isDark: boolean,
  visibleBounds: VisibleBounds,
  hoveredHoleKey: string | null,
): void {
  const analysis = model.getAnalysisSummary();
  if (!analysis.betti?.holes?.length) return;

  const allNodes = model.getAllNodes();
  const nodeMap = new Map(allNodes.map(n => [n.id, n]));

  ctx.save();
  ctx.setLineDash([8, 4]);
  ctx.lineWidth = 1.5;

  for (const hole of analysis.betti.holes) {
    drawSingleHole(ctx, hole, nodeMap, isDark, visibleBounds, hoveredHoleKey);
  }

  ctx.restore();
}

function drawSingleHole(
  ctx: CanvasRenderingContext2D,
  hole: Hole,
  nodeMap: Map<string, { px: number; py: number }>,
  isDark: boolean,
  visibleBounds: VisibleBounds,
  hoveredHoleKey: string | null,
): void {
  const nodes = hole.boundaryNodes
    .map(id => nodeMap.get(id))
    .filter(Boolean) as Array<{ px: number; py: number }>;

  if (nodes.length < 3) return;

  // Check if all nodes have valid positions (not at origin or uninitialized)
  const validNodes = nodes.filter(n => Math.abs(n.px) > 1 && Math.abs(n.py) > 1);
  if (validNodes.length < 3) return;

  // Calculate centroid
  const centroid = validNodes.reduce(
    (sum, n) => ({ x: sum.x + n.px, y: sum.y + n.py }),
    { x: 0, y: 0 }
  );
  centroid.x /= validNodes.length;
  centroid.y /= validNodes.length;

  // Skip if hole is far outside visible area (generous margin)
  const margin = 300;
  const holeMinX = Math.min(...validNodes.map(n => n.px));
  const holeMaxX = Math.max(...validNodes.map(n => n.px));
  const holeMinY = Math.min(...validNodes.map(n => n.py));
  const holeMaxY = Math.max(...validNodes.map(n => n.py));

  // Skip if entire hole is outside viewport (with margin)
  if (holeMaxX < visibleBounds.minX - margin ||
      holeMinX > visibleBounds.maxX + margin ||
      holeMaxY < visibleBounds.minY - margin ||
      holeMinY > visibleBounds.maxY + margin) {
    return;
  }

  // Also skip if hole is too close to origin (uninitialized cluster)
  const distFromOrigin = Math.sqrt(centroid.x ** 2 + centroid.y ** 2);
  if (distFromOrigin < 50) return;

  // Generate hole key from boundary nodes
  const holeKey = hole.boundaryNodes.sort().join("|");
  const isHovered = hoveredHoleKey === holeKey;

  // Draw phantom simplex outline
  ctx.strokeStyle = isHovered
    ? "rgba(255, 165, 0, 0.9)"
    : isDark
      ? "rgba(255, 165, 0, 0.5)"
      : "rgba(255, 140, 0, 0.6)";

  ctx.beginPath();
  ctx.moveTo(validNodes[0].px, validNodes[0].py);
  for (let i = 1; i < validNodes.length; i++) {
    ctx.lineTo(validNodes[i].px, validNodes[i].py);
  }
  ctx.closePath();
  ctx.stroke();

  // Fill with subtle color
  ctx.fillStyle = isHovered
    ? "rgba(255, 165, 0, 0.15)"
    : "rgba(255, 165, 0, 0.05)";
  ctx.fill();

  // Draw missing indicator at centroid (only if hovered or hole is small)
  const holeSize = Math.sqrt(
    validNodes.reduce((sum, n) => sum + (n.px - centroid.x) ** 2 + (n.py - centroid.y) ** 2, 0)
    / validNodes.length
  );

  if (isHovered || holeSize < 200) {
    ctx.fillStyle = isHovered ? "rgba(255, 165, 0, 0.9)" : "rgba(255, 165, 0, 0.6)";
    ctx.beginPath();
    ctx.arc(centroid.x, centroid.y, isHovered ? 8 : 5, 0, Math.PI * 2);
    ctx.fill();

    // Label with dimension info
    ctx.font = "500 12px system-ui, sans-serif";
    ctx.fillStyle = isDark ? "rgba(255, 255, 255, 0.8)" : "rgba(0, 0, 0, 0.7)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const label = hole.dimension === 1 ? "Missing Δ" : "Missing □";
    ctx.fillText(label, centroid.x, centroid.y - 14);

    // Show node count
    ctx.font = "400 10px system-ui, sans-serif";
    ctx.fillStyle = isDark ? "rgba(255, 255, 255, 0.5)" : "rgba(0, 0, 0, 0.5)";
    ctx.fillText(`${validNodes.length} nodes`, centroid.x, centroid.y + 14);
  }
}
