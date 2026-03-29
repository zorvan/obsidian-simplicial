import { ItemView, WorkspaceLeaf } from "obsidian";
import { SimplicialModel } from "../core/model";
import type { PluginSettings, RenderFilterMetric } from "../core/types";
import { VIEW_TYPE_SIMPLICIAL } from "../core/types";
import { Renderer } from "../render/renderer";

export class SimplicialView extends ItemView {
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
    this.renderFiltrationControls(hud);
    this.renderLegend(legend);
    const filters = contentEl.createDiv({ cls: "simplicial-filters" });
    this.addFilterToggle(filters, "edges", () => this.settings.showEdges, (value) => (this.settings.showEdges = value));
    this.addFilterToggle(filters, "clusters", () => this.settings.showClusters, (value) => (this.settings.showClusters = value));
    this.addFilterToggle(filters, "cores", () => this.settings.showCores, (value) => (this.settings.showCores = value));
    this.renderer.init(canvasWrap);
  }

  async onClose(): Promise<void> {
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

  private renderFiltrationControls(container: HTMLElement): void {
    const wrap = container.createDiv({ cls: "simplicial-filtration" });
    wrap.createSpan({ text: "Filter" });
    const metricSelect = wrap.createEl("select");
    const metrics: Array<{ value: RenderFilterMetric; label: string }> = [
      { value: "weight", label: "weight" },
      { value: "confidence", label: "confidence" },
      { value: "decayed-weight", label: "decayed" },
    ];
    metrics.forEach((metric) => {
      const option = metricSelect.createEl("option", { text: metric.label });
      option.value = metric.value;
      option.selected = this.settings.renderFilterMetric === metric.value;
    });

    const slider = wrap.createEl("input", { type: "range" });
    slider.min = "0";
    slider.max = "1";
    slider.step = "0.01";
    slider.value = String(this.settings.renderFilterThreshold);

    const valueEl = wrap.createSpan({
      text: this.settings.renderFilterThreshold.toFixed(2).replace(/\.00$/, ""),
    });

    const apply = (): void => {
      this.settings.renderFilterMetric = metricSelect.value as RenderFilterMetric;
      this.settings.renderFilterThreshold = Number(slider.value);
      valueEl.setText(this.settings.renderFilterThreshold.toFixed(2).replace(/\.00$/, ""));
      this.onSettingsChanged();
      this.renderer.render();
    };

    metricSelect.addEventListener("change", apply);
    slider.addEventListener("input", apply);
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
