import { ItemView, WorkspaceLeaf } from "obsidian";
import { SimplicialModel } from "../core/model";
import type { PluginSettings, RenderFilterMetric, Simplex } from "../core/types";
import { VIEW_TYPE_SIMPLICIAL } from "../core/types";
import { Renderer } from "../render/renderer";
import { computeFiltrationEvents, getEventThresholds, type FiltrationEvent } from "../core/filtration";
import type SimplicialPlugin from "../main";

export class SimplicialView extends ItemView {
  private filtrationEvents: FiltrationEvent[] = [];
  private eventMarkers: HTMLElement[] = [];

  private onRescan?: (reason: string, delayMs: number) => void;

  constructor(
    leaf: WorkspaceLeaf,
    private model: SimplicialModel,
    private renderer: Renderer,
    private settings: PluginSettings,
    private onSettingsChanged: () => void,
    onRescan?: (reason: string, delayMs: number) => void,
  ) {
    super(leaf);
    this.onRescan = onRescan;
    this.computeFiltrationEvents();
    this.model.subscribe(() => {
      this.computeFiltrationEvents();
    });
  }

  setRescanCallback(callback: (reason: string, delayMs: number) => void): void {
    this.onRescan = callback;
  }

  private computeFiltrationEvents(): void {
    if (!this.settings.showFiltrationSlider) {
      // Hide slider if disabled
      if (this.sliderWrap) {
        this.sliderWrap.style.display = "none";
      }
      return;
    }
    // Show slider if enabled
    if (this.sliderWrap) {
      this.sliderWrap.style.display = "";
    }
    this.filtrationEvents = computeFiltrationEvents(this.model, this.settings.renderFilterMetric);
    this.updateEventMarkers();
  }

  refreshSettings(): void {
    this.computeFiltrationEvents();
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

    // Add floating canvas controls
    this.renderFloatingControls(contentEl);

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

    // Header with label and value
    const header = this.sliderWrap.createDiv({ cls: "simplicial-filtration-header" });
    header.createSpan({ text: "Filter" });
    const valueEl = header.createSpan({
      cls: "simplicial-filtration-value",
      text: this.settings.renderFilterThreshold.toFixed(3),
    });

    // Metric select dropdown
    const metricSelect = this.sliderWrap.createEl("select", { cls: "simplicial-filtration-metric" });
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

    // Dual slider container
    const sliderContainer = this.sliderWrap.createDiv({ cls: "simplicial-filtration-sliders" });

    // Coarse slider (0 to 1, step 0.1)
    const coarseRow = sliderContainer.createDiv({ cls: "simplicial-slider-row" });
    coarseRow.createSpan({ text: "Range", cls: "simplicial-slider-label" });
    const coarseSlider = coarseRow.createEl("input", {
      type: "range",
      cls: "simplicial-filtration-slider coarse",
    });
    coarseSlider.min = "0";
    coarseSlider.max = "1";
    coarseSlider.step = "0.1";
    coarseSlider.value = String(Math.round(this.settings.renderFilterThreshold * 10) / 10);

    // Fine slider (±0.05 around coarse, step 0.001)
    const fineRow = sliderContainer.createDiv({ cls: "simplicial-slider-row" });
    fineRow.createSpan({ text: "Fine", cls: "simplicial-slider-label" });
    const fineSlider = fineRow.createEl("input", {
      type: "range",
      cls: "simplicial-filtration-slider fine",
    });
    fineSlider.min = "-0.05";
    fineSlider.max = "0.05";
    fineSlider.step = "0.001";
    fineSlider.value = "0";

    // Store reference for updates
    this.sliderEl = coarseSlider;

    let coarseValue = Number(coarseSlider.value);
    let fineOffset = 0;

    const updateValue = (): number => {
      let value = coarseValue + fineOffset;
      value = Math.max(0, Math.min(1, value));
      valueEl.setText(value.toFixed(3));
      this.settings.renderFilterThreshold = value;
      this.onSettingsChanged();
      this.renderer.render();
      return value;
    };

    coarseSlider.addEventListener("input", () => {
      coarseValue = Number(coarseSlider.value);
      fineOffset = 0;
      fineSlider.value = "0";
      updateValue();
    });

    fineSlider.addEventListener("input", () => {
      fineOffset = Number(fineSlider.value);
      updateValue();
    });

    fineSlider.addEventListener("change", () => {
      const currentValue = coarseValue + fineOffset;
      if (currentValue <= 0 || currentValue >= 1) {
        coarseValue = Math.max(0, Math.min(1, currentValue));
        coarseSlider.value = String(Math.round(coarseValue * 10) / 10);
        fineOffset = 0;
        fineSlider.value = "0";
      }
    });

    metricSelect.addEventListener("change", () => {
      this.settings.renderFilterMetric = metricSelect.value as RenderFilterMetric;
      this.onSettingsChanged();
      this.renderer.render();
      this.computeFiltrationEvents();
    });

    // Add initial event markers
    this.updateEventMarkers();
  }

