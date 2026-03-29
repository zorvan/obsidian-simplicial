"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeNodeToken = normalizeNodeToken;
exports.normalizeKey = normalizeKey;
exports.normalizeNodes = normalizeNodes;
exports.uniqueNodes = uniqueNodes;
exports.resolveNodeId = resolveNodeId;
function normalizeNodeToken(nodeId) {
    return nodeId.toLowerCase().trim();
}
function normalizeKey(nodes) {
    return [...nodes].map(normalizeNodeToken).sort().join("|");
}
function normalizeNodes(nodes) {
    return [...nodes].sort((a, b) => normalizeNodeToken(a).localeCompare(normalizeNodeToken(b)));
}
function uniqueNodes(nodes) {
    const seen = new Set();
    const out = [];
    for (const node of normalizeNodes(nodes)) {
        const token = normalizeNodeToken(node);
        if (seen.has(token))
            continue;
        seen.add(token);
        out.push(node);
    }
    return out;
}
function resolveNodeId(rawId, sourcePath, app) {
    const trimmed = rawId.trim();
    if (!trimmed)
        return null;
    const direct = app.metadataCache.getFirstLinkpathDest(trimmed, sourcePath);
    if (direct)
        return direct;
    const files = app.vault.getMarkdownFiles();
    for (const file of files) {
        const cache = app.metadataCache.getFileCache(file);
        const aliases = cache?.frontmatter?.aliases;
        const aliasList = Array.isArray(aliases) ? aliases : typeof aliases === "string" ? [aliases] : [];
        if (aliasList.some((alias) => normalizeNodeToken(String(alias)) === normalizeNodeToken(trimmed))) {
            return file;
        }
    }
    return null;
}
