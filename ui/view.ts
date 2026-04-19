import { ItemView, WorkspaceLeaf } from "obsidian";
import { SimplicialModel } from "../core/model";
import type { PluginSettings, RenderFilterMetric } from "../core/types";
import { VIEW_TYPE_SIMPLICIAL } from "../core/types";
import { Renderer } from "../render/renderer";
import { computeFiltrationEvents, getEventThresholds, type FiltrationEvent } from "../core/filtration";

export class SimplicialView extends ItemView {
  private filtrationEvents: FiltrationEvent[] = [];
  private eventMarkers: HTMLElement[] = [];

  constructor(
    leaf: WorkspaceLeaf,
    private model: SimplicialModel,
    private renderer: Renderer,
    private settings: PluginSettings,
    private onSettingsChanged: () => void,
  ) {
    super(leaf);
    this.computeFiltrationEvents();
    this.model.subscribe(() => this.computeFiltrationEvents());
  }

  private computeFiltrationEvents(): void {
    if (!this.settings.showFiltrationSlider) return;
    this.filtrationEvents = computeFiltrationEvents(this.model, this.settings.renderFilterMetric);
    this.updateEventMarkers();
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

  private sliderWrap: HTMLElement | null = null;
  private sliderEl: HTMLInputElement | null = null;

  private renderFiltrationControls(container: HTMLElement): void {
    this.sliderWrap = container.createDiv({ cls: "simplicial-filtration" });
    this.sliderWrap.createSpan({ text: "Filter" });
    const metricSelect = this.sliderWrap.createEl("select");
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

    const sliderContainer = this.sliderWrap.createDiv({ cls: "simplicial-filtration-slider-container" });
    this.sliderEl = sliderContainer.createEl("input", { type: "range", cls: "simplicial-filtration-slider" });
    this.sliderEl.min = "0";
    this.sliderEl.max = "1";
    this.sliderEl.step = "0.01";
    this.sliderEl.value = String(this.settings.renderFilterThreshold);

    const valueEl = this.sliderWrap.createSpan({
      text: this.settings.renderFilterThreshold.toFixed(2).replace(/\.00$/, ""),
    });

    const apply = (): void => {
      this.settings.renderFilterMetric = metricSelect.value as RenderFilterMetric;
      this.settings.renderFilterThreshold = Number(this.sliderEl?.value ?? 0);
      valueEl.setText(this.settings.renderFilterThreshold.toFixed(2).replace(/\.00$/, ""));
      this.onSettingsChanged();
      this.renderer.render();
    };

    metricSelect.addEventListener("change", () => {
      apply();
      this.computeFiltrationEvents();
    });
    this.sliderEl.addEventListener("input", apply);

    // Add initial event markers
    this.updateEventMarkers();
  }

  private updateEventMarkers(): void {
    // Clear existing markers
    this.eventMarkers.forEach(m => m.remove());
    this.eventMarkers = [];

    if (!this.sliderWrap || !this.sliderEl || this.filtrationEvents.length === 0) return;

    const thresholds = getEventThresholds(this.filtrationEvents);
    const sliderRect = this.sliderEl.getBoundingClientRect();
    if (sliderRect.width === 0) return; // Slider not rendered yet

    thresholds.forEach(threshold => {
      const marker = this.sliderWrap!.createDiv({ cls: "simplicial-filtration-marker" });
      const percent = threshold * 100;
      marker.style.left = `${percent}%`;
      marker.style.position = "absolute";
      marker.title = `Event at ${threshold.toFixed(2)}`;
      this.eventMarkers.push(marker);
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
