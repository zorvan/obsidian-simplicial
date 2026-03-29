import type { App, CachedMetadata, TFile } from "obsidian";
import type { PluginSettings, Simplex } from "../core/types";
import { logger } from "../core/logger";

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "for", "with", "from", "into", "onto", "in", "on", "at", "to", "of",
  "is", "are", "was", "were", "be", "been", "being", "this", "that", "these", "those", "it", "its", "as", "by",
  "about", "after", "before", "between", "through", "during", "over", "under", "again", "further", "then", "once",
  "note", "notes", "todo", "idea"
]);

export interface InferenceContext {
  path: string;
  folder: string;
  topFolder: string;
  titleTokens: Set<string>;
  contentTokens: Set<string>;
  tags: Set<string>;
  outgoingLinks: Set<string>;
}

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
  };
}

export function inferSimplices(contexts: InferenceContext[], settings: Pick<
  PluginSettings,
  | "linkGraphBaseline"
  | "enableInferredEdges"
  | "inferenceThreshold"
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
  for (let i = 0; i < contexts.length; i++) {
    for (let j = i + 1; j < contexts.length; j++) {
      const a = contexts[i];
      const b = contexts[j];
      let score = 0;
      const signals: string[] = [];
      let hasLinkRelation = false;

      if (a.outgoingLinks.has(b.path)) {
        hasLinkRelation = true;
        score += settings.linkWeight;
        signals.push("link:a->b");
      }
      if (b.outgoingLinks.has(a.path)) {
        hasLinkRelation = true;
        score += settings.mutualLinkBonus;
        signals.push("link:b->a");
      }

      if (!settings.linkGraphBaseline && hasLinkRelation) {
        score = 0;
        hasLinkRelation = false;
        signals.length = 0;
      }

      if (!settings.enableInferredEdges && !hasLinkRelation) continue;

      const sharedTags = sharedCount(a.tags, b.tags);
      if (settings.enableInferredEdges && sharedTags > 0) {
        const contribution = Math.min(settings.sharedTagWeight * 3, sharedTags * settings.sharedTagWeight);
        score += contribution;
        signals.push(`tags:${sharedTags}`);
      }

      const titleContribution = settings.enableInferredEdges
        ? overlapScore(a.titleTokens, b.titleTokens, settings.titleOverlapWeight)
        : 0;
      if (titleContribution > 0) {
        score += titleContribution;
        signals.push(`title:${titleContribution.toFixed(2)}`);
      }

      const contentContribution = settings.enableInferredEdges
        ? overlapScore(a.contentTokens, b.contentTokens, settings.contentOverlapWeight)
        : 0;
      if (contentContribution > 0) {
        score += contentContribution;
        signals.push(`content:${contentContribution.toFixed(2)}`);
      }

      if (settings.enableInferredEdges && a.folder && a.folder === b.folder) {
        score += settings.sameFolderWeight;
        signals.push("folder:same");
      } else if (settings.enableInferredEdges && a.topFolder && a.topFolder === b.topFolder) {
        score += settings.sameTopFolderWeight;
        signals.push("folder:top");
      }

      if (!hasLinkRelation && score < settings.inferenceThreshold) continue;
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
    }
  }

  if (settings.enableInferredEdges) {
    const strongPairThreshold = Math.max(settings.inferenceThreshold, 0.18);
    for (let i = 0; i < contexts.length; i++) {
      for (let j = i + 1; j < contexts.length; j++) {
        for (let k = j + 1; k < contexts.length; k++) {
          const a = contexts[i].path;
          const b = contexts[j].path;
          const c = contexts[k].path;
          const ab = pairScores.get(pairKey(a, b));
          const ac = pairScores.get(pairKey(a, c));
          const bc = pairScores.get(pairKey(b, c));
          if (!ab || !ac || !bc) continue;
          if (ab.weight < strongPairThreshold || ac.weight < strongPairThreshold || bc.weight < strongPairThreshold) continue;
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
    }
  }

  logger.debug("inference", "Rebuilt inferred simplices", {
    fileCount: contexts.length,
    inferredSimplexCount: simplices.length
  });
  return simplices;
}
