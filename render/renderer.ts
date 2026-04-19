import type { LayoutNode, PluginSettings, Rect, RenderFilterMetric, Simplex } from "../core/types";
import { normalizeKey } from "../core/normalize";
import { SimplicialModel } from "../core/model";
import { LayoutEngine } from "../layout/engine";
import { InteractionController } from "../interaction/controller";
import { renderBlob } from "./blobs";
import { renderEdges } from "./edges";
import { effectiveColorForSimplex } from "./palette";

interface RendererCallbacks {
  onContextMenu?: (target: { nodeId?: string; simplexKey?: string }, event: MouseEvent) => void;
  onLassoCreate?: (nodeIds: string[]) => void;
  onNodeOpen?: (nodeId: string) => void;
}

type Box = { left: number; top: number; right: number; bottom: number };

function pointInPolygon(point: { x: number; y: number }, polygon: Array<{ x: number; y: number }>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects = ((yi > point.y) !== (yj > point.y))
      && point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || 1e-6) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function simplexPolygon(simplex: Simplex, nodes: LayoutNode[]): Array<{ x: number; y: number }> {
  const points = simplex.nodes
    .map((id) => nodes.find((node) => node.id === id))
    .filter(Boolean)
    .map((node) => ({ x: (node as LayoutNode).px, y: (node as LayoutNode).py }));
  if (points.length <= 2) return points;
  const center = {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
  return [...points].sort(
    (a, b) => Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x),
  );
}

export class Renderer {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private dpr = window.devicePixelRatio || 1;
  private W = 0;
  private H = 0;
  private userZoom = 1;
  private userPanX = 0;
  private userPanY = 0;
  private viewZoom = 1;
  private viewOffsetX = 0;
  private viewOffsetY = 0;
  private readonly MIN_ZOOM = 0.6;
  private readonly MAX_ZOOM = 3.5;
  private readonly FIT_PADDING = 84;
  private readonly MIN_NODE_RADIUS = 18;
  private resizeHandler = () => this.resize();
  private isDark = false;
  private mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  private pointer = { x: 0, y: 0 };
  private lassoPath: Array<{ x: number; y: number }> = [];
  private isLassoActive = false;
  private hoveredHoleKey: string | null = null;
  private isPanning = false;
  private panStartScreenX = 0;
  private panStartScreenY = 0;
  private panMoved = false;
  private suppressNextClick = false;
  private themeHandler = () => {
    this.isDark = this.detectDarkMode();
    this.render();
  };

  // Performance optimizations
  private textWidthCache = new Map<string, number>();
  private viewportPadding = 100; // Extra padding around viewport for smooth scrolling
  private lastRenderedNodes = new Set<string>(); // Track which nodes were rendered last frame
  private progressiveSceneKey = "";
  private progressiveNodeBudget = 0;
  private progressiveSimplexBudget = 0;
  private readonly progressiveNodeStep = 140;
  private readonly progressiveSimplexStep = 220;

  constructor(
    private model: SimplicialModel,
    private engine: LayoutEngine,
    private controller: InteractionController,
    private settings: PluginSettings,
    private callbacks: RendererCallbacks = {},
  ) {}

  // Cached text measurement for performance
  private measureTextWidth(ctx: CanvasRenderingContext2D, text: string): number {
    if (this.textWidthCache.has(text)) {
      return this.textWidthCache.get(text)!;
    }
    const width = ctx.measureText(text).width;
    // Limit cache size to prevent memory leaks
    if (this.textWidthCache.size > 1000) {
      this.textWidthCache.clear();
    }
    this.textWidthCache.set(text, width);
    return width;
  }

  // Viewport culling: only render nodes visible on screen
  private getVisibleNodes(nodes: LayoutNode[]): LayoutNode[] {
    const viewportLeft = -this.viewOffsetX / this.viewZoom - this.viewportPadding;
    const viewportTop = -this.viewOffsetY / this.viewZoom - this.viewportPadding;
    const viewportRight = (-this.viewOffsetX + this.W) / this.viewZoom + this.viewportPadding;
    const viewportBottom = (-this.viewOffsetY + this.H) / this.viewZoom + this.viewportPadding;

    return nodes.filter(node =>
      node.px >= viewportLeft &&
      node.px <= viewportRight &&
      node.py >= viewportTop &&
      node.py <= viewportBottom
    );
  }

  private simplexStrength(simplex: Simplex, metric: RenderFilterMetric): number {
    if (metric === "confidence") return simplex.confidence ?? simplex.weight ?? 0;
    if (metric === "decayed-weight") return simplex.decayedWeight ?? simplex.weight ?? simplex.confidence ?? 0;
    return simplex.weight ?? simplex.decayedWeight ?? simplex.confidence ?? 0;
  }

  private passesRenderFilter(simplex: Simplex): boolean {
    return this.simplexStrength(simplex, this.settings.renderFilterMetric) >= this.settings.renderFilterThreshold;
  }

