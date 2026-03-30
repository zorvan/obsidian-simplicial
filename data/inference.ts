import type { App, CachedMetadata, TFile } from "obsidian";
import type { PluginSettings, Simplex } from "../core/types";
import { logger } from "../core/logger";
import { inferSimplicesEmergentWithMode } from "./inference/engine";
import { extractRole } from "./inference/roles";
import type { InferenceContext } from "./inference/types";
export type { InferenceContext } from "./inference/types";

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "for", "with", "from", "into", "onto", "in", "on", "at", "to", "of",
  "is", "are", "was", "were", "be", "been", "being", "this", "that", "these", "those", "it", "its", "as", "by",
  "about", "after", "before", "between", "through", "during", "over", "under", "again", "further", "then", "once",
  "note", "notes", "todo", "idea"
]);


function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLocaleLowerCase()
      .split(/[^\p{L}\p{N}_]+/gu)
      .filter((token) => token.length >= 3 && !STOPWORDS.has(token)),
  );
}

function normalizeTag(tag: string): string {
  return tag.replace(/^#/, "").trim().toLowerCase();
}

function sharedCount(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const item of a) {
    if (b.has(item)) count++;
  }
  return count;
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

function dominantSignal(signals: string[]): string | undefined {
  if (signals.includes("soft-cluster")) return "soft-cluster";
  if (signals.some((signal) => signal.startsWith("tags:"))) return "tags";
  if (signals.some((signal) => signal === "folder:same" || signal === "folder:top")) return "folder";
  if (signals.some((signal) => signal.startsWith("title:") || signal.startsWith("content:"))) return "semantic";
  if (signals.some((signal) => signal.startsWith("link:"))) return "link";
  return undefined;
}

// Optimized inference using inverted indexing for O(n) preprocessing + O(candidates) similarity
function buildInvertedIndex(contexts: InferenceContext[]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();

  contexts.forEach(context => {
    // Index title tokens
    context.titleTokens.forEach(token => {
      if (!index.has(token)) index.set(token, new Set());
      index.get(token)!.add(context.path);
    });

    // Index content tokens (but only rare ones to avoid noise)
    context.contentTokens.forEach(token => {
      // Only index tokens that appear in few documents to focus on distinctive terms
      const docCount = index.get(token)?.size ?? 0;
      if (docCount < Math.max(3, contexts.length * 0.1)) { // Max 10% of documents or 3 docs
        if (!index.has(token)) index.set(token, new Set());
        index.get(token)!.add(context.path);
      }
    });

    // Index tags
    context.tags.forEach(tag => {
      const tagKey = `tag:${tag}`;
      if (!index.has(tagKey)) index.set(tagKey, new Set());
      index.get(tagKey)!.add(context.path);
    });
  });

  return index;
}

function findCandidatePairs(context: InferenceContext, index: Map<string, Set<string>>, allPaths: Set<string>): string[] {
  const candidates = new Set<string>();

  // Find candidates via shared tokens
  context.titleTokens.forEach(token => {
    index.get(token)?.forEach(path => {
      if (path !== context.path) candidates.add(path);
    });
  });

  context.contentTokens.forEach(token => {
    index.get(token)?.forEach(path => {
      if (path !== context.path) candidates.add(path);
    });
  });

  context.tags.forEach(tag => {
    const tagKey = `tag:${tag}`;
    index.get(tagKey)?.forEach(path => {
      if (path !== context.path) candidates.add(path);
    });
  });

  // Add candidates from same folder (limited to avoid explosion)
  const folderKey = `folder:${context.folder}`;
  if (index.has(folderKey)) {
    index.get(folderKey)!.forEach(path => {
      if (path !== context.path) candidates.add(path);
    });
  }

  // Limit candidates to prevent excessive computation (max 50 per document)
  const candidateArray = Array.from(candidates);
  if (candidateArray.length > 50) {
    // Prioritize by some heuristic - for now just take first 50
    candidateArray.splice(50);
  }

  return candidateArray;
}

function overlapScore(a: Set<string>, b: Set<string>, maxContribution: number): number {
  if (!a.size || !b.size) return 0;
  const shared = sharedCount(a, b);
  if (!shared) return 0;
  return Math.min(maxContribution, (shared / Math.max(a.size, b.size)) * maxContribution * 2);
}

function extractTags(cache: CachedMetadata | null): Set<string> {
  const tags = new Set<string>();
  cache?.tags?.forEach((tag) => tags.add(normalizeTag(tag.tag)));
  const frontmatterTags = cache?.frontmatter?.tags;
  const values = Array.isArray(frontmatterTags) ? frontmatterTags : typeof frontmatterTags === "string" ? [frontmatterTags] : [];
  values.forEach((tag) => tags.add(normalizeTag(String(tag))));
  return tags;
}

function resolveLinks(file: TFile, cache: CachedMetadata | null, app: App): Set<string> {
  const links = new Set<string>();
  cache?.links?.forEach((link) => {
    const resolved = app.metadataCache.getFirstLinkpathDest(link.link, file.path);
    if (resolved) links.add(resolved.path);
  });
  return links;
}

export function buildInferenceContext(app: App, file: TFile, content: string): InferenceContext {
  const cache = app.metadataCache.getFileCache(file);
  const folder = file.parent?.path ?? "";
  const topFolder = folder.split("/")[0] ?? "";
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, "");
  return {
    path: file.path,
    folder,
    topFolder,
    titleTokens: tokenize(file.basename),
    contentTokens: tokenize(body),
    tags: extractTags(cache),
    outgoingLinks: resolveLinks(file, cache, app),
    role: extractRole(file, cache, content),
    modifiedAt: file.stat?.mtime ?? Date.now(),
  };
}

