import { HOLD_REPULSION } from "../core/types";
import type { LayoutNode, Rect, Simplex } from "../core/types";

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// Barnes-Hut Quad-Tree for O(n log n) force calculations
class QuadTreeNode {
  public mass: number = 0;
  public cx: number = 0;
  public cy: number = 0;
  public children: (QuadTreeNode | null)[] = [null, null, null, null];
  public node: LayoutNode | null = null;

  constructor(
    public x: number,
    public y: number,
    public width: number,
    public height: number
  ) {}

  insert(node: LayoutNode): void {
    if (this.node === null && this.children[0] === null) {
      // Leaf node, store the node
      this.node = node;
      this.mass = 1;
      this.cx = node.px;
      this.cy = node.py;
      return;
    }

    if (this.node !== null) {
      // Split this node and reinsert both nodes
      this.subdivide();
      const oldNode = this.node;
      this.node = null;
      this.insertIntoChildren(oldNode);
      this.insertIntoChildren(node);
    } else {
      // Insert into appropriate child
      this.insertIntoChildren(node);
    }

    // Update center of mass
    this.updateCenterOfMass();
  }

  private subdivide(): void {
    const halfWidth = this.width / 2;
    const halfHeight = this.height / 2;

    this.children[0] = new QuadTreeNode(this.x, this.y, halfWidth, halfHeight); // NW
    this.children[1] = new QuadTreeNode(this.x + halfWidth, this.y, halfWidth, halfHeight); // NE
    this.children[2] = new QuadTreeNode(this.x, this.y + halfHeight, halfWidth, halfHeight); // SW
    this.children[3] = new QuadTreeNode(this.x + halfWidth, this.y + halfHeight, halfWidth, halfHeight); // SE
  }

  private insertIntoChildren(node: LayoutNode): void {
    const halfWidth = this.width / 2;
    const halfHeight = this.height / 2;

    if (node.px < this.x + halfWidth) {
      if (node.py < this.y + halfHeight) {
        this.children[0]!.insert(node); // NW
      } else {
        this.children[2]!.insert(node); // SW
      }
    } else {
      if (node.py < this.y + halfHeight) {
        this.children[1]!.insert(node); // NE
      } else {
        this.children[3]!.insert(node); // SE
      }
    }
  }

  private updateCenterOfMass(): void {
    let totalMass = 0;
    let totalX = 0;
    let totalY = 0;

    // Sum masses from children
    for (const child of this.children) {
      if (child) {
        totalMass += child.mass;
        totalX += child.cx * child.mass;
        totalY += child.cy * child.mass;
      }
    }

    this.mass = totalMass;
    if (totalMass > 0) {
      this.cx = totalX / totalMass;
      this.cy = totalY / totalMass;
    }
  }

  calculateForce(node: LayoutNode, theta: number, repulsion: number): { fx: number; fy: number } {
    if (this.mass === 0) return { fx: 0, fy: 0 };

    const dx = node.px - this.cx;
    const dy = node.py - this.cy;
    const distance = Math.hypot(dx, dy) || 1;
    const d2 = distance * distance + 1;

    if (this.node === node && this.children[0] === null) {
      return { fx: 0, fy: 0 };
    }

    // Barnes-Hut criterion: if width/distance < theta, treat as single body
    if (this.width / distance < theta || this.node !== null) {
      // Calculate repulsion force
      const f = (repulsion * this.mass) / d2;
      return {
        fx: f * dx / distance,
        fy: f * dy / distance
      };
    } else {
      // Recurse into children
      let fx = 0;
      let fy = 0;
      for (const child of this.children) {
        if (child) {
          const childForce = child.calculateForce(node, theta, repulsion);
          fx += childForce.fx;
          fy += childForce.fy;
        }
      }
      return { fx, fy };
    }
  }
}

export class LayoutEngine {
  private MIN_NODE_SEPARATION = 72;
  private REPULSION = 1800; // reduced for smoother motion with BH
  private COHESION = 0.005;
  private GRAVITY = 0.0007;
  private NOISE = 0.06; // reduce random jitter
  private DAMPING = 0.9; // higher damping for quicker stabilization
  private SLEEP_THRESHOLD = 0.02;
  private BOUNDARY_PADDING = 50;
  private SPARSE_EDGE_LENGTH = 150;
  private SPARSE_GRAVITY_BOOST = 1.8;
  private BARNES_HUT_THETA = 0.65; // more approximation for stability
  private MAX_VELOCITY = 30;
  private USE_BARNES_HUT = true;
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

    // Build Barnes-Hut quad-tree for O(n log n) repulsion calculations
    const quadBounds = nodes.length > 0 ? this.calculateBounds(nodes) : { x: 0, y: 0, width: 1000, height: 1000 };
    const quadTree = new QuadTreeNode(quadBounds.x, quadBounds.y, quadBounds.width, quadBounds.height);
    nodes.forEach(node => quadTree.insert(node));

    // Calculate repulsion forces using Barnes-Hut approximation
    nodes.forEach(node => {
      if (node.isPinned) return;
      const force = quadTree.calculateForce(node, this.BARNES_HUT_THETA, this.REPULSION);
      node.vx += force.fx;
      node.vy += force.fy;
    });

    // Calculate connection-based forces (springs, cohesion) - still O(E) complexity
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = b.px - a.px;
        const dy = b.py - a.py;
        const distance = Math.hypot(dx, dy) || 1;
        const connectionStrength = connectionStrengths.get(pairKey(a.id, b.id)) ?? 0;

        const ux = dx / distance;
        const uy = dy / distance;
        const overlap = Math.max(0, this.MIN_NODE_SEPARATION - distance);
        if (overlap > 0 && !this.USE_BARNES_HUT) {
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

      // clamp velocity for stability
      const speed = Math.hypot(node.vx, node.vy);
      if (speed > this.MAX_VELOCITY) {
        const factor = this.MAX_VELOCITY / speed;
        node.vx *= factor;
        node.vy *= factor;
      }

      node.px += node.vx;
      node.py += node.vy;
    });

    const kineticEnergy = nodes.reduce((sum, node) => sum + node.vx * node.vx + node.vy * node.vy, 0);
    const averageKineticEnergy = nodes.length > 0 ? kineticEnergy / nodes.length : 0;
    if (averageKineticEnergy < this.SLEEP_THRESHOLD) {
      this.isAsleep = true;
    }
  }

  private calculateBounds(nodes: LayoutNode[]): { x: number; y: number; width: number; height: number } {
    if (nodes.length === 0) {
      return { x: -500, y: -500, width: 1000, height: 1000 };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    nodes.forEach(node => {
      minX = Math.min(minX, node.px);
      minY = Math.min(minY, node.py);
      maxX = Math.max(maxX, node.px);
      maxY = Math.max(maxY, node.py);
    });

    const padding = 100;
    const width = Math.max(maxX - minX + 2 * padding, 1000);
    const height = Math.max(maxY - minY + 2 * padding, 1000);

    return {
      x: minX - padding,
      y: minY - padding,
      width,
      height
    };
  }
}