  private nodeVisualPriority(node: LayoutNode): { bucket: number; simplexCount: number } {
    const simplices = this.model.getSimplicesForNode(node.id);
    const hasCluster = simplices.some((simplex) => simplex.nodes.length >= 3);
    const hasEdge = simplices.some((simplex) => simplex.nodes.length === 2);
    const bucket = hasCluster ? 3 : hasEdge ? 2 : simplices.length > 0 ? 1 : 0;
    return { bucket, simplexCount: simplices.length };
  }

  private progressiveNodeKey(nodes: LayoutNode[]): string {
    const hovered = this.controller.hoveredNodeId ?? "";
    const locked = this.controller.lockedNodeId ?? "";
    return [
      this.viewZoom.toFixed(3),
      this.viewOffsetX.toFixed(1),
      this.viewOffsetY.toFixed(1),
      hovered,
      locked,
      nodes.length,
      this.settings.renderFilterMetric,
      this.settings.renderFilterThreshold.toFixed(2),
    ].join("|");
  }

  private rankVisibleNodes(nodes: LayoutNode[], focusNodeIds: Set<string>): LayoutNode[] {
    const centerX = (this.W / 2 - this.viewOffsetX) / this.viewZoom;
    const centerY = (this.H / 2 - this.viewOffsetY) / this.viewZoom;
    const hovered = this.controller.hoveredNodeId;
    const locked = this.controller.lockedNodeId;

    return [...nodes].sort((a, b) => {
      const aVisual = this.nodeVisualPriority(a);
      const bVisual = this.nodeVisualPriority(b);
      const aNetworkPriority = aVisual.bucket * 10 + Math.min(4, aVisual.simplexCount);
      const bNetworkPriority = bVisual.bucket * 10 + Math.min(4, bVisual.simplexCount);

      const aPriority = (a.id === hovered ? 6 : 0)
        + (a.id === locked ? 5 : 0)
        + (focusNodeIds.has(a.id) ? 4 : 0)
        + (a.isPinned ? 2 : 0)
        + aNetworkPriority;
      const bPriority = (b.id === hovered ? 6 : 0)
        + (b.id === locked ? 5 : 0)
        + (focusNodeIds.has(b.id) ? 4 : 0)
        + (b.isPinned ? 2 : 0)
        + bNetworkPriority;

      if (aPriority !== bPriority) return bPriority - aPriority;

      const aDist = (a.px - centerX) ** 2 + (a.py - centerY) ** 2;
      const bDist = (b.px - centerX) ** 2 + (b.py - centerY) ** 2;
      return aDist - bDist;
    });
  }

  private getProgressiveRenderableNodes(nodes: LayoutNode[], focusNodeIds: Set<string>): LayoutNode[] {
    const ranked = this.rankVisibleNodes(nodes, focusNodeIds);
    const sceneKey = this.progressiveNodeKey(ranked);
    if (sceneKey !== this.progressiveSceneKey) {
      this.progressiveSceneKey = sceneKey;
      this.progressiveNodeBudget = Math.min(ranked.length, this.progressiveNodeStep);
      this.progressiveSimplexBudget = this.progressiveSimplexStep;
    } else {
      this.progressiveNodeBudget = Math.min(ranked.length, this.progressiveNodeBudget + this.progressiveNodeStep);
      this.progressiveSimplexBudget += this.progressiveSimplexStep;
    }
    return ranked.slice(0, this.progressiveNodeBudget);
  }

  private getRenderableSimplices(
    simplices: Array<[string, Simplex]>,
    renderedNodeIds: Set<string>,
    focusSimplexKeys: Set<string>,
  ): Array<[string, Simplex]> {
    const ranked = simplices
      .filter(([, simplex]) => this.passesRenderFilter(simplex))
      .filter(([, simplex]) => simplex.nodes.every((nodeId) => renderedNodeIds.has(nodeId)))
      .sort((a, b) => {
        const [keyA, simplexA] = a;
        const [keyB, simplexB] = b;

        const dimPriorityA = simplexA.nodes.length >= 3 ? 20 : simplexA.nodes.length === 2 ? 10 : 0;
        const dimPriorityB = simplexB.nodes.length >= 3 ? 20 : simplexB.nodes.length === 2 ? 10 : 0;

        const scoreA = (focusSimplexKeys.has(keyA) ? 6 : 0)
          + (simplexA.suggested ? 2 : 0)
          + this.simplexStrength(simplexA, this.settings.renderFilterMetric)
          + simplexA.nodes.length * 0.05
          + dimPriorityA;

        const scoreB = (focusSimplexKeys.has(keyB) ? 6 : 0)
          + (simplexB.suggested ? 2 : 0)
          + this.simplexStrength(simplexB, this.settings.renderFilterMetric)
          + simplexB.nodes.length * 0.05
          + dimPriorityB;

        return scoreB - scoreA;
      });

    return ranked.slice(0, this.progressiveSimplexBudget);
  }

  // Optimized label placement using spatial hashing
  private canPlaceLabelFast(
    occupied: Box[],
    text: string,
    x: number,
    y: number,
  ): boolean {
    if (!this.ctx) return false;
    const width = this.measureTextWidth(this.ctx, text) + 12;
    const left = x - width / 2;
    const top = y - 14;
    const candidate = { left, top, right: left + width, bottom: top + 18 };

    // Quick spatial check - only check against nearby occupied boxes
    return !occupied.some((box) =>
      candidate.left < box.right &&
      candidate.right > box.left &&
      candidate.top < box.bottom &&
      candidate.bottom > box.top,
    );
  }

