import type { CandidateSimplex, ScoredCandidate, InferenceConfig } from "./types";
import type { RawGraph, NoteProfile } from "./types";
import { passesDiversityConstraint } from "./rules/role-diversity";
import { qualifiesAsCore } from "./rules/domain-cross";
import { applyTemporalDecay } from "./rules/temporal-decay";

export function scoreCandidate(
  candidate: CandidateSimplex,
  profiles: NoteProfile[],
  config: InferenceConfig,
): ScoredCandidate {
  const nodes = candidate.nodes.map((id) => profiles.find((p) => p.id === id)!);
  const d = nodes.length - 1;
  let score = candidate.triadScore ?? 0;

  const uniqueRoles = new Set(nodes.map((n) => n.role)).size;
  score += uniqueRoles * config.roleDiversityWeight;

  const uniqueDomains = new Set(nodes.map((n) => n.domain)).size;
  score += uniqueDomains * config.domainDiversityWeight;

  const hasAction = nodes.some((n) => n.role === 'action');
  if (hasAction) score += config.actionBonus;

  const allTags = nodes.flatMap((n) => n.tags);
  const tagCounts = new Map<string, number>();
  for (const t of allTags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  const rareOverlap = [...tagCounts.entries()].filter(([tag, count]) => count > 1 && count <= 2).length;
  score += rareOverlap * config.rareTagWeight;
  const commonOverlap = [...tagCounts.entries()].filter(([tag, count]) => count > 2).length;
  score -= commonOverlap * config.commonTagPenalty;

  if (!passesDiversityConstraint(nodes, d)) {
    return { ...candidate, insightScore: 0, class: 'folder-cluster', decayedWeight: 0 };
  }

  const classification = d === 2
    ? qualifiesAsCore(nodes, config.minDomainsForTetra, config.minRolesForTetra)
    : { qualifies: true, isSuper: false, class: 'cross-domain' as const };

  if (!classification.qualifies) {
    return { ...candidate, insightScore: 0, class: 'folder-cluster', decayedWeight: 0 };
  }

  const decayedWeight = applyTemporalDecay(candidate.weight ?? 1.0, nodes, {
    halfLifeDays: config.decayHalfLifeDays,
    minimumWeight: config.decayMinimumWeight,
    roleModifier: {
      action: 0.3,
      project: 0.5,
      research: 0.7,
      idea: 1.0,
      creative: 1.2,
      reference: 1.5,
    },
  });

  return {
    ...candidate,
    insightScore: score,
    class: classification.class,
    decayedWeight,
  };
}