  private renderFloatingControls(container: HTMLElement): void {
    const controlsWrap = container.createDiv({ cls: "simplicial-floating-controls" });

    // Toggle button
    const toggleBtn = controlsWrap.createDiv({ cls: "simplicial-controls-toggle" });
    toggleBtn.setText("⚙️");
    toggleBtn.title = "Canvas Settings";

    // Controls panel
    const panel = controlsWrap.createDiv({ cls: "simplicial-controls-panel" });

    // === INFERENCE CONTROLS ===
    const inferenceHeader = panel.createDiv({ cls: "simplicial-control-header" });
    inferenceHeader.setText("Inference");

    // Link Threshold - Dual slider (coarse + fine)
    this.addDualSlider(panel, "Link Threshold", this.settings.linkStrengthThreshold, (value) => {
      this.settings.linkStrengthThreshold = value;
      this.onSettingsChanged();
      this.onRescan?.("canvas-link-threshold-changed", 100);
    });

    // Insight Threshold
    this.addCanvasSlider(panel, "Insight Threshold", this.settings.insightThreshold, 0, 1, 0.05, (value) => {
      this.settings.insightThreshold = value;
      this.onSettingsChanged();
      this.onRescan?.("canvas-insight-threshold-changed", 100);
    });

    // Suggestion Threshold
    this.addCanvasSlider(panel, "Suggestion Min", this.settings.suggestionThreshold, 0.2, 0.95, 0.05, (value) => {
      this.settings.suggestionThreshold = value;
      this.onSettingsChanged();
      this.renderer.render();
    });

    // === VISIBILITY CONTROLS ===
    const visibilityHeader = panel.createDiv({ cls: "simplicial-control-header" });
    visibilityHeader.setText("Visibility");

    // Betti Toggle
    this.addCanvasToggle(panel, "Show Holes", this.settings.enableBettiComputation, (value) => {
      this.settings.enableBettiComputation = value;
      this.onSettingsChanged();
      this.renderer.render();
    });

    // Show Suggestions Toggle
    this.addCanvasToggle(panel, "Suggestions", this.settings.showSuggestions, (value) => {
      this.settings.showSuggestions = value;
      this.onSettingsChanged();
      this.renderer.render();
    });

    // === PHYSICS CONTROLS ===
    const physicsHeader = panel.createDiv({ cls: "simplicial-control-header" });
    physicsHeader.setText("Physics");

    // Repulsion Strength
    this.addCanvasSlider(panel, "Repulsion", this.settings.repulsionStrength, 100, 2000, 100, (value) => {
      this.settings.repulsionStrength = value;
      this.onSettingsChanged();
      // Physics changes need engine reconfigure
    });

    // Gravity Strength (very small values, 0.0001 to 0.02)
    this.addCanvasSlider(panel, "Gravity", this.settings.gravityStrength, 0.0001, 0.02, 0.0001, (value) => {
      this.settings.gravityStrength = value;
      this.onSettingsChanged();
    });

    // === ACTIONS ===
    const actionsHeader = panel.createDiv({ cls: "simplicial-control-header" });
    actionsHeader.setText("Actions");

    // Rescan button
    const rescanRow = panel.createDiv({ cls: "simplicial-control-row" });
    const rescanBtn = rescanRow.createEl("button", { cls: "simplicial-control-button", text: "🔄 Rescan Vault" });
    rescanBtn.addEventListener("click", () => {
      this.onRescan?.("manual-rescan", 0);
    });

    // Toggle panel visibility
    toggleBtn.addEventListener("click", () => {
      panel.style.display = panel.style.display === "none" ? "block" : "none";
    });

    // Start hidden
    panel.style.display = "none";
  }