  init(container: HTMLElement): void {
    if (this.canvas && !this.canvas.isConnected) {
      this.destroy();
    }
    if (this.canvas) return;
    this.canvas = container.createEl("canvas", { cls: "simplicial-canvas" });
    this.ctx = this.canvas.getContext("2d");
    this.isDark = this.detectDarkMode();
    this.resize();
    window.addEventListener("resize", this.resizeHandler);
    this.mediaQuery.addEventListener("change", this.themeHandler);
    this.engine.start(
      () => this.render(),
      () => ({
        nodes: this.model.getAllNodes(),
        simplices: [...this.model.simplices.values()],
        bounds: { width: this.W, height: this.H },
        holdNode: this.controller.holdNode,
      }),
    );
    this.bindCanvasEvents();
  }

  private bindCanvasEvents(): void {
    if (!this.canvas) return;
    this.canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      const rect = this.canvas!.getBoundingClientRect();
      const screenPoint = {
        x: ((event.clientX - rect.left) * this.W) / rect.width,
        y: ((event.clientY - rect.top) * this.H) / rect.height,
      };
      this.zoomAt(screenPoint, event.deltaY);
      this.render();
    }, { passive: false });
    this.canvas.addEventListener("mousemove", (event) => {
      const rect = this.canvas!.getBoundingClientRect();
      const screenPoint = {
        x: ((event.clientX - rect.left) * this.W) / rect.width,
        y: ((event.clientY - rect.top) * this.H) / rect.height,
      };
      if (this.isPanning) {
        const dx = screenPoint.x - this.panStartScreenX;
        const dy = screenPoint.y - this.panStartScreenY;
        if (dx * dx + dy * dy > 1) this.panMoved = true;
        this.userPanX += dx;
        this.userPanY += dy;
        this.panStartScreenX = screenPoint.x;
        this.panStartScreenY = screenPoint.y;
        this.render();
        return;
      }
      const point = this.eventToCanvasPoint(event);
      this.pointer = point;
      if (this.isLassoActive) {
        this.lassoPath.push(point);
      } else if (this.controller.onPointerMove(point.x, point.y)) {
        this.suppressNextClick = true;
      } else {
        this.controller.updateHover(point.x, point.y, this.model.getAllNodes(), this.settings.metadataHoverDelayMs);
      }
      this.render();
    });
    this.canvas.addEventListener("mouseleave", () => {
      this.controller.cancelHoverSelection();
      this.controller.hoveredNodeId = null;
      this.controller.onMouseup();
      this.isPanning = false;
      this.panMoved = false;
      this.cancelLasso();
      this.render();
    });
    this.canvas.addEventListener("mousedown", (event) => {
      if (event.shiftKey) {
        const point = this.eventToCanvasPoint(event);
        this.isLassoActive = true;
        this.lassoPath = [point];
        this.controller.cancelHoverSelection();
        this.render();
        return;
      }
      const point = this.eventToCanvasPoint(event);
      const hoveredNode = this.findNodeNearPoint(point);
      if (hoveredNode) {
        this.controller.hoveredNodeId = hoveredNode.id;
        this.controller.onMousedown(hoveredNode.id, point.x, point.y);
        return;
      }
      const rect = this.canvas!.getBoundingClientRect();
      this.isPanning = true;
      this.panMoved = false;
      this.panStartScreenX = ((event.clientX - rect.left) * this.W) / rect.width;
      this.panStartScreenY = ((event.clientY - rect.top) * this.H) / rect.height;
    });
    this.canvas.addEventListener("mouseup", () => {
      const didDrag = this.controller.onMouseup();
      if (didDrag) this.suppressNextClick = true;
      if (this.isPanning && this.panMoved) this.suppressNextClick = true;
      this.isPanning = false;
      this.panMoved = false;
      if (this.isLassoActive) this.finishLasso();
    });
    this.canvas.addEventListener("dblclick", () => {
      if (this.controller.hoveredNodeId) this.callbacks.onNodeOpen?.(this.controller.hoveredNodeId);
      this.render();
    });
    this.canvas.addEventListener("click", (event) => {
      if (this.isLassoActive || this.suppressNextClick) {
        this.suppressNextClick = false;
        return;
      }
      const point = this.eventToCanvasPoint(event);
      const simplex = this.findSimplexAtPoint(point);
      this.controller.selectSimplex(simplex ? normalizeKey(simplex.nodes) : null);
      this.render();
    });
    this.canvas.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      const point = this.eventToCanvasPoint(event);
      const node = this.findNodeNearPoint(point);
      const simplex = this.findSimplexAtPoint(point);
      if (!node && !simplex) return;
      this.callbacks.onContextMenu?.(
        {
          ...(node ? { nodeId: node.id } : {}),
          ...(simplex ? { simplexKey: normalizeKey(simplex.nodes) } : {}),
        },
        event,
      );
    });
  }

  private eventToCanvasPoint(event: MouseEvent): { x: number; y: number } {
    const rect = this.canvas!.getBoundingClientRect();
    const screenPoint = {
      x: ((event.clientX - rect.left) * this.W) / rect.width,
      y: ((event.clientY - rect.top) * this.H) / rect.height,
    };
    return this.screenToWorld(screenPoint);
  }

  private screenToWorld(point: { x: number; y: number }): { x: number; y: number } {
    return {
      x: (point.x - this.viewOffsetX) / this.viewZoom,
      y: (point.y - this.viewOffsetY) / this.viewZoom,
    };
  }

  private worldToScreen(point: { x: number; y: number }): { x: number; y: number } {
    return {
      x: point.x * this.viewZoom + this.viewOffsetX,
      y: point.y * this.viewZoom + this.viewOffsetY,
    };
  }

  private worldRadius(screenRadius: number): number {
    return screenRadius / this.viewZoom;
  }

  private findNodeNearPoint(point: { x: number; y: number }): LayoutNode | null {
    const radius = this.worldRadius(20);
    return this.model.getAllNodes().find((node) => (node.px - point.x) ** 2 + (node.py - point.y) ** 2 <= radius * radius) ?? null;
  }

  private findSimplexAtPoint(point: { x: number; y: number }): Simplex | null {
    const simplices = [...this.model.simplices.values()]
      .filter((simplex) => simplex.nodes.length >= 2)
      .sort((a, b) => b.nodes.length - a.nodes.length);
    for (const simplex of simplices) {
      const polygon = simplexPolygon(simplex, this.model.getAllNodes());
      if (polygon.length === 2) {
        const [a, b] = polygon;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.abs(dy * point.x - dx * point.y + b.x * a.y - b.y * a.x) / (Math.hypot(dx, dy) || 1);
        const padding = this.worldRadius(8);
        if (
          point.x >= Math.min(a.x, b.x) - padding
          && point.x <= Math.max(a.x, b.x) + padding
          && point.y >= Math.min(a.y, b.y) - padding
          && point.y <= Math.max(a.y, b.y) + padding
          && distance <= this.worldRadius(10)
        ) return simplex;
        continue;
      }
      if (polygon.length >= 3 && pointInPolygon(point, polygon)) return simplex;
    }
    const hovered = this.findNodeNearPoint(point);
    return hovered
      ? this.model.getSimplicesForNode(hovered.id).sort((a, b) => b.nodes.length - a.nodes.length)[0] ?? null
      : null;
  }

  private finishLasso(): void {
    const points = this.lassoPath.length >= 3 ? this.lassoPath : [];
    const selected = points.length >= 3
      ? this.model.getAllNodes().filter((node) => pointInPolygon({ x: node.px, y: node.py }, points)).map((node) => node.id)
      : [];
    this.cancelLasso();
    this.suppressNextClick = true;
    if (selected.length >= 2) this.callbacks.onLassoCreate?.(selected);
    this.render();
  }

  private cancelLasso(): void {
    this.isLassoActive = false;
    this.lassoPath = [];
  }

  private detectDarkMode(): boolean {
    if (this.settings.darkMode === "force-dark") return true;
    if (this.settings.darkMode === "force-light") return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  private resize(): void {
    if (!this.canvas || !this.ctx) return;
    const rect = this.canvas.parentElement?.getBoundingClientRect();
    if (!rect) return;
    this.W = rect.width;
    this.H = rect.height;
    this.canvas.width = this.W * this.dpr;
    this.canvas.height = this.H * this.dpr;
    this.canvas.style.width = `${this.W}px`;
    this.canvas.style.height = `${this.H}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  private zoomAt(screenPoint: { x: number; y: number }, deltaY: number): void {
    const factor = Math.exp(-deltaY * 0.0015);
    const nextZoom = Math.max(this.MIN_ZOOM, Math.min(this.MAX_ZOOM, this.userZoom * factor));
    if (Math.abs(nextZoom - this.userZoom) < 0.0001) return;
    void screenPoint;
    this.userZoom = nextZoom;
  }

  private updateViewTransform(nodes: LayoutNode[]): void {
    if (!nodes.length || this.W <= 0 || this.H <= 0) {
      this.viewZoom = this.userZoom;
      this.viewOffsetX = this.W / 2;
      this.viewOffsetY = this.H / 2;
      return;
    }

    const connectedNodes = nodes.filter((node) => this.nodeVisualPriority(node).bucket >= 2);
    const fitNodes = connectedNodes.length > 0 ? connectedNodes : nodes;
    const pad = this.MIN_NODE_RADIUS;
    const minX = Math.min(...fitNodes.map((node) => node.px)) - pad;
    const maxX = Math.max(...fitNodes.map((node) => node.px)) + pad;
    const minY = Math.min(...fitNodes.map((node) => node.py)) - pad;
    const maxY = Math.max(...fitNodes.map((node) => node.py)) + pad;
    const contentWidth = Math.max(1, maxX - minX);
    const contentHeight = Math.max(1, maxY - minY);
    const fitWidth = Math.max(1, this.W - this.FIT_PADDING * 2);
    const fitHeight = Math.max(1, this.H - this.FIT_PADDING * 2);
    const fitZoom = Math.min(fitWidth / contentWidth, fitHeight / contentHeight);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    this.viewZoom = fitZoom * this.userZoom;
    this.viewOffsetX = this.W / 2 - centerX * this.viewZoom + this.userPanX;
    this.viewOffsetY = this.H / 2 - centerY * this.viewZoom + this.userPanY;
  }

  private alphaForDimension(dim: number, focused: boolean): number {
    if (dim === 1) return focused ? 0.18 : 0.1;
    if (dim === 2) return focused ? 0.18 : 0.13;
    if (dim === 3) return focused ? 0.11 : 0.07;
    return 0.05;
  }

  private formatNodeLabel(nodeId: string): string {
    return nodeId.split("/").pop()?.replace(/\.md$/, "") ?? nodeId;
  }

  private simplexPathText(nodeId: string, simplex: Simplex): string {
    const ordered = [nodeId, ...simplex.nodes.filter((id) => id !== nodeId)];
    return ordered.map((id) => this.formatNodeLabel(id)).join(" -> ");
  }

  private simplexDescriptor(simplex: Simplex): string {
    const cleanedLabel = simplex.label?.trim();
    if (cleanedLabel && cleanedLabel.toLowerCase() !== "soft cluster") return cleanedLabel;
    const signals = (simplex.inferredSignals ?? []).filter((signal) => signal !== "soft-cluster");
    if (signals.length > 0) {
      const reasons: string[] = [];
      const tagCounts = signals
        .filter((signal) => signal.startsWith("tags:"))
        .map((signal) => Number(signal.slice("tags:".length)))
        .filter((value) => Number.isFinite(value) && value > 0);
      const maxTagCount = tagCounts.length ? Math.max(...tagCounts) : 0;
      const hasSameFolder = signals.includes("folder:same");
      const hasTopFolder = signals.includes("folder:top");
      const hasForwardLink = signals.includes("link:a->b");
      const hasBackwardLink = signals.includes("link:b->a");
      const titleScores = signals
        .filter((signal) => signal.startsWith("title:"))
        .map((signal) => signal.slice("title:".length));
      const contentScores = signals
        .filter((signal) => signal.startsWith("content:"))
        .map((signal) => signal.slice("content:".length));

      if (hasForwardLink && hasBackwardLink) reasons.push("mutual link");
      else if (hasForwardLink || hasBackwardLink) reasons.push("direct link");
      if (maxTagCount > 0) reasons.push(maxTagCount === 1 ? "1 shared tag" : `${maxTagCount} shared tags`);
      if (hasSameFolder) reasons.push("same folder");
      else if (hasTopFolder) reasons.push("same top folder");
      if (titleScores.length) reasons.push("similar titles");
      if (contentScores.length) reasons.push("similar content");

      return reasons.join(" · ");
    }
    if (simplex.dominantSignal === "tags") return "tag relation";
    if (simplex.dominantSignal === "folder") return "folder relation";
    if (simplex.dominantSignal === "link") return "link relation";
    if (simplex.dominantSignal === "semantic") return "semantic relation";
    if (simplex.dominantSignal === "soft-cluster") return "soft cluster";
    if (simplex.sourcePath) return this.formatNodeLabel(simplex.sourcePath);
    return `dim ${simplex.nodes.length - 1} simplex`;
  }

  private largestNodeContext(nodeId: string): string | null {
    const containing = this.model.getSimplicesForNode(nodeId)
      .sort((a, b) => b.nodes.length - a.nodes.length || (b.weight ?? 1) - (a.weight ?? 1));
    if (containing.length > 0) return this.simplexDescriptor(containing[0]);
    return null;
  }

  private drawWrappedText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number,
  ): number {
    const words = text.split(/\s+/).filter(Boolean);
    if (!words.length) return y;
    let line = "";
    let cursorY = y;
    words.forEach((word) => {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth || !line) {
        line = candidate;
        return;
      }
      ctx.fillText(line, x, cursorY);
      cursorY += lineHeight;
      line = word;
    });
    if (line) ctx.fillText(line, x, cursorY);
    return cursorY + lineHeight;
  }

  private drawHoveredNodeOverlay(ctx: CanvasRenderingContext2D): void {
    const targetNodeId = this.controller.hoveredNodeId ?? this.controller.lockedNodeId;
    if (!targetNodeId) return;
    const node = this.model.nodes.get(targetNodeId);
    if (!node) return;
    const title = this.formatNodeLabel(targetNodeId);
    const path = this.largestNodeContext(targetNodeId);
    const primarySimplex = this.model.getSimplicesForNode(targetNodeId)[0];
    const [r, g, b] = primarySimplex
      ? effectiveColorForSimplex(this.model, primarySimplex)
      : [136, 135, 128];
    const screenPoint = this.worldToScreen({ x: node.px, y: node.py });

    ctx.save();
    ctx.font = "700 18px system-ui, sans-serif";
    const titleWidth = ctx.measureText(title).width;
    ctx.font = "500 12px system-ui, sans-serif";
    const pathWidth = path ? Math.min(320, ctx.measureText(path).width) : 0;
    const width = Math.min(Math.max(titleWidth + 28, pathWidth + 28, 180), 360);
    const height = path ? 48 : 26;
    const x = Math.min(Math.max(12, screenPoint.x + 14), this.W - width - 12);
    const y = Math.min(Math.max(24, screenPoint.y - height - 18), this.H - height - 12);

    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.shadowColor = this.isDark ? "rgba(10, 14, 22, 0.9)" : "rgba(255, 255, 255, 0.92)";
    ctx.shadowBlur = 10;
    ctx.font = "700 18px system-ui, sans-serif";
    ctx.fillText(title, x, y + 18);

    if (path) {
      ctx.fillStyle = this.isDark ? "rgba(235,240,248,0.88)" : "rgba(24,28,34,0.84)";
      ctx.shadowBlur = 8;
      ctx.font = "500 12px system-ui, sans-serif";
      this.drawWrappedText(ctx, path, x, y + 36, width, 16);
    }
    ctx.restore();
  }

  private drawFormalSimplex(ctx: CanvasRenderingContext2D, simplex: Simplex, focusActive: boolean): void {
    const polygon = simplexPolygon(simplex, this.model.getAllNodes());
    if (polygon.length < 2) return;
    const [r, g, b] = effectiveColorForSimplex(this.model, simplex);
    const alpha = focusActive ? 0.8 : 0.28;
    ctx.save();
    ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
    ctx.lineWidth = simplex.nodes.length >= 3 ? 1.6 : 1.1;
    if (polygon.length === 2) {
      ctx.beginPath();
      ctx.moveTo(polygon[0].x, polygon[0].y);
      ctx.lineTo(polygon[1].x, polygon[1].y);
      ctx.stroke();
      ctx.restore();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(polygon[0].x, polygon[0].y);
    polygon.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = `rgba(${r},${g},${b},${simplex.inferred ? 0.03 : 0.06})`;
    ctx.fill();
    ctx.restore();
  }

  private drawSuggestionOverlay(ctx: CanvasRenderingContext2D, simplexKey: string, simplex: Simplex): void {
    if (!this.settings.showSuggestions || !simplex.suggested || !simplex.inferred) return;
    const polygon = simplexPolygon(simplex, this.model.getAllNodes());
    if (polygon.length < 2) return;
    const [r, g, b] = effectiveColorForSimplex(this.model, simplex);
    ctx.save();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = `rgba(${r},${g},${b},0.7)`;
    ctx.lineWidth = 1;
    if (polygon.length === 2) {
      ctx.beginPath();
      ctx.moveTo(polygon[0].x, polygon[0].y);
      ctx.lineTo(polygon[1].x, polygon[1].y);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(polygon[0].x, polygon[0].y);
      polygon.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
      ctx.closePath();
      ctx.stroke();
    }
    ctx.setLineDash([]);
    const center = polygon.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
    center.x /= polygon.length;
    center.y /= polygon.length;
    const confidence = Math.round((simplex.confidence ?? simplex.weight ?? 0) * 100);
    const label = simplex.nodes.length > 2 ? `Form? ${confidence}%` : `${confidence}%`;
    ctx.font = "11px system-ui, sans-serif";
    const width = ctx.measureText(label).width + 10;
    ctx.fillStyle = this.isDark ? "rgba(10,14,22,0.85)" : "rgba(255,255,255,0.88)";
    ctx.beginPath();
    ctx.roundRect(center.x - width / 2, center.y - 10, width, 18, 9);
    ctx.fill();
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.textAlign = "center";
    ctx.fillText(label, center.x, center.y + 3);
    ctx.restore();
    void simplexKey;
  }

  render(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const allNodes = this.model.getAllNodes();
    const simplices = [...this.model.simplices.entries()]
      .filter(([, simplex]) => simplex.nodes.length - 1 <= this.settings.maxRenderedDim)
      .sort((a, b) => b[1].nodes.length - a[1].nodes.length);
    const focusState = this.controller.getFocusState();

    this.updateViewTransform(allNodes);
    const visibleNodes = this.getVisibleNodes(allNodes);
    const renderableNodes = this.getProgressiveRenderableNodes(visibleNodes, focusState.activeNodeIds);
    const renderedNodeIds = new Set(renderableNodes.map((node) => node.id));
    const renderableSimplices = this.getRenderableSimplices(simplices, renderedNodeIds, focusState.activeSimplexKeys);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    ctx.translate(this.viewOffsetX, this.viewOffsetY);
    ctx.scale(this.viewZoom, this.viewZoom);

    // Track rendered nodes for debugging
    this.lastRenderedNodes.clear();
    renderableNodes.forEach(node => this.lastRenderedNodes.add(node.id));

    const occupiedLabels: Box[] = [];
    let placedFreeLabels = 0;
    const freeLabelBudget = Math.max(4, Math.ceil(renderableNodes.length * this.settings.labelDensity));

    if (this.settings.formalMode) {
      renderableSimplices.forEach(([key, simplex]) => {
        const simplexDim = simplex.nodes.length - 1;
        if ((simplexDim === 1 && !this.settings.showEdges)
          || (simplexDim === 2 && !this.settings.showClusters)
          || (simplexDim >= 3 && !this.settings.showCores)) {
          return;
        }
        this.drawFormalSimplex(ctx, simplex, !focusState.isActive || focusState.involvesSimplex(simplex, key));
        this.drawSuggestionOverlay(ctx, key, simplex);
      });
    } else {
      renderableSimplices.forEach(([key, simplex]) => {
        const simplexDim = simplex.nodes.length - 1;
        if ((simplexDim === 1 && !this.settings.showEdges)
          || (simplexDim === 2 && !this.settings.showClusters)
          || (simplexDim >= 3 && !this.settings.showCores)) {
          return;
        }
        renderBlob(ctx, key, simplex, this.model, allNodes, this.alphaForDimension(simplexDim, focusState.isActive), focusState);
        this.drawSuggestionOverlay(ctx, key, simplex);
      });
    }

    if (!this.settings.formalMode) {
      renderEdges(ctx, renderableSimplices.map(([, simplex]) => simplex), this.model, this.model.nodes, this.settings.showEdges, focusState);
    }

    // Only render progressively loaded visible nodes
    renderableNodes.forEach((node) => {
      this.controller.lerpAlpha(node, focusState);
      const isHovered = node.id === focusState.hoveredNodeId;
      const isActive = !focusState.isActive || focusState.involvesNode(node.id);
      const primarySimplex = this.model.getSimplicesForNode(node.id)[0] ?? null;
      const [r, g, b] = primarySimplex ? effectiveColorForSimplex(this.model, primarySimplex) : [136, 135, 128];
      if (isHovered) {
        ctx.beginPath();
        ctx.arc(node.px, node.py, 15, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},0.10)`;
        ctx.fill();
      }
      ctx.beginPath();
      if (node.isVirtual) {
        ctx.arc(node.px, node.py, this.settings.formalMode ? 4.5 : isHovered ? 7 : 5, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${r},${g},${b},${node.displayAlpha})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else {
        ctx.arc(node.px, node.py, this.settings.formalMode ? 4.5 : isHovered ? 7 : 5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},${isActive ? node.displayAlpha : 0.2})`;
        ctx.fill();
      }

      if (node.isPinned) {
        ctx.beginPath();
        ctx.moveTo(node.px, node.py - 18);
        ctx.lineTo(node.px + 5, node.py - 13);
        ctx.lineTo(node.px, node.py - 8);
        ctx.lineTo(node.px - 5, node.py - 13);
        ctx.closePath();
        ctx.fillStyle = `rgba(${r},${g},${b},0.8)`;
        ctx.fill();
      }

      ctx.font = `${isHovered ? "500" : "400"} 12px system-ui, sans-serif`;
      const label = this.formatNodeLabel(node.id);
      const freeBudgetAvailable = placedFreeLabels < freeLabelBudget;
      const canPlace = this.canPlaceLabelFast(occupiedLabels, label, node.px, node.py - 13);
      const width = this.measureTextWidth(ctx, label) + 12;
      const visualPriority = this.nodeVisualPriority(node);
      
      // Determine if this label should be forced to show
      // - Always show hovered, pinned nodes
      // - Show on focus only for the focused node itself, not all connected nodes
      const isFocusedNode = isHovered || (focusState.lockedNodeId === node.id);
      const forceLabel = isFocusedNode || node.isPinned;
      const isClusterNode = visualPriority.bucket >= 3;
      const isEdgeNode = visualPriority.bucket === 2;
      const isDisconnected = visualPriority.bucket === 0;

      // keep disconnected nodes from flooding labels in large graphs;
      // clusters > edges > disconnected is the UX priority.
      const shouldDrawLabel = forceLabel
        || (isClusterNode && freeBudgetAvailable && canPlace)
        || (isEdgeNode && placedFreeLabels < Math.max(2, Math.floor(freeLabelBudget * 0.45)) && canPlace)
        || (!isDisconnected && focusState.isActive && freeBudgetAvailable && canPlace);

      if (!shouldDrawLabel) return;
      if (!forceLabel) placedFreeLabels++;
      const height = 18;
      const left = node.px - width / 2;
      const top = node.py - 27;
      occupiedLabels.push({ left, top, right: left + width, bottom: top + height });
      
      // Reduce text background opacity significantly to allow links/fields to show through
      // Dark: reduced from 0.55 to 0.28, Light: reduced from 0.78 to 0.42
      ctx.fillStyle = this.isDark ? "rgba(7,10,18,0.28)" : "rgba(255,255,255,0.42)";
      ctx.beginPath();
      ctx.roundRect(left, top, width, height, 9);
      ctx.fill();
      
      ctx.fillStyle = this.isDark
        ? `rgba(255,255,255,${isActive ? 0.88 : 0.32})`
        : `rgba(0,0,0,${isActive ? 0.72 : 0.28})`;
      ctx.textAlign = "center";
      ctx.fillText(label, node.px, node.py - 13);
    });

    if (this.isLassoActive && this.lassoPath.length > 1) {
      ctx.save();
      ctx.strokeStyle = this.isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.45)";
      ctx.fillStyle = this.isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)";
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(this.lassoPath[0].x, this.lassoPath[0].y);
      this.lassoPath.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
      ctx.stroke();
      ctx.lineTo(this.pointer.x, this.pointer.y);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawHoveredNodeOverlay(ctx);

    // Draw Betti HUD if enabled
    if (this.settings.bettiDisplayOnCanvas && this.settings.enableBettiComputation) {
      this.drawBettiHUD(ctx);
    }

    // Draw phantom holes (void-as-prompt)
    if (this.settings.enableBettiComputation) {
      this.drawPhantomHoles(ctx);
    }
  }

  private drawBettiHUD(ctx: CanvasRenderingContext2D): void {
    const analysis = this.model.getAnalysisSummary();
    if (!analysis.betti) return;

    const { b0, b1, b2 } = analysis.betti;
    const text = `β₀=${b0} β₁=${b1}${this.settings.maxBettiDim >= 2 ? ` β₂=${b2}` : ""}`;

    ctx.save();
    ctx.font = "600 13px system-ui, sans-serif";
    const textWidth = ctx.measureText(text).width;
    const padding = 10;
    const x = 14;
    const y = 14;
    const width = textWidth + padding * 2;
    const height = 26;

    // Background
    ctx.fillStyle = this.isDark
      ? "rgba(20, 24, 32, 0.85)"
      : "rgba(255, 255, 255, 0.85)";
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, 8);
    ctx.fill();

    // Border
    ctx.strokeStyle = this.isDark
      ? "rgba(255, 255, 255, 0.15)"
      : "rgba(0, 0, 0, 0.1)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Text
    ctx.fillStyle = this.isDark
      ? "rgba(235, 240, 248, 0.9)"
      : "rgba(24, 28, 34, 0.85)";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + padding, y + height / 2);
    ctx.restore();
  }

  private drawPhantomHoles(ctx: CanvasRenderingContext2D): void {
    const analysis = this.model.getAnalysisSummary();
    if (!analysis.betti?.holes?.length) return;

    const allNodes = this.model.getAllNodes();
    const nodeMap = new Map(allNodes.map(n => [n.id, n]));

    ctx.save();
    ctx.setLineDash([8, 4]);
    ctx.lineWidth = 1.5;

    // Get viewport bounds for visibility check
    const visibleBounds = this.getVisibleWorldBounds();

    for (const hole of analysis.betti.holes) {
      const nodes = hole.boundaryNodes
        .map(id => nodeMap.get(id))
        .filter(Boolean) as Array<{ px: number; py: number }>;

      if (nodes.length < 3) continue;

      // Check if all nodes have valid positions (not at origin or uninitialized)
      const validNodes = nodes.filter(n => Math.abs(n.px) > 1 && Math.abs(n.py) > 1);
      if (validNodes.length < 3) {
        // Skip holes where nodes aren't properly laid out yet
        continue;
      }

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
        continue;
      }

      // Also skip if hole is too close to origin (uninitialized cluster)
      const distFromOrigin = Math.sqrt(centroid.x ** 2 + centroid.y ** 2);
      if (distFromOrigin < 50) {
        continue;
      }

      // Generate hole key from boundary nodes
      const holeKey = hole.boundaryNodes.sort().join("|");
      const isHovered = this.hoveredHoleKey === holeKey;

      // Draw phantom simplex outline
      ctx.strokeStyle = isHovered
        ? "rgba(255, 165, 0, 0.9)"
        : this.isDark
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
        ctx.fillStyle = this.isDark ? "rgba(255, 255, 255, 0.8)" : "rgba(0, 0, 0, 0.7)";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const label = hole.dimension === 1 ? "Missing Δ" : "Missing □";
        ctx.fillText(label, centroid.x, centroid.y - 14);

        // Show node count
        ctx.font = "400 10px system-ui, sans-serif";
        ctx.fillStyle = this.isDark ? "rgba(255, 255, 255, 0.5)" : "rgba(0, 0, 0, 0.5)";
        ctx.fillText(`${validNodes.length} nodes`, centroid.x, centroid.y + 14);
      }
    }

    ctx.restore();
  }

  private getVisibleWorldBounds(): { minX: number; maxX: number; minY: number; maxY: number } {
    // Transform screen corners to world coordinates
    const tl = this.screenToWorld({ x: 0, y: 0 });
    const br = this.screenToWorld({ x: this.W, y: this.H });
    return {
      minX: Math.min(tl.x, br.x),
      maxX: Math.max(tl.x, br.x),
      minY: Math.min(tl.y, br.y),
      maxY: Math.max(tl.y, br.y),
    };
  }

  private canPlaceLabel(
    ctx: CanvasRenderingContext2D,
    occupied: Box[],
    text: string,
    x: number,
    y: number,
  ): boolean {
    return this.canPlaceLabelFast(occupied, text, x, y);
  }

  getBounds(): Rect {
    return { width: this.W, height: this.H };
  }

  destroy(): void {
    this.engine.stop();
    window.removeEventListener("resize", this.resizeHandler);
    this.mediaQuery.removeEventListener("change", this.themeHandler);
    this.canvas = null;
    this.ctx = null;
  }
}
