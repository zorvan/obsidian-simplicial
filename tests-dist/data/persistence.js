"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeSimplexToSourceNote = writeSimplexToSourceNote;
exports.ensureCentralFile = ensureCentralFile;
exports.writeSimplexToCentralFile = writeSimplexToCentralFile;
exports.removeSimplexFromManagedFile = removeSimplexFromManagedFile;
exports.readCentralFileState = readCentralFileState;
exports.getDefaultSettings = getDefaultSettings;
const obsidian_1 = require("obsidian");
const logger_1 = require("../core/logger");
const normalize_1 = require("../core/normalize");
function serializeFrontmatter(frontmatter, body) {
    const yaml = (0, obsidian_1.stringifyYaml)(frontmatter).trimEnd();
    return `---\n${yaml}\n---\n${body.replace(/^\n*/, "")}`;
}
function simplexToSerializable(simplex) {
    return {
        nodes: simplex.nodes,
        ...(simplex.label ? { label: simplex.label } : {}),
        ...(simplex.weight !== undefined ? { weight: simplex.weight } : {}),
    };
}
function parseManagedFrontmatter(content) {
    const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
    if (!match)
        return { frontmatter: {}, body: content };
    try {
        return {
            frontmatter: (0, obsidian_1.parseYaml)(match[1]) ?? {},
            body: content.replace(/^---\n[\s\S]*?\n---\n?/, "")
        };
    }
    catch {
        return { frontmatter: {}, body: content.replace(/^---\n[\s\S]*?\n---\n?/, "") };
    }
}
function updateSimplexArray(frontmatter, simplexKey, nextEntry) {
    const simplices = Array.isArray(frontmatter.simplices) ? [...frontmatter.simplices] : [];
    const filtered = simplices.filter((entry) => {
        const nodes = Array.isArray(entry.nodes)
            ? entry.nodes.map(String)
            : [];
        return (0, normalize_1.normalizeKey)(nodes) !== simplexKey;
    });
    if (nextEntry)
        filtered.push(nextEntry);
    frontmatter.simplices = filtered;
    return frontmatter;
}
async function writeSimplexToSourceNote(app, file, simplex) {
    const content = await app.vault.read(file);
    const { frontmatter, body } = parseManagedFrontmatter(content);
    const key = (0, normalize_1.normalizeKey)(simplex.nodes);
    updateSimplexArray(frontmatter, key, simplexToSerializable(simplex));
    const simplexCount = Array.isArray(frontmatter.simplices) ? frontmatter.simplices.length : 0;
    logger_1.logger.info("persistence", "Prepared source-note write", {
        mode: "source-note",
        file: file.path,
        simplexKey: key,
        simplexCount
    });
    return serializeFrontmatter(frontmatter, body);
}
async function ensureCentralFile(app, centralFile) {
    const existing = app.vault.getAbstractFileByPath(centralFile);
    if (existing instanceof obsidian_1.TFile)
        return existing;
    const initial = [
        "---",
        "managedBy: obsidian-simplicial",
        "simplices: []",
        "---",
        "",
        "<!-- managed by Simplicial Complex plugin -->",
        ""
    ].join("\n");
    const file = await app.vault.create(centralFile, initial);
    logger_1.logger.info("persistence", "Created central file", { path: centralFile });
    return file;
}
async function writeSimplexToCentralFile(app, centralFile, simplex) {
    const file = await ensureCentralFile(app, centralFile);
    const content = await app.vault.read(file);
    const { frontmatter, body } = parseManagedFrontmatter(content);
    const key = (0, normalize_1.normalizeKey)(simplex.nodes);
    frontmatter.managedBy = "obsidian-simplicial";
    updateSimplexArray(frontmatter, key, simplexToSerializable(simplex));
    const simplexCount = Array.isArray(frontmatter.simplices) ? frontmatter.simplices.length : 0;
    const nextContent = serializeFrontmatter(frontmatter, body || "<!-- managed by Simplicial Complex plugin -->\n");
    logger_1.logger.info("persistence", "Prepared central-file write", {
        mode: "central-file",
        file: file.path,
        simplexKey: key,
        simplexCount
    });
    return { file, content: nextContent };
}
async function removeSimplexFromManagedFile(app, file, simplexKey) {
    const content = await app.vault.read(file);
    const { frontmatter, body } = parseManagedFrontmatter(content);
    updateSimplexArray(frontmatter, simplexKey);
    logger_1.logger.info("persistence", "Prepared simplex removal", {
        file: file.path,
        simplexKey,
        remainingSimplexCount: Array.isArray(frontmatter.simplices) ? frontmatter.simplices.length : 0
    });
    return serializeFrontmatter(frontmatter, body);
}
async function readCentralFileState(app, centralFile) {
    const file = app.vault.getAbstractFileByPath(centralFile);
    if (!(file instanceof obsidian_1.TFile)) {
        logger_1.logger.warn("persistence", "Central file does not exist", {
            mode: "central-file",
            path: centralFile
        });
        return { exists: false, path: centralFile, length: 0 };
    }
    const content = await app.vault.read(file);
    logger_1.logger.info("persistence", "Central file state", {
        mode: "central-file",
        path: centralFile,
        exists: true,
        length: content.length
    });
    return { exists: true, path: file.path, length: content.length };
}
function getDefaultSettings() {
    return {
        persistenceMode: "source-note",
        centralFile: "_simplicial.md",
        showEdges: true,
        showClusters: true,
        showCores: true,
        maxRenderedDim: 12,
        noiseAmount: 0.12,
        sleepThreshold: 0.01,
        repulsionStrength: 2400,
        cohesionStrength: 0.005,
        gravityStrength: 0.0007,
        dampingFactor: 0.84,
        boundaryPadding: 50,
        darkMode: "auto",
        linkGraphBaseline: true,
        enableInferredEdges: true,
        inferenceThreshold: 0.12,
        enableLinkInference: true,
        enableMutualLinkBonus: true,
        enableSharedTags: true,
        enableTitleOverlap: true,
        enableContentOverlap: true,
        enableSameFolderInference: true,
        enableSameTopFolderInference: true,
        linkWeight: 0.25,
        mutualLinkBonus: 0.25,
        sharedTagWeight: 0.08,
        titleOverlapWeight: 0.18,
        contentOverlapWeight: 0.16,
        sameFolderWeight: 0.08,
        sameTopFolderWeight: 0.04,
        showSuggestions: true,
        suggestionThreshold: 0.34,
        commandSimplexSize: 3,
        commandAutoOpenPanel: true,
        metadataHoverDelayMs: 1000,
        formalMode: false,
        sparseEdgeLength: 150,
        sparseGravityBoost: 1.8,
        labelDensity: 0.42,
        pinnedNodes: {},
    };
}
