import {
  App,
  Menu,
  Notice,
  Plugin,
  TFile,
  type Editor,
  MarkdownView,
} from "obsidian";
import { SimplicialModel } from "./core/model";
import { normalizeKey, resolveNodeId } from "./core/normalize";
import { logger } from "./core/logger";
import type { PluginSettings, Simplex } from "./core/types";
import { deserializeReinforcement, serializeReinforcement, type ReinforcementState } from "./data/interactions";
import { VIEW_TYPE_SIMPLICIAL, VIEW_TYPE_SIMPLICIAL_PANEL } from "./core/types";
import {
  ensureCentralFile,
  getDefaultSettings,
  removeSimplexFromManagedFile,
  readCentralFileState,
  writeSimplexToCentralFile,
  writeSimplexToSourceNote,
} from "./data/persistence";
import { VaultIndex } from "./data/vault-index";
import { InteractionController } from "./interaction/controller";
import { LayoutEngine } from "./layout/engine";
import { Renderer } from "./render/renderer";
import { CreateSimplexModal } from "./ui/create-simplex-modal";
import { createPromotedNote, MetadataPanel } from "./ui/panel";
import { SimplicialView } from "./ui/view";
import { SimplicialSettingTab } from "./settings/setting-tab";

export default class SimplicialPlugin extends Plugin {
  settings!: PluginSettings;
  model!: SimplicialModel;
  index!: VaultIndex;
  engine!: LayoutEngine;
  renderer!: Renderer;
  controller!: InteractionController;
  panelView: MetadataPanel | null = null;
  simplicialView: SimplicialView | null = null;
  private saveTimer: number | null = null;
  private rescanTimer: number | null = null;

