"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.passesDiversityConstraint = passesDiversityConstraint;
function passesDiversityConstraint(nodes, dim) {
    const roles = new Set(nodes.map((n) => n.role));
    const domains = new Set(nodes.map((n) => n.domain));
    if (dim === 1) {
        return roles.size >= 2 || domains.size >= 2;
    }
    if (dim === 2) {
        return domains.size >= 2 && roles.size >= 2;
    }
    return true;
}
