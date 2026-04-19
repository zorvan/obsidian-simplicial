import type { NodeID, SimplexKey } from "../core/types";

export interface InteractionEvent {
  timestamp: number;
  type: 'hover' | 'select' | 'confirm' | 'reject' | 'promote' | 'dissolve' | 'create';
  simplexKey?: SimplexKey;
  nodeIds?: NodeID[];
  weight: number;
}

export interface ReinforcementState {
  events: InteractionEvent[];
  nodeScores: Map<string, number>;
  simplexScores: Map<string, number>;
}

const REINFORCEMENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_SCORE = 3.0;

export function createInteractionTracker(): ReinforcementState {
  return {
    events: [],
    nodeScores: new Map(),
    simplexScores: new Map(),
  };
}

export function logInteraction(
  state: ReinforcementState,
  event: Omit<InteractionEvent, 'timestamp'>,
): void {
  const fullEvent: InteractionEvent = {
    ...event,
    timestamp: Date.now(),
  };
  state.events.push(fullEvent);

  // Update scores based on interaction type
  const scoreDelta = getScoreDelta(event.type);
  
  if (event.simplexKey && event.type !== 'hover') {
    const current = state.simplexScores.get(event.simplexKey) ?? 1.0;
    state.simplexScores.set(event.simplexKey, Math.min(MAX_SCORE, current + scoreDelta));
  }

  if (event.nodeIds) {
    for (const nodeId of event.nodeIds) {
      const current = state.nodeScores.get(nodeId) ?? 1.0;
      state.nodeScores.set(nodeId, Math.min(MAX_SCORE, current + scoreDelta * 0.5));
    }
  }

  // Clean up old events
  pruneOldEvents(state);
}

function getScoreDelta(type: InteractionEvent['type']): number {
  switch (type) {
    case 'confirm': return 0.5;
    case 'promote': return 0.8;
    case 'create': return 0.6;
    case 'reject': return -0.3;
    case 'dissolve': return -0.5;
    case 'select': return 0.1;
    case 'hover': return 0.02;
    default: return 0;
  }
}

function pruneOldEvents(state: ReinforcementState): void {
  const cutoff = Date.now() - REINFORCEMENT_WINDOW_MS;
  state.events = state.events.filter(e => e.timestamp > cutoff);
}

export function getReinforcementMultiplier(
  state: ReinforcementState,
  simplexKey?: SimplexKey,
  nodeIds?: NodeID[],
): number {
  let multiplier = 1.0;

  if (simplexKey) {
    const simplexScore = state.simplexScores.get(simplexKey) ?? 1.0;
    multiplier *= simplexScore;
  }

  if (nodeIds && nodeIds.length > 0) {
    const avgNodeScore = nodeIds.reduce((sum, id) => {
      return sum + (state.nodeScores.get(id) ?? 1.0);
    }, 0) / nodeIds.length;
    multiplier *= (1 + (avgNodeScore - 1) * 0.3); // Node influence is dampened
  }

  return Math.min(MAX_SCORE, Math.max(0.3, multiplier));
}

export function serializeReinforcement(state: ReinforcementState): unknown {
  return {
    events: state.events.slice(-100), // Keep last 100 events
    nodeScores: Array.from(state.nodeScores.entries()),
    simplexScores: Array.from(state.simplexScores.entries()),
  };
}

export function deserializeReinforcement(data: unknown): ReinforcementState {
  const state = createInteractionTracker();
  if (typeof data !== 'object' || data === null) return state;

  const d = data as Record<string, unknown>;
  
  if (Array.isArray(d.events)) {
    state.events = d.events.filter((e: unknown) => {
      if (typeof e !== 'object' || e === null) return false;
      const ev = e as Record<string, unknown>;
      return typeof ev.timestamp === 'number' && typeof ev.type === 'string';
    }) as InteractionEvent[];
  }

  if (Array.isArray(d.nodeScores)) {
    for (const [k, v] of d.nodeScores) {
      if (typeof v === 'number') state.nodeScores.set(k, v);
    }
  }

  if (Array.isArray(d.simplexScores)) {
    for (const [k, v] of d.simplexScores) {
      if (typeof v === 'number') state.simplexScores.set(k, v);
    }
  }

  return state;
}
