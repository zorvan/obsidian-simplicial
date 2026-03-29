"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.qualifiesAsCore = qualifiesAsCore;
function qualifiesAsCore(nodes, minDomainsForTetra, minRolesForTetra) {
    const domains = new Set(nodes.map((n) => n.domain));
    const roles = new Set(nodes.map((n) => n.role));
    const hasAction = nodes.some((n) => n.role === 'action');
    if (domains.size < minDomainsForTetra) {
        return { qualifies: false, isSuper: false, class: 'folder-cluster' };
    }
    const isSuper = domains.size >= 3 && roles.size >= 3;
    const cls = hasAction
        ? 'project-nucleus'
        : isSuper
            ? 'super-insight'
            : 'cross-domain-core';
    return { qualifies: true, isSuper, class: cls };
}