export function inferSimplicesLegacy(contexts: InferenceContext[], settings: Pick<
  PluginSettings,
  | "linkGraphBaseline"
  | "enableInferredEdges"
  | "inferenceThreshold"
  | "enableLinkInference"
  | "enableMutualLinkBonus"
  | "enableSharedTags"
  | "enableTitleOverlap"
  | "enableContentOverlap"
  | "enableSameFolderInference"
  | "enableSameTopFolderInference"
  | "linkWeight"
  | "mutualLinkBonus"
  | "sharedTagWeight"
  | "titleOverlapWeight"
  | "contentOverlapWeight"
  | "sameFolderWeight"
  | "sameTopFolderWeight"
  | "suggestionThreshold"
>): Simplex[] {
  if (!settings.enableInferredEdges && !settings.linkGraphBaseline) {
    logger.info("inference", "Inferred simplices disabled by settings");
    return [];
  }

  const simplices: Simplex[] = [];
  const pairScores = new Map<string, { nodes: [string, string]; weight: number; signals: string[] }>();
  const contextMap = new Map(contexts.map(ctx => [ctx.path, ctx]));

  // Build inverted index for efficient candidate finding
  const invertedIndex = buildInvertedIndex(contexts);
  const allPaths = new Set(contexts.map(ctx => ctx.path));

  // Add folder indexing for same-folder inference
  contexts.forEach(ctx => {
    const folderKey = `folder:${ctx.folder}`;
    if (!invertedIndex.has(folderKey)) invertedIndex.set(folderKey, new Set());
    invertedIndex.get(folderKey)!.add(ctx.path);
  });

  // Process each document and its candidates (O(n * k) where k << n)
  contexts.forEach(context => {
    const candidates = findCandidatePairs(context, invertedIndex, allPaths);

    candidates.forEach(candidatePath => {
      const otherContext = contextMap.get(candidatePath);
      if (!otherContext) return;

      // Ensure we only process each pair once
      if (context.path > candidatePath) return;

      const a = context;
      const b = otherContext;
      let score = 0;
      const signals: string[] = [];
      let hasLinkRelation = false;

      if (settings.enableLinkInference !== false && a.outgoingLinks.has(b.path)) {
        hasLinkRelation = true;
        score += settings.linkWeight;
        signals.push("link:a->b");
      }
      if (settings.enableMutualLinkBonus !== false && b.outgoingLinks.has(a.path)) {
        hasLinkRelation = true;
        score += settings.mutualLinkBonus;
        signals.push("link:b->a");
      }

      if (!settings.linkGraphBaseline && hasLinkRelation) {
        score = 0;
        hasLinkRelation = false;
        signals.length = 0;
      }

      if (!settings.enableInferredEdges && !hasLinkRelation) return;

      const sharedTags = sharedCount(a.tags, b.tags);
      if (settings.enableInferredEdges && settings.enableSharedTags !== false && sharedTags > 0) {
        const contribution = Math.min(settings.sharedTagWeight * 3, sharedTags * settings.sharedTagWeight);
        score += contribution;
        signals.push(`tags:${sharedTags}`);
      }

      const titleContribution = settings.enableInferredEdges && settings.enableTitleOverlap !== false
        ? overlapScore(a.titleTokens, b.titleTokens, settings.titleOverlapWeight)
        : 0;
      if (titleContribution > 0) {
        score += titleContribution;
        signals.push(`title:${titleContribution.toFixed(2)}`);
      }

      const contentContribution = settings.enableInferredEdges && settings.enableContentOverlap !== false
        ? overlapScore(a.contentTokens, b.contentTokens, settings.contentOverlapWeight)
        : 0;
      if (contentContribution > 0) {
        score += contentContribution;
        signals.push(`content:${contentContribution.toFixed(2)}`);
      }

      if (settings.enableInferredEdges && settings.enableSameFolderInference !== false && a.folder && a.folder === b.folder) {
        score += settings.sameFolderWeight;
        signals.push("folder:same");
      } else if (settings.enableInferredEdges && settings.enableSameTopFolderInference !== false && a.topFolder && a.topFolder === b.topFolder) {
        score += settings.sameTopFolderWeight;
        signals.push("folder:top");
      }

      if (!hasLinkRelation && score < settings.inferenceThreshold) return;
      const weight = Math.max(0.1, Math.min(1, Number(score.toFixed(2))));
      simplices.push({
        nodes: [a.path, b.path],
        weight,
        label: hasLinkRelation && !settings.enableInferredEdges ? "vault link" : "inferred relation",
        inferred: true,
        userDefined: false,
        autoGenerated: false,
        colorKey: "neutral",
        inferredSignals: signals,
        dominantSignal: dominantSignal(signals),
        confidence: weight,
        suggested: weight >= settings.suggestionThreshold,
      });
      pairScores.set(pairKey(a.path, b.path), {
        nodes: [a.path, b.path],
        weight,
        signals: [...signals],
      });
    });
  });

  // Optimized triad detection - only check triads among documents that have strong pairwise connections
  if (settings.enableInferredEdges) {
    const strongPairs = new Map<string, { partner: string; weight: number; signals: string[] }[]>();
    pairScores.forEach((pair, key) => {
      const [a, b] = pair.nodes;
      if (pair.weight >= Math.max(settings.inferenceThreshold, 0.18)) {
        if (!strongPairs.has(a)) strongPairs.set(a, []);
        if (!strongPairs.has(b)) strongPairs.set(b, []);
        strongPairs.get(a)!.push({ partner: b, weight: pair.weight, signals: pair.signals });
        strongPairs.get(b)!.push({ partner: a, weight: pair.weight, signals: pair.signals });
      }
    });

    // Only check triads among documents with multiple strong connections
    const triadCandidates = Array.from(strongPairs.entries())
      .filter(([_, partners]) => partners.length >= 2)
      .map(([path, _]) => path);

    triadCandidates.forEach(a => {
      const aPartners = strongPairs.get(a) || [];
      for (let i = 0; i < aPartners.length; i++) {
        for (let j = i + 1; j < aPartners.length; j++) {
          const b = aPartners[i].partner;
          const c = aPartners[j].partner;

          // Ensure consistent ordering
          const sortedNodes = [a, b, c].sort();
          if (sortedNodes[0] !== a) continue; // Only process when 'a' is the first in sorted order

          const ab = pairScores.get(pairKey(a, b));
          const ac = pairScores.get(pairKey(a, c));
          const bc = pairScores.get(pairKey(b, c));

          if (!ab || !ac || !bc) continue;

          const mergedSignals = new Set<string>([
            ...ab.signals,
            ...ac.signals,
            ...bc.signals,
            "soft-cluster",
          ]);
          simplices.push({
            nodes: [a, b, c],
            weight: Math.min(1, Number((((ab.weight + ac.weight + bc.weight) / 3) + 0.05).toFixed(2))),
            label: "soft cluster",
            inferred: true,
            userDefined: false,
            autoGenerated: false,
            colorKey: "neutral",
            inferredSignals: [...mergedSignals],
            dominantSignal: "soft-cluster",
            confidence: Math.min(1, Number((((ab.weight + ac.weight + bc.weight) / 3) + 0.05).toFixed(2))),
            suggested: true,
          });
        }
      }
    });
  }

  logger.debug("inference", "Rebuilt inferred simplices (optimized)", {
    fileCount: contexts.length,
    inferredSimplexCount: simplices.length
  });
  return simplices;
}

export function inferSimplices(contexts: InferenceContext[], settings: PluginSettings): Simplex[] {
  console.time('inferSimplices-total');
  const mode = settings.inferenceMode ?? 'taxonomic';
  const results: Simplex[] = [];

  if (mode === 'taxonomic' || mode === 'hybrid') {
    console.time('inferSimplices-legacy');
    results.push(...inferSimplicesLegacy(contexts, settings));
    console.timeEnd('inferSimplices-legacy');
  }

  if (mode === 'emergent' || mode === 'hybrid') {
    console.time('inferSimplices-emergent');
    results.push(...inferSimplicesEmergentWithMode(contexts, settings));
    console.timeEnd('inferSimplices-emergent');
  }

  console.timeEnd('inferSimplices-total');
  return results;
}
