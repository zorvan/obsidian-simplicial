"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractRole = extractRole;
const ROLE_TAGS = {
    action: ['action', 'todo', 'task'],
    project: ['project', 'plan', 'initiative', 'status'],
    research: ['research', 'paper', 'study', 'analysis'],
    idea: ['idea', 'concept', 'hypothesis', 'thought'],
    creative: ['story', 'fiction', 'game', 'worldbuilding', 'writing'],
    reference: [],
};
function extractRole(file, cache, content) {
    const tags = (cache?.tags ?? []).map((t) => t.tag?.toLowerCase?.() ?? "");
    const fm = (cache?.frontmatter ?? {});
    if (/- \[ \]/.test(content))
        return 'action';
    if (fm.status || tags.some((t) => ['#project', '#plan', '#initiative'].includes(t))) {
        return 'project';
    }
    if (tags.some((t) => ['#research', '#paper', '#study', '#analysis'].includes(t))) {
        return 'research';
    }
    if (tags.some((t) => ['#story', '#fiction', '#game', '#worldbuilding', '#writing'].includes(t))) {
        return 'creative';
    }
    if (tags.some((t) => ['#idea', '#concept', '#hypothesis', '#thought'].includes(t))) {
        return 'idea';
    }
    return 'reference';
}
