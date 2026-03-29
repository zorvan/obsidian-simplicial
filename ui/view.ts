import { ItemView, WorkspaceLeaf } from "obsidian";
import { SimplicialModel } from "../core/model";
import type { PluginSettings } from "../core/types";
import { VIEW_TYPE_SIMPLICIAL } from "../core/types";
import { Renderer } from "../render/renderer";

export class SimplicialView extends ItemView {
  private unsubscribe?: () => void;
  private statsEl?: HTMLElement;

  constructor(
    leaf: WorkspaceLeaf,
    private model: SimplicialModel,
    private renderer: Renderer,
    private settings: PluginSettings,
    private onSettingsChanged: () => void,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_SIMPLICIAL;
  }

  getDisplayText(): string {
    return "Simplicial Graph";
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("simplicial-view");
    const canvasWrap = contentEl.createDiv({ cls: "simplicial-view-wrap" });
    const hud = contentEl.createDiv({ cls: "simplicial-hud" });
    const legend = contentEl.createDiv({ cls: "simplicial-legend" });
    this.statsEl = hud.createDiv({ cls: "simplicial-stats" });
    const hints = hud.createDiv({ cls: "simplicial-hints" });
    hints.setText("Wheel zooms. Left-drag pans empty space or moves nodes. Right-click opens actions. Shift-drag lassos. Double-click toggles pin.");
    this.renderLegend(legend);
    this.refreshStats();
    const filters = contentEl.createDiv({ cls: "simplicial-filters" });
    this.addFilterToggle(filters, "edges", () => this.settings.showEdges, (value) => (this.settings.showEdges = value));
    this.addFilterToggle(filters, "clusters", () => this.settings.showClusters, (value) => (this.settings.showClusters = value));
    this.addFilterToggle(filters, "cores", () => this.settings.showCores, (value) => (this.settings.showCores = value));
    this.unsubscribe = this.model.subscribe(() => this.refreshStats());
    this.renderer.init(canvasWrap);
  }

  async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.renderer.destroy();
  }

  private addFilterToggle(container: HTMLElement, label: string, getValue: () => boolean, setValue: (value: boolean) => void): void {
    const button = container.createEl("button", {
      cls: `simplicial-filter ${getValue() ? "is-on" : ""}`,
      text: label,
    });
    button.addEventListener("click", () => {
      const next = !getValue();
      setValue(next);
      button.toggleClass("is-on", next);
      this.onSettingsChanged();
      this.renderer.render();
    });
  }

  private refreshStats(): void {
    if (!this.statsEl) return;
    const summary = this.model.getAnalysisSummary();
    this.statsEl.empty();
    this.statsEl.createEl("div", {
      text: `${summary.nodeCount} nodes · ${summary.edgeCount} edges · ${summary.clusterCount} clusters · ${summary.coreCount} cores · ${summary.inferredCount} inferred`
    });
    this.statsEl.createEl("div", {
      text: `${summary.connectedComponents} components · avg degree ${summary.averageDegree} · ${summary.suggestedCount} suggestions`
    });
    if (summary.maxDegreeNodeId) {
      this.statsEl.createEl("div", {
        text: `Highest degree: ${summary.maxDegreeNodeId.replace(/\.md$/, "")} (${summary.maxDegree})`
      });
    }
    this.statsEl.createEl("div", {
      text: this.settings.formalMode ? "Formal mode emphasizes exact combinatorics." : "Ambient mode emphasizes felt structure."
    });
  }

  private renderLegend(container: HTMLElement): void {
    const items: Array<{ label: string; cls: string }> = [
      { label: "Link baseline", cls: "is-link" },
      { label: "Tag affinity", cls: "is-tag" },
      { label: "Folder affinity", cls: "is-folder" },
      { label: "Semantic overlap", cls: "is-semantic" },
      { label: "Soft cluster", cls: "is-cluster" },
      { label: "Confirmed simplex", cls: "is-confirmed" },
    ];
    items.forEach((item) => {
      const row = container.createDiv({ cls: "simplicial-legend-item" });
      row.createSpan({ cls: `simplicial-legend-swatch ${item.cls}` });
      row.createSpan({ text: item.label });
    });
  }
}
