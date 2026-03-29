"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scoreCandidate = scoreCandidate;
const role_diversity_1 = require("./rules/role-diversity");
const domain_cross_1 = require("./rules/domain-cross");
const temporal_decay_1 = require("./rules/temporal-decay");
function scoreCandidate(candidate, profiles, config) {
    const nodes = candidate.nodes.map((id) => profiles.find((p) => p.id === id));
    const d = nodes.length - 1;
    let score = candidate.triadScore ?? 0;
    const uniqueRoles = new Set(nodes.map((n) => n.role)).size;
    score += uniqueRoles * config.roleDiversityWeight;
    const uniqueDomains = new Set(nodes.map((n) => n.domain)).size;
    score += uniqueDomains * config.domainDiversityWeight;
    const hasAction = nodes.some((n) => n.role === 'action');
    if (hasAction)
        score += config.actionBonus;
    const allTags = nodes.flatMap((n) => n.tags);
    const tagCounts = new Map();
    for (const t of allTags)
        tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    const rareOverlap = [...tagCounts.entries()].filter(([tag, count]) => count > 1 && count <= 2).length;
    score += rareOverlap * config.rareTagWeight;
    const commonOverlap = [...tagCounts.entries()].filter(([tag, count]) => count > 2).length;
    score -= commonOverlap * config.commonTagPenalty;
    if (!(0, role_diversity_1.passesDiversityConstraint)(nodes, d)) {
        return { ...candidate, insightScore: 0, class: 'folder-cluster', decayedWeight: 0 };
    }
    const classification = d === 2
        ? (0, domain_cross_1.qualifiesAsCore)(nodes, config.minDomainsForTetra, config.minRolesForTetra)
        : { qualifies: true, isSuper: false, class: 'cross-domain' };
    if (!classification.qualifies) {
        return { ...candidate, insightScore: 0, class: 'folder-cluster', decayedWeight: 0 };
    }
    const decayedWeight = (0, temporal_decay_1.applyTemporalDecay)(candidate.weight ?? 1.0, nodes, {
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
