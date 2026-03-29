import type { LayoutNode, Simplex } from "../core/types";
import { SimplicialModel } from "../core/model";
import { effectiveColorForSimplex } from "./palette";

type Point = { x: number; y: number };
type BlobCacheEntry = { canvas: HTMLCanvasElement; x: number; y: number; positions: Point[] };

const cache = new Map<string, BlobCacheEntry>();

function resolveNodes(simplex: Simplex, nodes: LayoutNode[]): LayoutNode[] {
  return simplex.nodes.map((id) => nodes.find((node) => node.id === id)).filter(Boolean) as LayoutNode[];
}

function centroid(points: Point[]): Point {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function sortByAngle(points: Point[]): Point[] {
  const c = centroid(points);
  return [...points].sort(
    (a, b) => Math.atan2(a.y - c.y, a.x - c.x) - Math.atan2(b.y - c.y, b.x - c.x),
  );
}

function expandPoints(points: Point[], radius: number): Point[] {
  const c = centroid(points);
  return points.map((point) => {
    const dx = point.x - c.x;
    const dy = point.y - c.y;
    const distance = Math.hypot(dx, dy) || 1;
    return { x: point.x + (dx / distance) * radius, y: point.y + (dy / distance) * radius };
  });
}

function drawSmoothClosed(ctx: CanvasRenderingContext2D, points: Point[]): void {
  const n = points.length;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    const tension = 0.45;
    const c1x = p1.x + ((p2.x - p0.x) * tension) / 2;
    const c1y = p1.y + ((p2.y - p0.y) * tension) / 2;
    const c2x = p2.x - ((p3.x - p1.x) * tension) / 2;
    const c2y = p2.y - ((p3.y - p1.y) * tension) / 2;
    if (i === 0) ctx.moveTo(p1.x, p1.y);
    ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p2.x, p2.y);
  }
  ctx.closePath();
}

export function drawCapsule(ctx: CanvasRenderingContext2D, p1: Point, p2: Point, radius: number): void {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const distance = Math.hypot(dx, dy) || 1;
  const nx = (-dy / distance) * radius;
  const ny = (dx / distance) * radius;
  const angle = Math.atan2(dy, dx);
  ctx.beginPath();
  ctx.moveTo(p1.x + nx, p1.y + ny);
  ctx.lineTo(p2.x + nx, p2.y + ny);
  ctx.arc(p2.x, p2.y, radius, angle - Math.PI / 2, angle + Math.PI / 2);
  ctx.lineTo(p1.x - nx, p1.y - ny);
  ctx.arc(p1.x, p1.y, radius, angle + Math.PI / 2, angle - Math.PI / 2);
  ctx.closePath();
}

function areCollinear(points: Point[]): boolean {
  if (points.length < 3) return true;
  const [a, b] = points;
  for (let i = 2; i < points.length; i++) {
    const p = points[i];
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (Math.abs(cross) > 0.001) return false;
  }
  return true;
}

function renderBlobToOffscreen(simplexKey: string, simplex: Simplex, nodes: LayoutNode[], blobR: number): BlobCacheEntry | null {
  const ns = resolveNodes(simplex, nodes);
  if (!ns.length) return null;
  const positions = ns.map((node) => ({ x: node.px, y: node.py }));
  const existing = cache.get(simplexKey);
  if (existing && positions.every((point, index) => Math.hypot(point.x - existing.positions[index].x, point.y - existing.positions[index].y) <= 2)) {
    return existing;
  }

  const margin = blobR * 2.5;
  const xs = ns.map((node) => node.px);
  const ys = ns.map((node) => node.py);
  const x0 = Math.min(...xs) - margin;
  const y0 = Math.min(...ys) - margin;
  const width = Math.max(...xs) - x0 + margin;
  const height = Math.max(...ys) - y0 + margin;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.translate(-x0, -y0);
  ctx.fillStyle = "#ffffff";

  if (ns.length === 1) {
    ctx.beginPath();
    ctx.arc(ns[0].px, ns[0].py, blobR, 0, Math.PI * 2);
    ctx.fill();
  } else if (areCollinear(positions)) {
    drawCapsule(ctx, positions[0], positions[positions.length - 1], blobR);
    ctx.fill();
  } else {
    for (let i = 0; i < ns.length; i++) {
      for (let j = i + 1; j < ns.length; j++) {
        drawCapsule(ctx, { x: ns[i].px, y: ns[i].py }, { x: ns[j].px, y: ns[j].py }, blobR);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(ns[i].px, ns[i].py, blobR, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const entry = { canvas, x: x0, y: y0, positions };
  cache.set(simplexKey, entry);
  return entry;
}

export function drawBlobShape(ctx: CanvasRenderingContext2D, ns: LayoutNode[], blobR: number): void {
  const points = ns.map((node) => ({ x: node.px, y: node.py }));
  if (ns.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, blobR, 0, Math.PI * 2);
    return;
  }
  if (ns.length === 2 || areCollinear(points)) {
    drawCapsule(ctx, points[0], points[points.length - 1], blobR);
    return;
  }
  drawSmoothClosed(ctx, expandPoints(sortByAngle(points), blobR));
}

export function renderBlob(
  ctx: CanvasRenderingContext2D,
  simplexKey: string,
  simplex: Simplex,
  model: SimplicialModel,
  nodes: LayoutNode[],
  baseAlpha: number,
  focusState: { isActive: boolean; involvesSimplex(simplex: Simplex, key?: string): boolean },
): void {
  const ns = resolveNodes(simplex, nodes);
  if (!ns.length) return;
  const [r, g, b] = effectiveColorForSimplex(model, simplex);
  const blobR = 36 + (simplex.weight ?? 1) * 24 + (simplex.nodes.length - 1 === 3 ? 20 : 0);
  const alpha = focusState.isActive
    ? focusState.involvesSimplex(simplex, simplexKey) ? baseAlpha : baseAlpha * 0.18
    : baseAlpha;

  const entry = renderBlobToOffscreen(simplexKey, simplex, nodes, blobR);
  if (!entry) return;

  const passes: Array<{ alpha: number; blur: number }> = [
    { alpha: alpha * 0.15, blur: 18 },
    { alpha: alpha * 0.42, blur: 12 },
    { alpha, blur: 8 },
  ];

  passes.forEach((pass) => {
    ctx.save();
    ctx.globalAlpha = pass.alpha;
    ctx.filter = `blur(${pass.blur}px)`;
    ctx.drawImage(entry.canvas, entry.x, entry.y);
    ctx.filter = "none";
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(entry.x, entry.y, entry.canvas.width, entry.canvas.height);
    ctx.globalCompositeOperation = "source-over";
    ctx.restore();
  });
}
