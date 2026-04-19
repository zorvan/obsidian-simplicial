import {
  App,
  Menu,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  type Editor,
  MarkdownView,
  SliderComponent,
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

class SimplicialSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: SimplicialPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Persistence mode")
      .setDesc("Choose where confirmed simplices are stored.")
      .addDropdown((dropdown) => {
        dropdown.addOption("source-note", "Source note");
        dropdown.addOption("central-file", "Central file");
        dropdown.setValue(this.plugin.settings.persistenceMode);
        dropdown.onChange(async (value) => {
          const mode = value as PluginSettings["persistenceMode"];
          this.plugin.settings.persistenceMode = mode;
          if (mode === "central-file") {
            await ensureCentralFile(this.app, this.plugin.settings.centralFile);
          }
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Central file")
      .addText((text) => {
        text.setValue(this.plugin.settings.centralFile);
        text.onChange(async (value) => {
          this.plugin.settings.centralFile = value || "_simplicial.md";
          if (this.plugin.settings.persistenceMode === "central-file") {
            await ensureCentralFile(this.app, this.plugin.settings.centralFile);
          }
          await this.plugin.saveSettings();
        });
      });

    {
      const setting = new Setting(containerEl)
        .setName("Max rendered dimension")
        .setDesc("Highest simplex dimension to draw. A 10-node simplex has dimension 9.");
      this.addNumberSlider(setting, this.plugin.settings.maxRenderedDim, 1, 12, 1, async (value) => {
        this.plugin.settings.maxRenderedDim = value;
        await this.plugin.saveSettings();
        this.plugin.renderer.render();
      });
    }

    {
      const setting = new Setting(containerEl)
        .setName("Noise amount");
      this.addNumberSlider(setting, this.plugin.settings.noiseAmount, 0, 0.5, 0.01, async (value) => {
        this.plugin.settings.noiseAmount = value;
        this.plugin.engine.configure({ noiseAmount: value });
        await this.plugin.saveSettings();
      });
    }

    {
      const setting = new Setting(containerEl)
        .setName("Repulsion strength")
        .setDesc("Higher values push nodes apart more strongly.");
      this.addNumberSlider(setting, this.plugin.settings.repulsionStrength, 200, 6000, 100, async (value) => {
        this.plugin.settings.repulsionStrength = value;
        this.plugin.engine.configure({ repulsionStrength: value });
        await this.plugin.saveSettings();
      });
    }

    {
      const setting = new Setting(containerEl)
        .setName("Cohesion strength")
        .setDesc("Higher values pull connected simplices together more strongly.");
      this.addNumberSlider(setting, this.plugin.settings.cohesionStrength, 0.001, 0.03, 0.001, async (value) => {
        this.plugin.settings.cohesionStrength = value;
        this.plugin.engine.configure({ cohesionStrength: value });
        await this.plugin.saveSettings();
      });
    }

    {
      const setting = new Setting(containerEl)
        .setName("Gravity strength")
        .setDesc("Higher values keep nodes toward the center instead of drifting to the edges.");
      this.addNumberSlider(setting, this.plugin.settings.gravityStrength, 0.0001, 0.01, 0.0001, async (value) => {
        this.plugin.settings.gravityStrength = value;
        this.plugin.engine.configure({ gravityStrength: value });
        await this.plugin.saveSettings();
      });
    }

    {
      const setting = new Setting(containerEl)
        .setName("Damping")
        .setDesc("Higher values make motion settle more slowly and glide more.");
      this.addNumberSlider(setting, this.plugin.settings.dampingFactor, 0.5, 0.99, 0.01, async (value) => {
        this.plugin.settings.dampingFactor = value;
        this.plugin.engine.configure({ dampingFactor: value });
        await this.plugin.saveSettings();
      });
    }

    {
      const setting = new Setting(containerEl)
        .setName("Boundary padding")
        .setDesc("Minimum distance nodes keep from the canvas edges.");
      this.addNumberSlider(setting, this.plugin.settings.boundaryPadding, 0, 200, 5, async (value) => {
        this.plugin.settings.boundaryPadding = value;
        this.plugin.engine.configure({ boundaryPadding: value });
        await this.plugin.saveSettings();
      });
    }

    {
      const setting = new Setting(containerEl)
        .setName("Sleep threshold");
      this.addNumberSlider(setting, this.plugin.settings.sleepThreshold, 0.001, 0.1, 0.001, async (value) => {
        this.plugin.settings.sleepThreshold = value;
        this.plugin.engine.configure({ sleepThreshold: value });
        await this.plugin.saveSettings();
      });
    }

    new Setting(containerEl)
      .setName("Dark mode")
      .addDropdown((dropdown) => {
        dropdown.addOption("auto", "Auto");
        dropdown.addOption("force-light", "Force light");
        dropdown.addOption("force-dark", "Force dark");
        dropdown.setValue(this.plugin.settings.darkMode);
        dropdown.onChange(async (value) => {
          this.plugin.settings.darkMode = value as PluginSettings["darkMode"];
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Link graph baseline")
      .setDesc("Always show note-to-note vault links as 1-simplices, even without higher-order structure.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.linkGraphBaseline);
        toggle.onChange(async (value) => {
          this.plugin.settings.linkGraphBaseline = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Enable inferred edges")
      .setDesc("Use tags, links, titles, content, and folders to infer lightweight edges.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.enableInferredEdges);
        toggle.onChange(async (value) => {
          this.plugin.settings.enableInferredEdges = value;
          await this.plugin.saveSettings();
        });
      });

    {
      const setting = new Setting(containerEl)
        .setName("Inference threshold")
        .setDesc("Minimum combined signal needed before an inferred edge is created.");
      this.addNumberSlider(setting, this.plugin.settings.inferenceThreshold, 0.05, 0.6, 0.01, async (value) => {
        this.plugin.settings.inferenceThreshold = value;
        await this.plugin.saveSettings();
      });
    }

    new Setting(containerEl)
      .setName("Show suggestions")
      .setDesc("Render closure and soft-cluster suggestions directly on the canvas.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.showSuggestions);
        toggle.onChange(async (value) => {
          this.plugin.settings.showSuggestions = value;
          await this.plugin.saveSettings();
          this.plugin.renderer.render();
        });
      });

    {
      const setting = new Setting(containerEl)
        .setName("Suggestion threshold")
        .setDesc("Confidence level required before a suggestion is surfaced in the UI.");
      this.addNumberSlider(setting, this.plugin.settings.suggestionThreshold, 0.2, 0.95, 0.01, async (value) => {
        this.plugin.settings.suggestionThreshold = value;
        await this.plugin.saveSettings();
      });
    }

    // Legacy inference weights (only apply when inference mode is taxonomic or hybrid)
    containerEl.createEl("h4", { text: "Legacy Inference Weights", cls: "setting-heading" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "These weights only apply when using Legacy or Hybrid inference mode. They control rule-based edge detection."
    });

    this.addWeightSlider(containerEl, "Link weight", "Strength added by a resolved outbound link.", "linkWeight", "enableLinkInference", 0, 0.6, 0.01);
    this.addWeightSlider(containerEl, "Mutual link bonus", "Extra weight when both notes link each other.", "mutualLinkBonus", "enableMutualLinkBonus", 0, 0.6, 0.01);
    this.addWeightSlider(containerEl, "Shared tag weight", "Weight contributed by each shared tag.", "sharedTagWeight", "enableSharedTags", 0, 0.2, 0.01);
    this.addWeightSlider(containerEl, "Title overlap weight", "Maximum title-token overlap contribution.", "titleOverlapWeight", "enableTitleOverlap", 0, 0.3, 0.01);
    this.addWeightSlider(containerEl, "Content overlap weight", "Maximum body-text overlap contribution.", "contentOverlapWeight", "enableContentOverlap", 0, 0.3, 0.01);
    this.addWeightSlider(containerEl, "Same folder weight", "Boost when two notes share the same folder (Legacy mode only).", "sameFolderWeight", "enableSameFolderInference", 0, 0.2, 0.01);
    this.addWeightSlider(containerEl, "Top folder weight", "Boost when two notes share the same top-level folder (Legacy mode only).", "sameTopFolderWeight", "enableSameTopFolderInference", 0, 0.2, 0.01);

    {
      const setting = new Setting(containerEl)
        .setName("Command simplex size")
        .setDesc("How many nodes the create-from-open-note command tries to include.");
      this.addNumberSlider(setting, this.plugin.settings.commandSimplexSize, 2, 6, 1, async (value) => {
        this.plugin.settings.commandSimplexSize = value;
        await this.plugin.saveSettings();
      });
    }

    new Setting(containerEl)
      .setName("Formal mode")
      .setDesc("Switch from ambient blobs to a crisper geometric rendering with analysis overlays.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.formalMode);
        toggle.onChange(async (value) => {
          this.plugin.settings.formalMode = value;
          await this.plugin.saveSettings();
          this.plugin.renderer.render();
        });
      });

    {
      const setting = new Setting(containerEl)
        .setName("Sparse edge length")
        .setDesc("Preferred spacing for sparse link-only graphs.");
      this.addNumberSlider(setting, this.plugin.settings.sparseEdgeLength, 60, 280, 5, async (value) => {
        this.plugin.settings.sparseEdgeLength = value;
        this.plugin.engine.configure({ sparseEdgeLength: value });
        await this.plugin.saveSettings();
      });
    }

    {
      const setting = new Setting(containerEl)
        .setName("Sparse gravity boost")
        .setDesc("Extra centering force when the graph is mostly pairwise and sparse.");
      this.addNumberSlider(setting, this.plugin.settings.sparseGravityBoost, 1, 4, 0.1, async (value) => {
        this.plugin.settings.sparseGravityBoost = value;
        this.plugin.engine.configure({ sparseGravityBoost: value });
        await this.plugin.saveSettings();
      });
    }

    {
      const setting = new Setting(containerEl)
        .setName("Label density")
        .setDesc("Controls how many non-focused labels are allowed before decluttering hides the rest.");
      this.addNumberSlider(setting, this.plugin.settings.labelDensity, 0.1, 1, 0.05, async (value) => {
        this.plugin.settings.labelDensity = value;
        await this.plugin.saveSettings();
        this.plugin.renderer.render();
      });
    }

    new Setting(containerEl)
      .setName("Filtration metric")
      .setDesc("Choose which simplex strength field the live filtration slider uses.")
      .addDropdown((dropdown) => {
        dropdown.addOption("weight", "Weight");
        dropdown.addOption("confidence", "Confidence");
        dropdown.addOption("decayed-weight", "Decayed weight");
        dropdown.setValue(this.plugin.settings.renderFilterMetric);
        dropdown.onChange(async (value) => {
          this.plugin.settings.renderFilterMetric = value as PluginSettings["renderFilterMetric"];
          await this.plugin.saveSettings();
          this.plugin.renderer.render();
        });
      });

    {
      const setting = new Setting(containerEl)
        .setName("Filtration threshold")
        .setDesc("Hide simplices below this threshold in the active filtration metric.");
      this.addNumberSlider(setting, this.plugin.settings.renderFilterThreshold, 0, 1, 0.01, async (value) => {
        this.plugin.settings.renderFilterThreshold = value;
        await this.plugin.saveSettings();
        this.plugin.renderer.render();
      });
    }

    new Setting(containerEl)
      .setName("Open metadata panel after create")
      .setDesc("Show the metadata panel immediately after the command creates a simplex.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.commandAutoOpenPanel);
        toggle.onChange(async (value) => {
          this.plugin.settings.commandAutoOpenPanel = value;
          await this.plugin.saveSettings();
        });
      });

    {
      const setting = new Setting(containerEl)
        .setName("Metadata hover delay")
        .setDesc("Delay before hover-driven metadata UI should appear.");
      this.addNumberSlider(setting, this.plugin.settings.metadataHoverDelayMs, 250, 2000, 50, async (value) => {
        this.plugin.settings.metadataHoverDelayMs = value;
        await this.plugin.saveSettings();
      });
    }

    // V2 Settings Section - Inference Architecture
    containerEl.createEl("h3", { text: "Inference Engine (V2)" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "The plugin has two inference systems: Emergent (graph-based with semantic clustering) and Legacy (rule-based). Choose which to use."
    });

    new Setting(containerEl)
      .setName("Inference mode")
      .setDesc("Emergent = semantic graph analysis | Legacy = rule-based heuristics | Hybrid = both")
      .addDropdown((dropdown) => {
        dropdown.addOption("emergent", "Emergent (semantic graph)");
        dropdown.addOption("taxonomic", "Legacy (rule-based)");
        dropdown.addOption("hybrid", "Hybrid (both systems)");
        dropdown.setValue(this.plugin.settings.inferenceMode);
        dropdown.onChange(async (value) => {
          this.plugin.settings.inferenceMode = value as PluginSettings["inferenceMode"];
          await this.plugin.saveSettings();
          new Notice(`Inference mode: ${value}. Rescanning vault...`);
          this.plugin.scheduleFullScan("inference-mode-changed", 100);
          this.refreshSettingVisibility();
        });
      });

    // Emergent-mode settings (shown first as primary option)
    const emergentSettingsDiv = containerEl.createDiv({ cls: "emergent-settings" });

    emergentSettingsDiv.createEl("h4", { text: "Emergent Inference Settings", cls: "setting-heading" });

    new Setting(emergentSettingsDiv)
      .setName("Domain source")
      .setDesc("How note domains are determined for coloring and edge strength.")
      .addDropdown((dropdown) => {
        dropdown.addOption("folder", "Folder structure");
        dropdown.addOption("content-cluster", "Content clustering (TF-IDF)");
        dropdown.addOption("hybrid", "Hybrid (folder + content)");
        dropdown.setValue(this.plugin.settings.domainSource);
        dropdown.onChange(async (value) => {
          this.plugin.settings.domainSource = value as PluginSettings["domainSource"];
          await this.plugin.saveSettings();
          new Notice(`Domain source: ${value}. Rescanning...`);
          this.plugin.scheduleFullScan("domain-source-changed", 100);
        });
      });

    {
      const setting = new Setting(emergentSettingsDiv)
        .setName("Content cluster count")
        .setDesc("Number of semantic clusters (used when domain source is content-cluster or hybrid).");
      this.addNumberSlider(setting, this.plugin.settings.contentClusterCount, 2, 12, 1, async (value) => {
        this.plugin.settings.contentClusterCount = value;
        await this.plugin.saveSettings();
        if (this.plugin.settings.domainSource !== "folder") {
          new Notice(`Cluster count: ${value}. Rescanning...`);
          this.plugin.scheduleFullScan("cluster-count-changed", 100);
        }
      });
    }

    {
      const setting = new Setting(emergentSettingsDiv)
        .setName("Link strength threshold")
        .setDesc("Minimum edge strength for emergent mode to create a visible link (0.0 = all edges, 1.0 = only strongest).");
      this.addNumberSlider(setting, this.plugin.settings.linkStrengthThreshold, 0, 1, 0.01, async (value) => {
        this.plugin.settings.linkStrengthThreshold = value;
        await this.plugin.saveSettings();
        new Notice(`Link threshold: ${value.toFixed(2)}. Rescanning...`);
        this.plugin.scheduleFullScan("link-threshold-changed", 100);
      });
    }

    new Setting(containerEl)
      .setName("Enable Betti computation")
      .setDesc("Calculate topological invariants (β₀, β₁, β₂) to detect holes and voids.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.enableBettiComputation);
        toggle.onChange(async (value) => {
          this.plugin.settings.enableBettiComputation = value;
          await this.plugin.saveSettings();
          this.plugin.simplicialView?.refreshSettings();
          this.plugin.renderer.render();
          new Notice(value ? "Betti computation enabled" : "Betti computation disabled");
        });
      });

    new Setting(containerEl)
      .setName("Display Betti on canvas")
      .setDesc("Show live Betti numbers in the top-left HUD overlay (requires Betti computation to be enabled).")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.bettiDisplayOnCanvas);
        toggle.onChange(async (value) => {
          this.plugin.settings.bettiDisplayOnCanvas = value;
          await this.plugin.saveSettings();
          this.plugin.renderer.render();
          new Notice(value ? "Betti HUD will appear in top-left of graph" : "Betti HUD hidden");
        });
      });

    new Setting(containerEl)
      .setName("Max Betti dimension")
      .setDesc("Compute holes up to this dimension (1 = triangles, 2 = tetrahedra).")
      .addDropdown((dropdown) => {
        dropdown.addOption("1", "β₁ only (unfilled triangles)");
        dropdown.addOption("2", "β₁ and β₂ (including voids)");
        dropdown.setValue(String(this.plugin.settings.maxBettiDim));
        dropdown.onChange(async (value) => {
          this.plugin.settings.maxBettiDim = Number(value) as 1 | 2;
          await this.plugin.saveSettings();
          this.plugin.renderer.render();
        });
      });

    new Setting(containerEl)
      .setName("Show filtration slider")
      .setDesc("Enable the slider UI with topological event markers in the graph view. (Requires reopening the view)")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.showFiltrationSlider);
        toggle.onChange(async (value) => {
          this.plugin.settings.showFiltrationSlider = value;
          await this.plugin.saveSettings();
          this.plugin.simplicialView?.refreshSettings();
          new Notice(value ? "Filtration slider enabled" : "Filtration slider hidden");
        });
      });

    new Setting(containerEl)
      .setName("Enable explanation panel")
      .setDesc("Show human-readable explanations for inferred simplices in the metadata panel.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.enableExplanationPanel);
        toggle.onChange(async (value) => {
          this.plugin.settings.enableExplanationPanel = value;
          await this.plugin.saveSettings();
          this.plugin.panelView?.setSettings(this.plugin.settings);
          new Notice(value ? "Explanation cards enabled" : "Explanation cards disabled");
        });
      });

    // Store reference to emergent settings div for visibility toggling
    (this as unknown as Record<string, HTMLElement>)['_emergentSettingsDiv'] = emergentSettingsDiv;
    this.refreshSettingVisibility();
  }

  private refreshSettingVisibility(): void {
    const emergentDiv = (this as unknown as Record<string, HTMLElement>)['_emergentSettingsDiv'];
    if (!emergentDiv) return;
    const isEmergentMode = this.plugin.settings.inferenceMode === 'emergent' || this.plugin.settings.inferenceMode === 'hybrid';
    emergentDiv.style.display = isEmergentMode ? 'block' : 'none';
  }

  private addNumberSlider(
    setting: Setting,
    initialValue: number,
    min: number,
    max: number,
    step: number,
    onChange: (value: number) => Promise<void>,
  ): void {
    setting.addSlider((slider) => {
      const valueEl = setting.controlEl.createSpan({ cls: "simplicial-setting-value" });
      const format = (value: number): string => {
        const decimals = step >= 1 ? 0 : `${step}`.split(".")[1]?.length ?? 0;
        return value.toFixed(decimals).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
      };

      valueEl.setText(format(initialValue));
      slider.setLimits(min, max, step);
      slider.setValue(initialValue);
      slider.onChange(async (value) => {
        valueEl.setText(format(value));
        await onChange(value);
      });
    });
  }

  private addWeightSlider(
    containerEl: HTMLElement,
    name: string,
    desc: string,
    key: keyof Pick<
      PluginSettings,
      | "linkWeight"
      | "mutualLinkBonus"
      | "sharedTagWeight"
      | "titleOverlapWeight"
      | "contentOverlapWeight"
      | "sameFolderWeight"
      | "sameTopFolderWeight"
    >,
    enabledKey: keyof Pick<
      PluginSettings,
      | "enableLinkInference"
      | "enableMutualLinkBonus"
      | "enableSharedTags"
      | "enableTitleOverlap"
      | "enableContentOverlap"
      | "enableSameFolderInference"
      | "enableSameTopFolderInference"
    >,
    min: number,
    max: number,
    step: number,
  ): void {
    const setting = new Setting(containerEl)
      .setName(name)
      .setDesc(desc);
    let sliderRef: SliderComponent | null = null;
    const format = (value: number): string => {
      const decimals = step >= 1 ? 0 : `${step}`.split(".")[1]?.length ?? 0;
      return value.toFixed(decimals).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
    };

    setting.addToggle((toggle) => {
      toggle.setTooltip("Enable or disable this inference signal");
      toggle.setValue(this.plugin.settings[enabledKey]);
      toggle.onChange(async (value) => {
        this.plugin.settings[enabledKey] = value as never;
        sliderRef?.setDisabled(!value);
        await this.plugin.saveSettings();
      });
    });

    setting.addSlider((slider) => {
      sliderRef = slider;
      const valueEl = setting.controlEl.createSpan({ cls: "simplicial-setting-value" });
      valueEl.setText(format(this.plugin.settings[key]));
      slider.setLimits(min, max, step);
      slider.setValue(this.plugin.settings[key]);
      slider.setDisabled(!this.plugin.settings[enabledKey]);
      slider.onChange(async (value) => {
        valueEl.setText(format(value));
        this.plugin.settings[key] = value as never;
        await this.plugin.saveSettings();
      });
    });
  }
}