  async onload(): Promise<void> {
    this.settings = Object.assign(getDefaultSettings(), await this.loadData());
    if (this.settings.maxRenderedDim === 3) {
      this.settings.maxRenderedDim = 12;
    }
    logger.info("plugin", "Loading plugin", {
      persistenceMode: this.settings.persistenceMode,
      centralFile: this.settings.centralFile,
      showEdges: this.settings.showEdges,
      showClusters: this.settings.showClusters,
      showCores: this.settings.showCores,
      pinnedNodeCount: Object.keys(this.settings.pinnedNodes).length
    });
    this.model = new SimplicialModel();
    this.engine = new LayoutEngine();
    this.engine.configure({
      noiseAmount: this.settings.noiseAmount,
      sleepThreshold: this.settings.sleepThreshold,
      repulsionStrength: this.settings.repulsionStrength,
      cohesionStrength: this.settings.cohesionStrength,
      gravityStrength: this.settings.gravityStrength,
      dampingFactor: this.settings.dampingFactor,
      boundaryPadding: this.settings.boundaryPadding,
      sparseEdgeLength: this.settings.sparseEdgeLength,
      sparseGravityBoost: this.settings.sparseGravityBoost,
    });
    this.controller = new InteractionController(
      this.model,
      () => this.engine.wake(),
      (simplexKey) => this.panelView?.setSelection(simplexKey),
      (simplexKey) => void this.openPanel(simplexKey, false),
      () => this.queueSaveSettings(),
      (tracker) => this.saveInteractionState(tracker),
    );

    // Restore interaction state if exists
    const savedInteractions = this.settings.interactionState;
    if (savedInteractions) {
      this.controller.setInteractionTracker(deserializeReinforcement(savedInteractions));
    }
    this.renderer = new Renderer(this.model, this.engine, this.controller, this.settings, {
      onContextMenu: (target, event) => this.openCanvasContextMenu(target, event),
      onLassoCreate: (nodeIds) => void this.openCreateSimplexModal(nodeIds, nodeIds[0] ?? ""),
      onNodeOpen: (nodeId) => void this.openNodeNote(nodeId),
    });
    this.index = new VaultIndex(this.app, this.model, this.settings, () => this.engine.wake());

    this.restorePinnedNodes();

    this.registerView(
      VIEW_TYPE_SIMPLICIAL,
      (leaf) => {
        const view = new SimplicialView(
          leaf,
          this.model,
          this.renderer,
          this.settings,
          () => this.queueSaveSettings(),
          (reason, delayMs) => this.scheduleFullScan(reason, delayMs),
        );
        this.simplicialView = view;
        return view;
      },
    );
    this.registerView(VIEW_TYPE_SIMPLICIAL_PANEL, (leaf) => {
      const panel = new MetadataPanel(leaf, this.model);
      panel.setActions({
        saveMetadata: (simplexKey, updates) => this.persistSimplexMetadata(simplexKey, updates),
        promoteSimplex: (simplexKey) => this.promoteSimplex(simplexKey),
        dissolveSimplex: (simplexKey) => this.dissolveSimplex(simplexKey),
      });
      panel.setSettings(this.settings);
      this.panelView = panel;
      return panel;
    });

    this.addRibbonIcon("network", "Simplicial Graph", () => void this.activateView());
    this.addCommand({
      id: "open-simplicial",
      name: "Open simplicial graph",
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "g" }],
      callback: () => void this.activateView(),
    });
    this.addCommand({
      id: "insert-simplex-symbol",
      name: "Insert triangle simplex marker",
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "s" }],
      editorCallback: (editor: Editor) => editor.replaceSelection("\u25b3 "),
    });
    this.addCommand({
      id: "form-simplex-from-open-note",
      name: "Simplicial: Form simplex from open note",
      callback: () => void this.formSimplexFromOpenNote(),
    });
    this.addCommand({
      id: "toggle-edges",
      name: "Toggle simplicial edges",
      hotkeys: [{ modifiers: [], key: "1" }],
      callback: () => {
        this.settings.showEdges = !this.settings.showEdges;
        void this.saveSettings();
        this.renderer.render();
      },
    });
    this.addCommand({
      id: "toggle-clusters",
      name: "Toggle simplicial clusters",
      hotkeys: [{ modifiers: [], key: "2" }],
      callback: () => {
        this.settings.showClusters = !this.settings.showClusters;
        void this.saveSettings();
        this.renderer.render();
      },
    });
    this.addCommand({
      id: "toggle-cores",
      name: "Toggle simplicial cores",
      hotkeys: [{ modifiers: [], key: "3" }],
      callback: () => {
        this.settings.showCores = !this.settings.showCores;
        void this.saveSettings();
        this.renderer.render();
      },
    });
    this.addCommand({
      id: "clear-simplicial-focus",
      name: "Clear simplicial focus",
      hotkeys: [{ modifiers: [], key: "Escape" }],
      callback: () => {
        this.controller.clearFocus();
        this.renderer.render();
      },
    });
    this.addCommand({
      id: "focus-hovered-node",
      name: "Focus hovered simplicial node",
      hotkeys: [{ modifiers: [], key: "f" }],
      callback: () => {
        this.controller.focusHoveredNode();
        this.renderer.render();
      },
    });
    this.addCommand({
      id: "open-hovered-simplex-panel",
      name: "Open metadata panel for hovered simplex",
      hotkeys: [{ modifiers: [], key: "p" }],
      callback: () => void this.openPanelForCurrentSelection(),
    });
    this.addSettingTab(new SimplicialSettingTab(this.app, this));

    this.model.subscribe(() => {
      this.engine.wake();
    });
    await this.logPersistenceState();
    this.scheduleFullScan("startup", 0);
    this.app.workspace.onLayoutReady(() => this.scheduleFullScan("layout-ready", 50));
    this.registerEvent(this.app.metadataCache.on("resolved", () => this.scheduleFullScan("metadata-resolved", 50)));
  }

  onunload(): void {
    if (this.rescanTimer !== null) window.clearTimeout(this.rescanTimer);
    logger.info("plugin", "Unloading plugin", {
      indexedNodeCount: this.model.nodes.size,
      simplexCount: this.model.simplices.size
    });
    this.renderer.destroy();
    this.index.destroy();
  }

  private restorePinnedNodes(): void {
    logger.info("plugin", "Restoring pinned nodes", {
      pinnedNodeCount: Object.keys(this.settings.pinnedNodes).length
    });
    Object.entries(this.settings.pinnedNodes).forEach(([nodeId, pos]) => {
      this.model.setNode(nodeId, { isPinned: true, px: pos.px, py: pos.py });
    });
  }

  async saveSettings(): Promise<void> {
    const pinned: PluginSettings["pinnedNodes"] = {};
    this.model.getAllNodes().forEach((node) => {
      if (node.isPinned) pinned[node.id] = { px: node.px, py: node.py };
    });
    this.settings.pinnedNodes = pinned;
    await this.saveData(this.settings);
    this.index?.updateSettings(this.settings);
    logger.info("plugin", "Saved persistence state", {
      persistenceMode: this.settings.persistenceMode,
      centralFile: this.settings.centralFile,
      pinnedNodeCount: Object.keys(this.settings.pinnedNodes).length,
      filters: {
        edges: this.settings.showEdges,
        clusters: this.settings.showClusters,
        cores: this.settings.showCores
      },
      inference: {
        linkBaseline: this.settings.linkGraphBaseline,
        enabled: this.settings.enableInferredEdges,
        threshold: this.settings.inferenceThreshold,
        suggestions: this.settings.showSuggestions,
        suggestionThreshold: this.settings.suggestionThreshold,
      },
      layout: {
        repulsion: this.settings.repulsionStrength,
        cohesion: this.settings.cohesionStrength,
        gravity: this.settings.gravityStrength,
        damping: this.settings.dampingFactor,
        boundaryPadding: this.settings.boundaryPadding,
        sparseEdgeLength: this.settings.sparseEdgeLength,
        sparseGravityBoost: this.settings.sparseGravityBoost,
        labelDensity: this.settings.labelDensity,
        renderFilterMetric: this.settings.renderFilterMetric,
        renderFilterThreshold: this.settings.renderFilterThreshold,
      },
      commandUi: {
        simplexSize: this.settings.commandSimplexSize,
        autoOpenPanel: this.settings.commandAutoOpenPanel,
        metadataHoverDelayMs: this.settings.metadataHoverDelayMs,
        formalMode: this.settings.formalMode,
      }
    });
  }

  private queueSaveSettings(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.saveSettings();
    }, 150);
  }

  private saveInteractionState(tracker: ReinforcementState): void {
    this.settings.interactionState = serializeReinforcement(tracker);
    this.queueSaveSettings();
  }

  async activateView(): Promise<void> {
    await this.app.workspace.getLeaf(true).setViewState({ type: VIEW_TYPE_SIMPLICIAL, active: true });
    const right = this.app.workspace.getRightLeaf(false);
    if (right) {
      await right.setViewState({ type: VIEW_TYPE_SIMPLICIAL_PANEL, active: false });
    }
  }

  private async persistSimplexMetadata(simplexKey: string, updates: { label?: string; weight?: number }): Promise<void> {
    logger.info("plugin", "Persisting simplex metadata", {
      simplexKey,
      updates,
      persistenceMode: this.settings.persistenceMode
    });
    this.model.updateMetadata(simplexKey, updates);
    const simplex = this.model.getSimplex(simplexKey);
    if (!simplex?.sourcePath) {
      logger.warn("plugin", "Simplex has no sourcePath; only settings state will be saved", {
        simplexKey
      });
      await this.saveSettings();
      return;
    }
    await this.persistSimplex(simplex);
    await this.saveSettings();
  }

  private async formSimplexFromOpenNote(): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const file = view?.file;
    if (!file) {
      new Notice("Open a note first.");
      return;
    }
    const cache = this.app.metadataCache.getFileCache(file);
    const links = cache?.links?.map((link) => link.link) ?? [];
    const resolvedLinks = links
      .map((link) => this.app.metadataCache.getFirstLinkpathDest(link, file.path)?.path ?? link)
      .filter((path, index, all) => all.indexOf(path) === index);
    const desiredSize = Math.max(2, Math.min(6, this.settings.commandSimplexSize));
    const nodes = [file.path, ...resolvedLinks].slice(0, desiredSize);
    logger.info("plugin", "Form simplex from open note requested", {
      sourcePath: file.path,
      linkCount: links.length,
      desiredSize,
      proposedNodes: nodes
    });
    if (nodes.length < desiredSize) {
      new Notice(`Need at least ${desiredSize - 1} resolvable outgoing links to form this simplex.`);
      return;
    }
    await this.openCreateSimplexModal(nodes, file.path);
  }

  private async promoteSimplex(simplexKey: string): Promise<void> {
    const simplex = this.model.getSimplex(simplexKey);
    if (!simplex || simplex.autoGenerated) return;
    // Log interaction
    this.controller.logPromote(simplexKey, simplex.nodes);
    const noteTitle = simplex.label?.trim() || `simplex-${simplexKey.replace(/\|/g, "-")}`;
    const body = simplex.nodes.map((nodeId) => `- [[${nodeId.replace(/\.md$/, "")}]]`).join("\n");
    const promotedFile = await createPromotedNote(this.app, noteTitle, body);
    const nextSimplex: Simplex = {
      ...simplex,
      sourcePath: promotedFile.path,
      userDefined: true,
      inferred: false,
      suggested: false,
      autoGenerated: false,
    };

    if (simplex.sourcePath && simplex.sourcePath !== promotedFile.path) {
      const originalFile = this.app.vault.getAbstractFileByPath(simplex.sourcePath);
      if (originalFile instanceof TFile) {
        const nextOriginalContent = await removeSimplexFromManagedFile(this.app, originalFile, simplexKey);
        await this.app.vault.modify(originalFile, nextOriginalContent);
        this.index.recordWrite(originalFile.path, nextOriginalContent);
      }
    }

    const promotedContent = await writeSimplexToSourceNote(this.app, promotedFile, nextSimplex);
    await this.app.vault.modify(promotedFile, promotedContent);
    this.index.recordWrite(promotedFile.path, promotedContent);
    this.model.removeSimplex(simplexKey);
    const nextKey = this.model.addSimplex(nextSimplex);
    this.controller.selectSimplex(nextKey);
    await this.openPanel(nextKey, false);
    new Notice(`Simplex now owned by ${promotedFile.basename}.`);
  }

  private async openCreateSimplexModal(nodes: string[], sourcePath: string): Promise<void> {
    new CreateSimplexModal(
      this.app,
      nodes,
      this.settings.persistenceMode === "central-file" ? this.settings.centralFile : sourcePath,
      async (draft) => {
        const normalizedNodes = draft.nodes.map((node) => this.resolveDraftNode(node, sourcePath));
        const simplex: Simplex = {
          nodes: normalizedNodes,
          label: draft.label,
          weight: draft.weight,
          sourcePath: this.settings.persistenceMode === "central-file" ? this.settings.centralFile : sourcePath,
          userDefined: true,
          autoGenerated: false
        };
        const key = this.model.addSimplex(simplex);
        await this.persistSimplex(this.model.getSimplex(key)!);
        this.controller.selectSimplex(key);
        if (this.settings.commandAutoOpenPanel) {
          await this.openPanel(key, false);
        }
        logger.info("plugin", "Simplex created from guided modal", {
          simplexKey: key,
          sourcePath: simplex.sourcePath,
          simplexCount: this.model.simplices.size
        });
        new Notice(
          this.settings.persistenceMode === "central-file"
            ? `Simplex added to ${this.settings.centralFile}.`
            : "Simplex added to note frontmatter.",
        );
      },
    ).open();
  }

  private async openPanelForCurrentSelection(): Promise<void> {
    const simplexKey = this.controller.hoveredSimplexKey
      ?? (this.controller.hoveredNodeId
        ? this.model.getSimplicesForNode(this.controller.hoveredNodeId)[0]?.nodes
          ? normalizeKey(this.model.getSimplicesForNode(this.controller.hoveredNodeId)[0]!.nodes)
          : null
        : null);
    await this.openPanel(simplexKey, true);
  }

  private async logPersistenceState(): Promise<void> {
    logger.info("plugin", "Persistence state", {
      mode: this.settings.persistenceMode,
      centralFile: this.settings.centralFile
    });
    if (this.settings.persistenceMode === "central-file") {
      await readCentralFileState(this.app, this.settings.centralFile);
    } else {
      logger.info("persistence", "Source-note persistence active", {
        mode: this.settings.persistenceMode
      });
    }
  }

  private async persistSimplex(simplex: Simplex): Promise<void> {
    const shouldWriteCentral = simplex.sourcePath === this.settings.centralFile
      || (!simplex.sourcePath && this.settings.persistenceMode === "central-file");
    if (shouldWriteCentral) {
      const { file, content } = await writeSimplexToCentralFile(this.app, this.settings.centralFile, {
        ...simplex,
        sourcePath: this.settings.centralFile
      });
      await this.app.vault.modify(file, content);
      this.index.recordWrite(file.path, content);
      logger.info("plugin", "Persisted simplex to central file", {
        simplexKey: normalizeKey(simplex.nodes),
        path: file.path
      });
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(simplex.sourcePath ?? "");
    if (!(file instanceof TFile)) {
      logger.warn("plugin", "Unable to persist simplex to source note", {
        simplexKey: normalizeKey(simplex.nodes),
        sourcePath: simplex.sourcePath
      });
      return;
    }
    const content = await writeSimplexToSourceNote(this.app, file, simplex);
    await this.app.vault.modify(file, content);
    this.index.recordWrite(file.path, content);
    logger.info("plugin", "Persisted simplex to source note", {
      simplexKey: normalizeKey(simplex.nodes),
      path: file.path
    });
  }

  private openCanvasContextMenu(target: { nodeId?: string; simplexKey?: string }, event: MouseEvent): void {
    const menu = new Menu();
    if (target.nodeId) {
      menu.addItem((item) => item
        .setTitle("Open note")
        .setIcon("file-text")
        .onClick(() => void this.openNodeNote(target.nodeId!)));
      menu.addItem((item) => item
        .setTitle("Focus node")
        .setIcon("crosshair")
        .onClick(() => {
          this.controller.hoveredNodeId = target.nodeId!;
          this.controller.focusHoveredNode();
          this.renderer.render();
        }));
      menu.addItem((item) => item
        .setTitle("Create simplex from node + neighbors")
        .setIcon("plus-circle")
        .onClick(() => void this.createSimplexFromNode(target.nodeId!)));
      menu.addItem((item) => item
        .setTitle(this.model.nodes.get(target.nodeId!)?.isPinned ? "Unpin node" : "Pin node")
        .setIcon("pin")
        .onClick(() => {
          this.controller.togglePin(target.nodeId!);
          this.renderer.render();
        }));
    }
    if (target.simplexKey) {
      menu.addItem((item) => item
        .setTitle("Open metadata")
        .setIcon("info")
        .onClick(() => void this.openPanel(target.simplexKey!, true)));
      menu.addItem((item) => item
        .setTitle("Promote to note")
        .setIcon("up-right-from-square")
        .onClick(() => void this.promoteSimplex(target.simplexKey!)));
      menu.addItem((item) => item
        .setTitle("Dissolve simplex")
        .setIcon("trash")
        .onClick(() => void this.dissolveSimplex(target.simplexKey!)));
      menu.addItem((item) => item
        .setTitle("Show in formal view")
        .setIcon("sigma")
        .onClick(async () => {
          this.settings.formalMode = true;
          await this.saveSettings();
          this.controller.selectSimplex(target.simplexKey!);
          this.renderer.render();
        }));
    }
    menu.showAtMouseEvent(event);
  }

  private async openNodeNote(nodeId: string): Promise<void> {
    const direct = this.app.vault.getAbstractFileByPath(nodeId);
    const file = direct instanceof TFile ? direct : resolveNodeId(nodeId, nodeId, this.app);
    if (!(file instanceof TFile)) {
      new Notice("This node is not backed by a note yet.");
      return;
    }
    await this.app.workspace.getLeaf(true).openFile(file);
  }

  private async createSimplexFromNode(nodeId: string): Promise<void> {
    const neighbors = this.model.getNeighbors(nodeId);
    const nodes = [nodeId, ...neighbors].slice(0, Math.max(2, this.settings.commandSimplexSize));
    if (nodes.length < 2) {
      new Notice("Need at least one connected neighbor to form a simplex.");
      return;
    }
    await this.openCreateSimplexModal(nodes, nodeId);
  }

  private async dissolveSimplex(simplexKey: string): Promise<void> {
    const simplex = this.model.getSimplex(simplexKey);
    if (!simplex || simplex.autoGenerated) return;
    // Log interaction
    this.controller.logDissolve(simplexKey, simplex.nodes);
    const shouldWriteCentral = simplex.sourcePath === this.settings.centralFile
      || (!simplex.sourcePath && this.settings.persistenceMode === "central-file");
    if (shouldWriteCentral) {
      const file = await ensureCentralFile(this.app, this.settings.centralFile);
      const content = await removeSimplexFromManagedFile(this.app, file, simplexKey);
      await this.app.vault.modify(file, content);
      this.index.recordWrite(file.path, content);
    } else {
      const sourcePath = simplex.sourcePath ?? "";
      const file = this.app.vault.getAbstractFileByPath(sourcePath);
      if (!(file instanceof TFile)) return;
      const content = await removeSimplexFromManagedFile(this.app, file, simplexKey);
      await this.app.vault.modify(file, content);
      this.index.recordWrite(file.path, content);
    }
    this.model.removeSimplex(simplexKey);
    this.controller.clearFocus();
    this.panelView?.setSelection(null);
    logger.info("plugin", "Dissolved simplex", {
      simplexKey,
      persistenceMode: this.settings.persistenceMode
    });
  }

  private async openPanel(simplexKey: string | null, active: boolean): Promise<void> {
    const right = this.app.workspace.getRightLeaf(false);
    if (!right) return;
    await right.setViewState({ type: VIEW_TYPE_SIMPLICIAL_PANEL, active });
    this.panelView?.setSelection(simplexKey);
    logger.info("plugin", "Opened metadata panel", {
      simplexKey,
      active
    });
  }

  private resolveDraftNode(value: string, sourcePath: string): string {
    return this.app.metadataCache.getFirstLinkpathDest(value, sourcePath)?.path ?? value.trim();
  }

  scheduleFullScan(reason: string, delayMs: number): void {
    if (this.rescanTimer !== null) window.clearTimeout(this.rescanTimer);
    this.rescanTimer = window.setTimeout(async () => {
      this.rescanTimer = null;
      logger.info("plugin", "Running full scan", { reason });
      await this.index.fullScan();
      this.renderer.render();
      logger.info("plugin", "Full scan complete", {
        reason,
        indexedNodeCount: this.model.nodes.size,
        simplexCount: this.model.simplices.size
      });
    }, delayMs);
  }
}
