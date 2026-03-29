import type { App, TFile } from "obsidian";

export function normalizeNodeToken(nodeId: string): string {
  return nodeId.toLowerCase().trim();
}

export function normalizeKey(nodes: string[]): string {
  return [...nodes].map(normalizeNodeToken).sort().join("|");
}

export function normalizeNodes<T extends string>(nodes: T[]): T[] {
  return [...nodes].sort((a, b) => normalizeNodeToken(a).localeCompare(normalizeNodeToken(b)));
}

export function uniqueNodes<T extends string>(nodes: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const node of normalizeNodes(nodes)) {
    const token = normalizeNodeToken(node);
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(node);
  }
  return out;
}

export function resolveNodeId(rawId: string, sourcePath: string, app: App): TFile | null {
  const trimmed = rawId.trim();
  if (!trimmed) return null;
  const direct = app.metadataCache.getFirstLinkpathDest(trimmed, sourcePath);
  if (direct) return direct;

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
