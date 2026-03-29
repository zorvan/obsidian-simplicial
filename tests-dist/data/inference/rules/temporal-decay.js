"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_DECAY = void 0;
exports.applyTemporalDecay = applyTemporalDecay;
exports.DEFAULT_DECAY = {
    halfLifeDays: 90,
    minimumWeight: 0.1,
    roleModifier: {
        action: 0.3,
        project: 0.5,
        research: 0.7,
        idea: 1.0,
        creative: 1.2,
        reference: 1.5,
    },
};
function applyTemporalDecay(baseWeight, nodes, config = exports.DEFAULT_DECAY) {
    const now = Date.now();
    const mostRecent = Math.max(...nodes.map((n) => n.modifiedAt));
    const ageDays = (now - mostRecent) / (1000 * 60 * 60 * 24);
    const avgModifier = nodes.reduce((sum, n) => sum + config.roleModifier[n.role], 0) / nodes.length;
    const decayFactor = Math.pow(0.5, (ageDays * avgModifier) / config.halfLifeDays);
    const decayed = baseWeight * decayFactor;
    return Math.max(config.minimumWeight, decayed);
}
