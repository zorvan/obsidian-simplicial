"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeKey } = require("../core/normalize");
const { hashLabel } = require("../core/hash");
const { generateFaces, getFacesLazy } = require("../core/faces");
const { SimplicialModel } = require("../core/model");
const { inferSimplices } = require("../data/inference");
test("normalizeKey lowercases, trims, and canonicalizes order", () => {
    assert.equal(normalizeKey(["Talent", " STARTUP ", "capital"]), normalizeKey(["startup", "talent", "capital"]));
});
test("hashLabel is deterministic for the same label", () => {
    assert.equal(hashLabel("founding engine"), hashLabel("founding engine"));
});
test("generateFaces expands proper faces for triangles", () => {
    const complex = { simplices: new Map() };
    const simplex = { nodes: ["startup.md", "capital.md", "talent.md"], label: "founding engine" };
    complex.simplices.set(normalizeKey(simplex.nodes), simplex);
    generateFaces(complex, simplex);
    assert.equal(complex.simplices.has(normalizeKey(["startup.md", "capital.md"])), true);
    assert.equal(complex.simplices.has(normalizeKey(["startup.md", "talent.md"])), true);
    assert.equal(complex.simplices.has(normalizeKey(["capital.md", "talent.md"])), true);
});
test("generateFaces does not eagerly expand dim-4 simplices", () => {
    const complex = { simplices: new Map() };
    const simplex = { nodes: ["a.md", "b.md", "c.md", "d.md", "e.md"] };
    complex.simplices.set(normalizeKey(simplex.nodes), simplex);
    generateFaces(complex, simplex);
    assert.equal(complex.simplices.size, 1);
    assert.equal(getFacesLazy(simplex, 2).length, 10);
});
test("generateFaces caps expansion for higher-order simplices", () => {
    const complex = { simplices: new Map() };
    const simplex = { nodes: ["a.md", "b.md", "c.md", "d.md", "e.md", "f.md"] };
    complex.simplices.set(normalizeKey(simplex.nodes), simplex);
    generateFaces(complex, simplex);
    assert.equal(complex.simplices.size, 1);
});
test("model rename tracking preserves pinning and rewrites simplex membership", () => {
    const model = new SimplicialModel();
    model.setNode("old.md", { isPinned: true, px: 120, py: 140 });
    model.setNode("other.md");
    model.addSimplex({ nodes: ["old.md", "other.md"], userDefined: true });
    model.updateNodeId("old.md", "new.md");
    const renamed = model.nodes.get("new.md");
    assert.ok(renamed);
    assert.equal(renamed.isPinned, true);
    assert.equal(renamed.px, 120);
    assert.equal(model.simplices.has(normalizeKey(["new.md", "other.md"])), true);
    assert.equal(model.simplices.has(normalizeKey(["old.md", "other.md"])), false);
});
test("inferSimplices weights links, tags, titles, content, and folders", () => {
    const simplices = inferSimplices([
        {
            path: "Ideas/alpha.md",
            folder: "Ideas",
            topFolder: "Ideas",
            titleTokens: new Set(["alpha", "systems"]),
            contentTokens: new Set(["topology", "network", "meaning"]),
            tags: new Set(["graph", "knowledge"]),
            outgoingLinks: new Set(["Ideas/beta.md"]),
        },
        {
            path: "Ideas/beta.md",
            folder: "Ideas",
            topFolder: "Ideas",
            titleTokens: new Set(["beta", "systems"]),
            contentTokens: new Set(["topology", "network", "clusters"]),
            tags: new Set(["graph"]),
            outgoingLinks: new Set(),
        },
    ], {
        linkGraphBaseline: true,
        enableInferredEdges: true,
        inferenceThreshold: 0.12,
        linkWeight: 0.25,
        mutualLinkBonus: 0.25,
        sharedTagWeight: 0.08,
        titleOverlapWeight: 0.18,
        contentOverlapWeight: 0.16,
        sameFolderWeight: 0.08,
        sameTopFolderWeight: 0.04,
        suggestionThreshold: 0.34,
    });
    assert.equal(simplices.length, 1);
    assert.deepEqual(simplices[0].nodes.sort(), ["Ideas/alpha.md", "Ideas/beta.md"]);
    assert.equal(simplices[0].inferred, true);
    assert.equal(simplices[0].userDefined, false);
    assert.ok((simplices[0].weight ?? 0) > 0.3);
    assert.ok(simplices[0].inferredSignals.some((signal) => signal.startsWith("link:")));
    assert.ok(simplices[0].inferredSignals.some((signal) => signal.startsWith("tags:")));
    assert.ok(simplices[0].inferredSignals.some((signal) => signal.startsWith("title:")));
    assert.ok(simplices[0].inferredSignals.some((signal) => signal.startsWith("content:")));
    assert.ok(simplices[0].inferredSignals.includes("folder:same"));
});
test("inferSimplices still creates raw link edges when semantic inference is disabled", () => {
    const simplices = inferSimplices([
        {
            path: "A.md",
            folder: "",
            topFolder: "",
            titleTokens: new Set(["alpha"]),
            contentTokens: new Set(["one"]),
            tags: new Set(),
            outgoingLinks: new Set(["B.md"]),
        },
        {
            path: "B.md",
            folder: "",
            topFolder: "",
            titleTokens: new Set(["beta"]),
            contentTokens: new Set(["two"]),
            tags: new Set(),
            outgoingLinks: new Set(),
        },
    ], {
        linkGraphBaseline: true,
        enableInferredEdges: false,
        inferenceThreshold: 0.9,
        linkWeight: 0.25,
        mutualLinkBonus: 0.25,
        sharedTagWeight: 0.08,
        titleOverlapWeight: 0.18,
        contentOverlapWeight: 0.16,
        sameFolderWeight: 0.08,
        sameTopFolderWeight: 0.04,
        suggestionThreshold: 0.34,
    });
    assert.equal(simplices.length, 1);
    assert.equal(simplices[0].label, "vault link");
    assert.ok((simplices[0].weight ?? 0) >= 0.25);
});
test("inferSimplices supports non-Latin token overlap such as RTL text", () => {
    const simplices = inferSimplices([
        {
            path: "arabic-a.md",
            folder: "دفتر",
            topFolder: "دفتر",
            titleTokens: new Set(["شبكة", "معرفة"]),
            contentTokens: new Set(["مفاهيم", "ترابط", "معرفة"]),
            tags: new Set(["عربي"]),
            outgoingLinks: new Set(),
        },
        {
            path: "arabic-b.md",
            folder: "دفتر",
            topFolder: "دفتر",
            titleTokens: new Set(["شبكة", "دلالات"]),
            contentTokens: new Set(["مفاهيم", "ترابط", "بنية"]),
            tags: new Set(["عربي"]),
            outgoingLinks: new Set(),
        },
    ], {
        linkGraphBaseline: true,
        enableInferredEdges: true,
        inferenceThreshold: 0.12,
        linkWeight: 0.25,
        mutualLinkBonus: 0.25,
        sharedTagWeight: 0.08,
        titleOverlapWeight: 0.18,
        contentOverlapWeight: 0.16,
        sameFolderWeight: 0.08,
        sameTopFolderWeight: 0.04,
        suggestionThreshold: 0.34,
    });
    assert.equal(simplices.length, 1);
    assert.ok((simplices[0].weight ?? 0) > 0.12);
});
test("inferSimplices can emit a soft cluster from three mutually strong relations", () => {
    const simplices = inferSimplices([
        {
            path: "a.md",
            folder: "Ideas",
            topFolder: "Ideas",
            titleTokens: new Set(["systems", "alpha"]),
            contentTokens: new Set(["network", "emergence"]),
            tags: new Set(["cluster"]),
            outgoingLinks: new Set(["b.md", "c.md"]),
        },
        {
            path: "b.md",
            folder: "Ideas",
            topFolder: "Ideas",
            titleTokens: new Set(["systems", "beta"]),
            contentTokens: new Set(["network", "emergence"]),
            tags: new Set(["cluster"]),
            outgoingLinks: new Set(["a.md", "c.md"]),
        },
        {
            path: "c.md",
            folder: "Ideas",
            topFolder: "Ideas",
            titleTokens: new Set(["systems", "gamma"]),
            contentTokens: new Set(["network", "emergence"]),
            tags: new Set(["cluster"]),
            outgoingLinks: new Set(["a.md", "b.md"]),
        },
    ], {
        linkGraphBaseline: true,
        enableInferredEdges: true,
        inferenceThreshold: 0.12,
        linkWeight: 0.25,
        mutualLinkBonus: 0.25,
        sharedTagWeight: 0.08,
        titleOverlapWeight: 0.18,
        contentOverlapWeight: 0.16,
        sameFolderWeight: 0.08,
        sameTopFolderWeight: 0.04,
        suggestionThreshold: 0.34,
    });
    const softCluster = simplices.find((simplex) => simplex.nodes.length === 3 && simplex.inferredSignals?.includes("soft-cluster"));
    assert.ok(softCluster);
});
test("inferSimplices emergent open triad detection yields a 3-simplex", () => {
    const now = Date.now();
    const simplices = inferSimplices([
        {
            path: "a.md",
            folder: "A",
            topFolder: "A",
            titleTokens: new Set(["alpha"]),
            contentTokens: new Set(["shift"]),
            tags: new Set(["research"]),
            outgoingLinks: new Set(["b.md"]),
            role: "research",
            modifiedAt: now,
        },
        {
            path: "b.md",
            folder: "B",
            topFolder: "B",
            titleTokens: new Set(["beta"]),
            contentTokens: new Set(["bridge"]),
            tags: new Set(["project"]),
            outgoingLinks: new Set(["a.md", "c.md"]),
            role: "project",
            modifiedAt: now,
        },
        {
            path: "c.md",
            folder: "C",
            topFolder: "C",
            titleTokens: new Set(["gamma"]),
            contentTokens: new Set(["creative"]),
            tags: new Set(["creative"]),
            outgoingLinks: new Set(["b.md"]),
            role: "creative",
            modifiedAt: now,
        },
    ], {
        inferenceMode: "emergent",
        insightThreshold: 0.45,
        linkStrengthThreshold: 0.4,
        closureThreshold: 0.25,
        tagRarityThreshold: 0.05,
        decayHalfLifeDays: 90,
        decayMinimumWeight: 0.1,
        minDomainsForTriangle: 2,
        minDomainsForTetra: 2,
        minRolesForTetra: 2,
        roleDiversityWeight: 0.2,
        domainDiversityWeight: 0.25,
        actionBonus: 0.3,
        rareTagWeight: 0.15,
        commonTagPenalty: 0.12,
        linkGraphBaseline: false,
        enableInferredEdges: true,
        inferenceThreshold: 0.12,
        enableLinkInference: true,
        enableMutualLinkBonus: true,
        enableSharedTags: true,
        enableTitleOverlap: true,
        enableContentOverlap: true,
        enableSameFolderInference: false,
        enableSameTopFolderInference: false,
        linkWeight: 0.25,
        mutualLinkBonus: 0.25,
        sharedTagWeight: 0.08,
        titleOverlapWeight: 0.18,
        contentOverlapWeight: 0.16,
        sameFolderWeight: 0.08,
        sameTopFolderWeight: 0.04,
        suggestionThreshold: 0.34,
    });
    const triad = simplices.find((simplex) => simplex.nodes.length === 3 && simplex.source === 'inferred-bridge');
    assert.ok(triad);
});
test("inferSimplices marks strong inferred relations as suggested with confidence", () => {
    const simplices = inferSimplices([
        {
            path: "x.md",
            folder: "A",
            topFolder: "A",
            titleTokens: new Set(["shared", "topic"]),
            contentTokens: new Set(["shared", "content", "signal"]),
            tags: new Set(["tagged"]),
            outgoingLinks: new Set(["y.md"]),
        },
        {
            path: "y.md",
            folder: "A",
            topFolder: "A",
            titleTokens: new Set(["shared", "topic"]),
            contentTokens: new Set(["shared", "content", "signal"]),
            tags: new Set(["tagged"]),
            outgoingLinks: new Set(["x.md"]),
        },
    ], {
        linkGraphBaseline: true,
        enableInferredEdges: true,
        inferenceThreshold: 0.12,
        linkWeight: 0.25,
        mutualLinkBonus: 0.25,
        sharedTagWeight: 0.08,
        titleOverlapWeight: 0.18,
        contentOverlapWeight: 0.16,
        sameFolderWeight: 0.08,
        sameTopFolderWeight: 0.04,
        suggestionThreshold: 0.34,
    });
    assert.equal(simplices.length, 1);
    assert.equal(simplices[0].suggested, true);
    assert.ok((simplices[0].confidence ?? 0) >= 0.34);
});
test("model analysis summary reports graph-level metrics", () => {
    const model = new SimplicialModel();
    model.addSimplex({ nodes: ["a.md", "b.md"], userDefined: true });
    model.addSimplex({ nodes: ["b.md", "c.md"], userDefined: true });
    model.addSimplex({ nodes: ["a.md", "b.md", "c.md"], userDefined: true });
    const summary = model.getAnalysisSummary();
    assert.equal(summary.nodeCount, 3);
    assert.equal(summary.edgeCount >= 2, true);
    assert.equal(summary.clusterCount >= 1, true);
    assert.equal(summary.connectedComponents, 1);
    assert.ok(["a.md", "b.md", "c.md"].includes(summary.maxDegreeNodeId));
    assert.ok(summary.maxDegree >= 2);
});
