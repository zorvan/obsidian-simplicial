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
} from "obsidian";
import { SimplicialModel } from "./core/model";
import { normalizeKey } from "./core/normalize";
import { logger } from "./core/logger";
import type { PluginSettings, Simplex } from "./core/types";
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
    );
    this.renderer = new Renderer(this.model, this.engine, this.controller, this.settings, {
      onContextMenu: (target, event) => this.openCanvasContextMenu(target, event),
      onLassoCreate: (nodeIds) => void this.openCreateSimplexModal(nodeIds, nodeIds[0] ?? ""),
    });
    this.index = new VaultIndex(this.app, this.model, this.settings, () => this.engine.wake());

    this.restorePinnedNodes();

    this.registerView(
      VIEW_TYPE_SIMPLICIAL,
      (leaf) => new SimplicialView(leaf, this.model, this.renderer, this.settings, () => this.queueSaveSettings()),
    );
    this.registerView(VIEW_TYPE_SIMPLICIAL_PANEL, (leaf) => {
      const panel = new MetadataPanel(leaf, this.model);
      panel.setActions({
        saveMetadata: (simplexKey, updates) => this.persistSimplexMetadata(simplexKey, updates),
        promoteSimplex: (simplexKey) => this.promoteSimplex(simplexKey),
        dissolveSimplex: (simplexKey) => this.dissolveSimplex(simplexKey),
      });
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
        .setTitle("Pin / unpin node")
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
    const file = this.app.vault.getAbstractFileByPath(nodeId);
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

  private scheduleFullScan(reason: string, delayMs: number): void {
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

    new Setting(containerEl)
      .setName("Max rendered dimension")
      .setDesc("Highest simplex dimension to draw. A 10-node simplex has dimension 9.")
      .addSlider((slider) => {
        slider.setLimits(1, 12, 1);
        slider.setValue(this.plugin.settings.maxRenderedDim);
        slider.onChange(async (value) => {
          this.plugin.settings.maxRenderedDim = value;
          await this.plugin.saveSettings();
          this.plugin.renderer.render();
        });
      });

    new Setting(containerEl)
      .setName("Noise amount")
      .addSlider((slider) => {
        slider.setLimits(0, 0.5, 0.01);
        slider.setValue(this.plugin.settings.noiseAmount);
        slider.onChange(async (value) => {
          this.plugin.settings.noiseAmount = value;
          this.plugin.engine.configure({ noiseAmount: value });
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Repulsion strength")
      .setDesc("Higher values push nodes apart more strongly.")
      .addSlider((slider) => {
        slider.setLimits(200, 6000, 100);
        slider.setValue(this.plugin.settings.repulsionStrength);
        slider.onChange(async (value) => {
          this.plugin.settings.repulsionStrength = value;
          this.plugin.engine.configure({ repulsionStrength: value });
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Cohesion strength")
      .setDesc("Higher values pull connected simplices together more strongly.")
      .addSlider((slider) => {
        slider.setLimits(0.001, 0.03, 0.001);
        slider.setValue(this.plugin.settings.cohesionStrength);
        slider.onChange(async (value) => {
          this.plugin.settings.cohesionStrength = value;
          this.plugin.engine.configure({ cohesionStrength: value });
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Gravity strength")
      .setDesc("Higher values keep nodes toward the center instead of drifting to the edges.")
      .addSlider((slider) => {
        slider.setLimits(0.0001, 0.01, 0.0001);
        slider.setValue(this.plugin.settings.gravityStrength);
        slider.onChange(async (value) => {
          this.plugin.settings.gravityStrength = value;
          this.plugin.engine.configure({ gravityStrength: value });
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Damping")
      .setDesc("Higher values make motion settle more slowly and glide more.")
      .addSlider((slider) => {
        slider.setLimits(0.5, 0.99, 0.01);
        slider.setValue(this.plugin.settings.dampingFactor);
        slider.onChange(async (value) => {
          this.plugin.settings.dampingFactor = value;
          this.plugin.engine.configure({ dampingFactor: value });
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Boundary padding")
      .setDesc("Minimum distance nodes keep from the canvas edges.")
      .addSlider((slider) => {
        slider.setLimits(0, 200, 5);
        slider.setValue(this.plugin.settings.boundaryPadding);
        slider.onChange(async (value) => {
          this.plugin.settings.boundaryPadding = value;
          this.plugin.engine.configure({ boundaryPadding: value });
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Sleep threshold")
      .addSlider((slider) => {
        slider.setLimits(0.001, 0.1, 0.001);
        slider.setValue(this.plugin.settings.sleepThreshold);
        slider.onChange(async (value) => {
          this.plugin.settings.sleepThreshold = value;
          this.plugin.engine.configure({ sleepThreshold: value });
          await this.plugin.saveSettings();
        });
      });

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

    new Setting(containerEl)
      .setName("Inference threshold")
      .setDesc("Minimum combined signal needed before an inferred edge is created.")
      .addSlider((slider) => {
        slider.setLimits(0.05, 0.6, 0.01);
        slider.setValue(this.plugin.settings.inferenceThreshold);
        slider.onChange(async (value) => {
          this.plugin.settings.inferenceThreshold = value;
          await this.plugin.saveSettings();
        });
      });

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

    new Setting(containerEl)
      .setName("Suggestion threshold")
      .setDesc("Confidence level required before a suggestion is surfaced in the UI.")
      .addSlider((slider) => {
        slider.setLimits(0.2, 0.95, 0.01);
        slider.setValue(this.plugin.settings.suggestionThreshold);
        slider.onChange(async (value) => {
          this.plugin.settings.suggestionThreshold = value;
          await this.plugin.saveSettings();
        });
      });

    this.addWeightSlider(containerEl, "Link weight", "Strength added by a resolved outbound link.", "linkWeight", 0.05, 0.6, 0.01);
    this.addWeightSlider(containerEl, "Mutual link bonus", "Extra weight when both notes link each other.", "mutualLinkBonus", 0.05, 0.6, 0.01);
    this.addWeightSlider(containerEl, "Shared tag weight", "Weight contributed by each shared tag.", "sharedTagWeight", 0.01, 0.2, 0.01);
    this.addWeightSlider(containerEl, "Title overlap weight", "Maximum title-token overlap contribution.", "titleOverlapWeight", 0.01, 0.3, 0.01);
    this.addWeightSlider(containerEl, "Content overlap weight", "Maximum body-text overlap contribution.", "contentOverlapWeight", 0.01, 0.3, 0.01);
    this.addWeightSlider(containerEl, "Same folder weight", "Boost when two notes share the same folder.", "sameFolderWeight", 0, 0.2, 0.01);
    this.addWeightSlider(containerEl, "Top folder weight", "Boost when two notes share the same top-level folder.", "sameTopFolderWeight", 0, 0.2, 0.01);

    new Setting(containerEl)
      .setName("Command simplex size")
      .setDesc("How many nodes the create-from-open-note command tries to include.")
      .addSlider((slider) => {
        slider.setLimits(2, 6, 1);
        slider.setValue(this.plugin.settings.commandSimplexSize);
        slider.onChange(async (value) => {
          this.plugin.settings.commandSimplexSize = value;
          await this.plugin.saveSettings();
        });
      });

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

    new Setting(containerEl)
      .setName("Sparse edge length")
      .setDesc("Preferred spacing for sparse link-only graphs.")
      .addSlider((slider) => {
        slider.setLimits(60, 280, 5);
        slider.setValue(this.plugin.settings.sparseEdgeLength);
        slider.onChange(async (value) => {
          this.plugin.settings.sparseEdgeLength = value;
          this.plugin.engine.configure({ sparseEdgeLength: value });
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Sparse gravity boost")
      .setDesc("Extra centering force when the graph is mostly pairwise and sparse.")
      .addSlider((slider) => {
        slider.setLimits(1, 4, 0.1);
        slider.setValue(this.plugin.settings.sparseGravityBoost);
        slider.onChange(async (value) => {
          this.plugin.settings.sparseGravityBoost = value;
          this.plugin.engine.configure({ sparseGravityBoost: value });
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Label density")
      .setDesc("Controls how many non-focused labels are allowed before decluttering hides the rest.")
      .addSlider((slider) => {
        slider.setLimits(0.1, 1, 0.05);
        slider.setValue(this.plugin.settings.labelDensity);
        slider.onChange(async (value) => {
          this.plugin.settings.labelDensity = value;
          await this.plugin.saveSettings();
          this.plugin.renderer.render();
        });
      });

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

    new Setting(containerEl)
      .setName("Metadata hover delay")
      .setDesc("Delay before hover-driven metadata UI should appear.")
      .addSlider((slider) => {
        slider.setLimits(250, 2000, 50);
        slider.setValue(this.plugin.settings.metadataHoverDelayMs);
        slider.onChange(async (value) => {
          this.plugin.settings.metadataHoverDelayMs = value;
          await this.plugin.saveSettings();
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
    min: number,
    max: number,
    step: number,
  ): void {
    new Setting(containerEl)
      .setName(name)
      .setDesc(desc)
      .addSlider((slider) => {
        slider.setLimits(min, max, step);
        slider.setValue(this.plugin.settings[key]);
        slider.onChange(async (value) => {
          this.plugin.settings[key] = value as never;
          await this.plugin.saveSettings();
        });
      });
  }
}
