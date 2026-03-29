import { debounce, TFile, type App, type TAbstractFile } from "obsidian";
import { djb2Hash } from "../core/hash";
import { logger } from "../core/logger";
import { SimplicialModel } from "../core/model";
import type { PluginSettings } from "../core/types";
import { buildInferenceContext, inferSimplices, type InferenceContext } from "./inference";
import { parseSimplices } from "./parser";

export class VaultIndex {
  private lastWrittenHash = new Map<string, number>();
  private fileSimplexKeys = new Map<string, Set<string>>();
  private inferenceContexts = new Map<string, InferenceContext>();
  private lastInferredSnapshot = "";
  private debouncedChange: (file: TFile) => void;

  constructor(
    private app: App,
    private model: SimplicialModel,
    private settings: PluginSettings,
    private onExternalChange?: () => void,
  ) {
    this.debouncedChange = debounce((file: TFile) => {
      void this.onFileChange(file);
    }, 100, true);

    this.app.vault.on("modify", (file) => file instanceof TFile && this.debouncedChange(file));
    this.app.vault.on("create", (file) => file instanceof TFile && this.debouncedChange(file));
    this.app.vault.on("delete", (file) => this.onFileDelete(file));
    this.app.vault.on("rename", (file, oldPath) => {
      if (file instanceof TFile) this.onFileRename(file, oldPath);
    });
  }

  recordWrite(path: string, content: string): void {
    this.lastWrittenHash.set(path, djb2Hash(content));
    logger.debug("vault-index", "Recorded plugin write hash", {
      path,
      hash: this.lastWrittenHash.get(path)
    });
  }

  updateSettings(settings: PluginSettings): void {
    this.settings = settings;
    this.rebuildInferredSimplices();
  }

  async fullScan(): Promise<void> {
    const files = this.app.vault.getMarkdownFiles();
    logger.info("vault-index", "Starting full vault scan", {
      fileCount: files.length
    });
    for (const file of files) {
      const content = await this.app.vault.read(file);
      this.processFile(file, content);
    }
    this.rebuildInferredSimplices();
    logger.info("vault-index", "Completed full vault scan", {
      fileCount: files.length,
      indexedNodeCount: this.model.nodes.size,
      simplexCount: this.model.simplices.size
    });
  }

  private async onFileChange(file: TFile): Promise<void> {
    if (file.extension !== "md") return;
    const content = await this.app.vault.read(file);
    const currentHash = djb2Hash(content);
    if (this.lastWrittenHash.get(file.path) === currentHash) {
      logger.debug("vault-index", "Suppressed self-triggered modify event", {
        path: file.path,
        hash: currentHash
      });
      return;
    }
    logger.info("vault-index", "Processing changed file", {
      path: file.path,
      hash: currentHash
    });
    this.processFile(file, content);
    this.rebuildInferredSimplices();
    this.onExternalChange?.();
  }

  private onFileDelete(file: TAbstractFile): void {
    if (!(file instanceof TFile)) return;
    logger.info("vault-index", "File deleted", { path: file.path });
    this.inferenceContexts.delete(file.path);
    this.model.removeNode(file.path);
    this.model.replaceSourceSimplices(file.path, []);
    this.rebuildInferredSimplices();
    this.onExternalChange?.();
  }

  private onFileRename(file: TFile, oldPath: string): void {
    logger.info("vault-index", "File renamed", {
      oldPath,
      newPath: file.path
    });
    this.model.updateNodeId(oldPath, file.path);
    const oldKeys = this.fileSimplexKeys.get(oldPath);
    if (oldKeys) {
      this.fileSimplexKeys.set(file.path, oldKeys);
      this.fileSimplexKeys.delete(oldPath);
    }
    const context = this.inferenceContexts.get(oldPath);
    if (context) {
      this.inferenceContexts.set(file.path, { ...context, path: file.path });
      this.inferenceContexts.delete(oldPath);
    }
    this.rebuildInferredSimplices();
    this.onExternalChange?.();
  }

  private processFile(file: TFile, content: string): void {
    this.model.setNode(file.path, { isVirtual: false });
    const parsed = parseSimplices(content, file.path, this.app);
    this.model.replaceSourceSimplices(file.path, parsed.simplices);
    this.fileSimplexKeys.set(file.path, new Set(parsed.simplices.map((simplex) => simplex.nodes.join("|"))));
    this.inferenceContexts.set(file.path, buildInferenceContext(this.app, file, content));
    logger.info("vault-index", "Indexed file", {
      path: file.path,
      parsedSimplexCount: parsed.simplices.length,
      parsedNodeCount: parsed.nodeIds.size,
      totalNodeCount: this.model.nodes.size,
      totalSimplexCount: this.model.simplices.size
    });
  }

  private rebuildInferredSimplices(): void {
    const inferred = inferSimplices([...this.inferenceContexts.values()], this.settings);
    this.model.replaceInferredSimplices(inferred);
    const snapshot = JSON.stringify({
      inferredSimplexCount: inferred.length,
      totalSimplexCount: this.model.simplices.size,
      totalNodeCount: this.model.nodes.size,
      enabled: this.settings.enableInferredEdges
    });
    if (snapshot !== this.lastInferredSnapshot) {
      this.lastInferredSnapshot = snapshot;
      logger.debug("vault-index", "Updated inferred graph state", JSON.parse(snapshot) as Record<string, unknown>);
    }
  }

  destroy(): void {
    // Obsidian handles event cleanup via plugin registration scope.
  }
}
