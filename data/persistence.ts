import { parseYaml, stringifyYaml, TFile, type App } from "obsidian";
import { logger } from "../core/logger";
import { normalizeKey } from "../core/normalize";
import type { PluginSettings, Simplex } from "../core/types";

function serializeFrontmatter(frontmatter: Record<string, unknown>, body: string): string {
  const yaml = stringifyYaml(frontmatter).trimEnd();
  return `---\n${yaml}\n---\n${body.replace(/^\n*/, "")}`;
}

function simplexToSerializable(simplex: Simplex): Record<string, unknown> {
  return {
    nodes: simplex.nodes,
    ...(simplex.label ? { label: simplex.label } : {}),
    ...(simplex.weight !== undefined ? { weight: simplex.weight } : {}),
  };
}

function parseManagedFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { frontmatter: {}, body: content };
  try {
    return {
      frontmatter: parseYaml(match[1]) ?? {},
      body: content.replace(/^---\n[\s\S]*?\n---\n?/, "")
    };
  } catch {
    return { frontmatter: {}, body: content.replace(/^---\n[\s\S]*?\n---\n?/, "") };
  }
}

function updateSimplexArray(frontmatter: Record<string, unknown>, simplexKey: string, nextEntry?: Record<string, unknown>): Record<string, unknown> {
  const simplices = Array.isArray(frontmatter.simplices) ? [...frontmatter.simplices] : [];
  const filtered = simplices.filter((entry) => {
    const nodes = Array.isArray((entry as Record<string, unknown>).nodes)
      ? ((entry as Record<string, unknown>).nodes as unknown[]).map(String)
      : [];
    return normalizeKey(nodes) !== simplexKey;
  });
  if (nextEntry) filtered.push(nextEntry);
  frontmatter.simplices = filtered;
  return frontmatter;
}

export async function writeSimplexToSourceNote(
  app: App,
  file: TFile,
  simplex: Simplex,
): Promise<string> {
  const content = await app.vault.read(file);
  const { frontmatter, body } = parseManagedFrontmatter(content);
  const key = normalizeKey(simplex.nodes);
  updateSimplexArray(frontmatter, key, simplexToSerializable(simplex));
  const simplexCount = Array.isArray(frontmatter.simplices) ? frontmatter.simplices.length : 0;
  logger.info("persistence", "Prepared source-note write", {
    mode: "source-note",
    file: file.path,
    simplexKey: key,
    simplexCount
  });
  return serializeFrontmatter(frontmatter, body);
}

export async function ensureCentralFile(app: App, centralFile: string): Promise<TFile> {
  const existing = app.vault.getAbstractFileByPath(centralFile);
  if (existing instanceof TFile) return existing;
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
  logger.info("persistence", "Created central file", { path: centralFile });
  return file;
}

export async function writeSimplexToCentralFile(
  app: App,
  centralFile: string,
  simplex: Simplex,
): Promise<{ file: TFile; content: string }> {
  const file = await ensureCentralFile(app, centralFile);
  const content = await app.vault.read(file);
  const { frontmatter, body } = parseManagedFrontmatter(content);
  const key = normalizeKey(simplex.nodes);
  frontmatter.managedBy = "obsidian-simplicial";
  updateSimplexArray(frontmatter, key, simplexToSerializable(simplex));
  const simplexCount = Array.isArray(frontmatter.simplices) ? frontmatter.simplices.length : 0;
  const nextContent = serializeFrontmatter(frontmatter, body || "<!-- managed by Simplicial Complex plugin -->\n");
  logger.info("persistence", "Prepared central-file write", {
    mode: "central-file",
    file: file.path,
    simplexKey: key,
    simplexCount
  });
  return { file, content: nextContent };
}

export async function removeSimplexFromManagedFile(
  app: App,
  file: TFile,
  simplexKey: string,
): Promise<string> {
  const content = await app.vault.read(file);
  const { frontmatter, body } = parseManagedFrontmatter(content);
  updateSimplexArray(frontmatter, simplexKey);
  logger.info("persistence", "Prepared simplex removal", {
    file: file.path,
    simplexKey,
    remainingSimplexCount: Array.isArray(frontmatter.simplices) ? frontmatter.simplices.length : 0
  });
  return serializeFrontmatter(frontmatter, body);
}

export async function readCentralFileState(app: App, centralFile: string): Promise<{
  exists: boolean;
  path: string;
  length: number;
}> {
  const file = app.vault.getAbstractFileByPath(centralFile);
  if (!(file instanceof TFile)) {
    logger.warn("persistence", "Central file does not exist", {
      mode: "central-file",
      path: centralFile
    });
    return { exists: false, path: centralFile, length: 0 };
  }
  const content = await app.vault.read(file);
  logger.info("persistence", "Central file state", {
    mode: "central-file",
    path: centralFile,
    exists: true,
    length: content.length
  });
  return { exists: true, path: file.path, length: content.length };
}

export function getDefaultSettings(): PluginSettings {
  return {
    domainSource: "hybrid",
    contentClusterCount: 8,
    enableBettiComputation: true,
    bettiDisplayOnCanvas: true,
    maxBettiDim: 2,
    showFiltrationSlider: true,
    enableExplanationPanel: true,
    enableInteractionReinforcement: true,
    reinforcementStrength: 0.05,
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
    inferenceMode: "hybrid",
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
    renderFilterMetric: "weight",
    renderFilterThreshold: 0,
    pinnedNodes: {},
  };
}