  private addCanvasToggle(
    container: HTMLElement,
    label: string,
    initialValue: boolean,
    onChange: (value: boolean) => void,
  ): void {
    const row = container.createDiv({ cls: "simplicial-control-row" });
    row.createSpan({ text: label });
    const toggle = row.createEl("input", { type: "checkbox" });
    toggle.checked = initialValue;
    toggle.addEventListener("change", () => {
      onChange(toggle.checked);
    });
  }

  private addCanvasSlider(
    container: HTMLElement,
    label: string,
    initialValue: number,
    min: number,
    max: number,
    step: number,
    onChange: (value: number) => void,
  ): void {
    const row = container.createDiv({ cls: "simplicial-control-row" });
    row.createSpan({ text: label });
    const slider = row.createEl("input", { type: "range" });
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(initialValue);

    // Determine decimal places based on step size
    const decimalPlaces = step < 0.001 ? 4 : step < 0.01 ? 3 : 2;
    const valueDisplay = row.createSpan({ cls: "simplicial-control-value", text: initialValue.toFixed(decimalPlaces) });

    slider.addEventListener("input", () => {
      const value = Number(slider.value);
      valueDisplay.setText(value.toFixed(decimalPlaces));
      onChange(value);
    });
  }

  private addDualSlider(
    container: HTMLElement,
    label: string,
    initialValue: number,
    onChange: (value: number) => void,
  ): void {
    const wrap = container.createDiv({ cls: "simplicial-dual-slider-wrap" });

    // Value display header
    const header = wrap.createDiv({ cls: "simplicial-dual-slider-header" });
    header.createSpan({ text: label });
    const valueDisplay = header.createSpan({ cls: "simplicial-control-value", text: initialValue.toFixed(3) });

    // Coarse slider (0 to 1, step 0.1) - sets the base value
    const coarseRow = wrap.createDiv({ cls: "simplicial-control-row" });
    coarseRow.createSpan({ text: "Range", cls: "simplicial-slider-label" });
    const coarseSlider = coarseRow.createEl("input", { type: "range" });
    coarseSlider.min = "0";
    coarseSlider.max = "1";
    coarseSlider.step = "0.1";
    coarseSlider.value = String(Math.round(initialValue * 10) / 10);

    // Fine slider (-0.05 to +0.05 around coarse value, step 0.001)
    const fineRow = wrap.createDiv({ cls: "simplicial-control-row" });
    fineRow.createSpan({ text: "Fine", cls: "simplicial-slider-label" });
    const fineSlider = fineRow.createEl("input", { type: "range" });
    fineSlider.min = "-0.05";
    fineSlider.max = "0.05";
    fineSlider.step = "0.001";
    fineSlider.value = "0";

    let coarseValue = Number(coarseSlider.value);
    let fineOffset = 0;

    const updateValue = (): number => {
      let value = coarseValue + fineOffset;
      // Clamp to [0, 1]
      value = Math.max(0, Math.min(1, value));
      valueDisplay.setText(value.toFixed(3));
      onChange(value);
      return value;
    };

    coarseSlider.addEventListener("input", () => {
      coarseValue = Number(coarseSlider.value);
      // Reset fine slider when coarse changes
      fineOffset = 0;
      fineSlider.value = "0";
      updateValue();
    });

    fineSlider.addEventListener("input", () => {
      fineOffset = Number(fineSlider.value);
      updateValue();
    });

    // Allow fine slider to "stick" at edges - if we hit bounds, adjust coarse
    fineSlider.addEventListener("change", () => {
      const currentValue = coarseValue + fineOffset;
      if (currentValue <= 0 || currentValue >= 1) {
        // Update coarse to the clamped value and reset fine
        coarseValue = Math.max(0, Math.min(1, currentValue));
        coarseSlider.value = String(Math.round(coarseValue * 10) / 10);
        fineOffset = 0;
        fineSlider.value = "0";
      }
    });
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
