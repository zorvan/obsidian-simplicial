import type { SimplexSource } from "../../core/types";

export type NoteRole =
  | 'action'
  | 'project'
  | 'research'
  | 'idea'
  | 'creative'
  | 'reference';

export interface NoteProfile {
  id: string;
  role: NoteRole;
  domain: string;
  tags: string[];
  modifiedAt: number;
  linkCount: number;
}

export interface RawEdge {
  a: string;
  b: string;
  strength: number;
}

export interface RawGraph {
  nodes: Map<string, NoteProfile>;
  edges: Map<string, RawEdge>;
}

export interface CandidateSimplex {
  nodes: string[];
  source: SimplexSource;
  bridgeNode?: string;
  triadScore?: number;
  label: string | null;
  weight: number;
}

export interface ScoredCandidate extends CandidateSimplex {
  insightScore: number;
  class: 'folder-cluster' | 'bridge-triangle' | 'cross-domain' | 'cross-domain-core' | 'project-nucleus' | 'super-insight';
  decayedWeight: number;
}

export type SimplexClass = ScoredCandidate['class'];

export interface InferenceConfig {
  inferenceMode: 'emergent' | 'taxonomic' | 'hybrid';
  insightThreshold: number;
  linkStrengthThreshold: number;
  closureThreshold: number;
  tagRarityThreshold: number;
  decayHalfLifeDays: number;
  decayMinimumWeight: number;
  minDomainsForTriangle: number;
  minDomainsForTetra: number;
  minRolesForTetra: number;
  roleDiversityWeight: number;
  domainDiversityWeight: number;
  actionBonus: number;
  rareTagWeight: number;
  commonTagPenalty: number;
}

export interface InferenceContext {
  path: string;
  folder: string;
  topFolder: string;
  titleTokens: Set<string>;
  contentTokens: Set<string>;
  tags: Set<string>;
  outgoingLinks: Set<string>;
  role: NoteRole;
  modifiedAt: number;
}
