import { App, Notice, PluginSettingTab, Setting, SliderComponent } from "obsidian";
import type SimplicialPlugin from "../main";
import { ensureCentralFile } from "../data/persistence";
import type { PluginSettings } from "../core/types";

export class SimplicialSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: SimplicialPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.renderPersistenceSettings(containerEl);
    this.renderLayoutSettings(containerEl);
    this.renderInferenceSettings(containerEl);
    this.renderCommandUiSettings(containerEl);
    this.renderBettiSettings(containerEl);
    this.renderEmergentSettings(containerEl);
    this.renderLegacySettings(containerEl);

    this.refreshSettingVisibility();
  }

  private renderPersistenceSettings(containerEl: HTMLElement): void {
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
  }

  private renderLayoutSettings(containerEl: HTMLElement): void {
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
  }

  private renderInferenceSettings(containerEl: HTMLElement): void {
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
  }

  private renderCommandUiSettings(containerEl: HTMLElement): void {
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
  }

  private renderBettiSettings(containerEl: HTMLElement): void {
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
  }

  private renderEmergentSettings(containerEl: HTMLElement): void {
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

    // Store reference to emergent settings div for visibility toggling
    (this as unknown as Record<string, HTMLElement>)['_emergentSettingsDiv'] = emergentSettingsDiv;
  }

  private renderLegacySettings(containerEl: HTMLElement): void {
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
