import { Modal, Notice, Setting, TextAreaComponent, type App } from "obsidian";
import type { Simplex } from "../core/types";

export class CreateSimplexModal extends Modal {
  private nodesInput = "";
  private labelInput = "";
  private weightInput = 1;

  constructor(
    app: App,
    private initialNodes: string[],
    private persistenceLabel: string,
    private onSubmit: (simplex: Pick<Simplex, "nodes" | "label" | "weight">) => Promise<void>,
  ) {
    super(app);
    this.nodesInput = initialNodes.join(", ");
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Create simplex" });
    contentEl.createEl("p", {
      text: `Review the proposed nodes, then save to ${this.persistenceLabel}. Use commas, spaces, or new lines to separate nodes.`
    });

    let textArea: TextAreaComponent | null = null;

    new Setting(contentEl)
      .setName("Nodes")
      .setDesc("These will be resolved as notes when possible; unknown values become virtual nodes.")
      .addTextArea((text) => {
        textArea = text;
        text.setValue(this.nodesInput);
        text.inputEl.rows = 6;
        text.onChange((value) => {
          this.nodesInput = value;
        });
      });

    new Setting(contentEl)
      .setName("Label")
      .addText((text) => {
        text.setPlaceholder("unnamed");
        text.onChange((value) => {
          this.labelInput = value;
        });
      });

    new Setting(contentEl)
      .setName("Weight")
      .setDesc("0.1 to 1.0")
      .addSlider((slider) => {
        slider.setLimits(0.1, 1, 0.1);
        slider.setValue(this.weightInput);
        slider.onChange((value) => {
          this.weightInput = value;
        });
      });

    new Setting(contentEl)
      .addButton((button) => {
        button.setButtonText("Create");
        button.setCta();
        button.onClick(async () => {
          const nodes = this.parseNodes(this.nodesInput);
          if (nodes.length < 2) {
            new Notice("A simplex needs at least two nodes.");
            textArea?.inputEl.focus();
            return;
          }
          await this.onSubmit({
            nodes,
            label: this.labelInput.trim() || undefined,
            weight: this.weightInput,
          });
          this.close();
        });
      })
      .addExtraButton((button) => {
        button.setIcon("cross");
        button.setTooltip("Cancel");
        button.onClick(() => this.close());
      });

    window.setTimeout(() => {
      const input = contentEl.querySelector("textarea");
      if (input instanceof HTMLTextAreaElement) input.focus();
    }, 0);
  }

  private parseNodes(value: string): string[] {
    return value
      .split(/[\n,\s]+/g)
      .map((part) => part.trim())
      .filter(Boolean)
      .filter((node, index, all) => all.indexOf(node) === index);
  }
}
