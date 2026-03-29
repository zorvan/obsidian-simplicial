import { HOLD_REPULSION } from "../core/types";
import type { LayoutNode, Rect, Simplex } from "../core/types";

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export class LayoutEngine {
  private MIN_NODE_SEPARATION = 72;
  private REPULSION = 2400;
  private COHESION = 0.005;
  private GRAVITY = 0.0007;
  private NOISE = 0.12;
  private DAMPING = 0.84;
  private SLEEP_THRESHOLD = 0.01;
  private BOUNDARY_PADDING = 50;
  private SPARSE_EDGE_LENGTH = 150;
  private SPARSE_GRAVITY_BOOST = 1.8;
  private isAsleep = false;
  private animFrame: number | null = null;
  private renderFn: (() => void) | null = null;
  private getState:
    | (() => { nodes: LayoutNode[]; simplices: Simplex[]; bounds: Rect; holdNode: string | null })
    | null = null;

  configure(opts: {
    noiseAmount?: number;
    sleepThreshold?: number;
    repulsionStrength?: number;
    cohesionStrength?: number;
    gravityStrength?: number;
    dampingFactor?: number;
    boundaryPadding?: number;
    sparseEdgeLength?: number;
    sparseGravityBoost?: number;
  }): void {
    if (opts.noiseAmount !== undefined) this.NOISE = opts.noiseAmount;
    if (opts.sleepThreshold !== undefined) this.SLEEP_THRESHOLD = opts.sleepThreshold;
    if (opts.repulsionStrength !== undefined) this.REPULSION = opts.repulsionStrength;
    if (opts.cohesionStrength !== undefined) this.COHESION = opts.cohesionStrength;
    if (opts.gravityStrength !== undefined) this.GRAVITY = opts.gravityStrength;
    if (opts.dampingFactor !== undefined) this.DAMPING = opts.dampingFactor;
    if (opts.boundaryPadding !== undefined) this.BOUNDARY_PADDING = opts.boundaryPadding;
    if (opts.sparseEdgeLength !== undefined) this.SPARSE_EDGE_LENGTH = opts.sparseEdgeLength;
    if (opts.sparseGravityBoost !== undefined) this.SPARSE_GRAVITY_BOOST = opts.sparseGravityBoost;
  }

  start(renderFn: () => void, getState: () => { nodes: LayoutNode[]; simplices: Simplex[]; bounds: Rect; holdNode: string | null }): void {
    this.renderFn = renderFn;
    this.getState = getState;
    if (this.animFrame !== null) cancelAnimationFrame(this.animFrame);
    const loop = () => {
      const { nodes, simplices, bounds, holdNode } = getState();
      this.tick(nodes, simplices, bounds, holdNode);
      renderFn();
      if (!this.isAsleep) {
        this.animFrame = requestAnimationFrame(loop);
      }
    };
    this.isAsleep = false;
    this.animFrame = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.animFrame !== null) cancelAnimationFrame(this.animFrame);
    this.animFrame = null;
    this.isAsleep = true;
  }

  wake(): void {
    if (!this.isAsleep || !this.renderFn || !this.getState) return;
    this.isAsleep = false;
    this.start(this.renderFn, this.getState);
  }

  tick(nodes: LayoutNode[], simplices: Simplex[], bounds: Rect, holdNode: string | null): void {
    const edgeLikeSimplices = simplices.filter((simplex) => simplex.nodes.length === 2);
    const sparseGraph = edgeLikeSimplices.length > 0
      && simplices.every((simplex) => simplex.nodes.length <= 2 || simplex.inferred);
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const connectionStrengths = new Map<string, number>();

    simplices.forEach((simplex) => {
      const simplexWeight = simplex.weight ?? 1;
      const pairBoost = simplex.nodes.length === 2
        ? 1
        : 1 + Math.min(1.2, (simplex.nodes.length - 2) * 0.4);
      for (let i = 0; i < simplex.nodes.length; i++) {
        for (let j = i + 1; j < simplex.nodes.length; j++) {
          const key = pairKey(simplex.nodes[i], simplex.nodes[j]);
          const next = (connectionStrengths.get(key) ?? 0) + simplexWeight * pairBoost;
          connectionStrengths.set(key, Math.min(3.5, next));
        }
      }
    });

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = b.px - a.px;
        const dy = b.py - a.py;
        const distance = Math.hypot(dx, dy) || 1;
        const d2 = distance * distance + 1;
        const connectionStrength = connectionStrengths.get(pairKey(a.id, b.id)) ?? 0;
        const f = this.REPULSION / d2;
        if (!a.isPinned) {
          a.vx -= f * dx;
          a.vy -= f * dy;
        }
        if (!b.isPinned) {
          b.vx += f * dx;
          b.vy += f * dy;
        }

        const ux = dx / distance;
        const uy = dy / distance;
        const overlap = Math.max(0, this.MIN_NODE_SEPARATION - distance);
        if (overlap > 0) {
          const nodeSeparationForce = overlap * this.COHESION * 0.55;
          if (!a.isPinned) {
            a.vx -= nodeSeparationForce * ux;
            a.vy -= nodeSeparationForce * uy;
          }
          if (!b.isPinned) {
            b.vx += nodeSeparationForce * ux;
            b.vy += nodeSeparationForce * uy;
          }
        }

        if (connectionStrength > 0) {
          const closeness = Math.min(1.6, connectionStrength);
          const targetDistance = Math.max(this.MIN_NODE_SEPARATION * 1.05, this.SPARSE_EDGE_LENGTH * (1.08 - closeness * 0.2));
          const stretch = distance - targetDistance;
          const springForce = stretch * this.COHESION * 0.16 * (1 + connectionStrength * 0.9);
          const personalSpace = targetDistance * 0.68;
          const personalOverlap = Math.max(0, personalSpace - distance);
          const separationForce = personalOverlap * this.COHESION * 0.28 * (1 + connectionStrength * 1.1);

          if (!a.isPinned) {
            a.vx += springForce * ux - separationForce * ux;
            a.vy += springForce * uy - separationForce * uy;
          }
          if (!b.isPinned) {
            b.vx -= springForce * ux - separationForce * ux;
            b.vy -= springForce * uy - separationForce * uy;
          }
        } else {
          const exclusionRadius = Math.max(this.SPARSE_EDGE_LENGTH * 1.2, this.MIN_NODE_SEPARATION * 1.8);
          if (distance < exclusionRadius) {
            const repelRatio = (exclusionRadius - distance) / exclusionRadius;
            const separationForce = this.REPULSION * 0.012 * repelRatio * repelRatio;
            if (!a.isPinned) {
              a.vx -= separationForce * ux;
              a.vy -= separationForce * uy;
            }
            if (!b.isPinned) {
              b.vx += separationForce * ux;
              b.vy += separationForce * uy;
            }
          }
        }
      }
    }

    simplices.forEach((simplex) => {
      if (simplex.nodes.length < 3) return;
      const ns = simplex.nodes.map((id) => nodeById.get(id)).filter(Boolean) as LayoutNode[];
      if (!ns.length) return;
      const cx = ns.reduce((sum, node) => sum + node.px, 0) / ns.length;
      const cy = ns.reduce((sum, node) => sum + node.py, 0) / ns.length;
      const weight = simplex.weight ?? 1;
      ns.forEach((node) => {
        if (node.isPinned) return;
        node.vx += (cx - node.px) * this.COHESION * weight * 0.75;
        node.vy += (cy - node.py) * this.COHESION * weight * 0.75;
      });
    });

    if (holdNode) {
      const held = nodeById.get(holdNode);
      if (held) {
        nodes.forEach((node) => {
          if (node === held || node.isPinned) return;
          const dx = node.px - held.px;
          const dy = node.py - held.py;
          const d2 = dx * dx + dy * dy + 1;
          node.vx += (dx / d2) * HOLD_REPULSION;
          node.vy += (dy / d2) * HOLD_REPULSION;
        });
      }
    }

    const centroid = nodes.length > 0
      ? {
          x: nodes.reduce((sum, node) => sum + node.px, 0) / nodes.length,
          y: nodes.reduce((sum, node) => sum + node.py, 0) / nodes.length,
        }
      : { x: 0, y: 0 };
    nodes.forEach((node) => {
      if (node.isPinned) return;
      const gravity = sparseGraph ? this.GRAVITY * this.SPARSE_GRAVITY_BOOST : this.GRAVITY;
      node.vx += (0 - node.px) * gravity + (centroid.x - node.px) * gravity * 0.12 + (Math.random() - 0.5) * this.NOISE;
      node.vy += (0 - node.py) * gravity + (centroid.y - node.py) * gravity * 0.12 + (Math.random() - 0.5) * this.NOISE;
      node.vx *= this.DAMPING;
      node.vy *= this.DAMPING;
      node.px += node.vx;
      node.py += node.vy;
    });

    const kineticEnergy = nodes.reduce((sum, node) => sum + node.vx * node.vx + node.vy * node.vy, 0);
    if (kineticEnergy < this.SLEEP_THRESHOLD) {
      this.isAsleep = true;
    }
  }
}
