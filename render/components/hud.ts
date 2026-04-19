import type { SimplicialModel } from "../../core/model";

export interface BettiNumbers {
  beta0: number;
  beta1: number;
  beta2: number;
}

export function drawBettiHUD(
  ctx: CanvasRenderingContext2D,
  model: SimplicialModel,
  isDark: boolean,
): void {
  const analysis = model.getAnalysisSummary();
  if (!analysis.betti) return;

  const { b0, b1, b2 } = analysis.betti;
  const text = `β₀ ${b0}   β₁ ${b1}${b2 !== undefined ? `   β₂ ${b2}` : ""}`;

  ctx.save();
  ctx.font = "500 14px ui-monospace, SFMono-Regular, Menlo, monospace";
  const textWidth = ctx.measureText(text).width;
  const padding = 10;
  const x = 14;
  const y = 14;
  const width = textWidth + padding * 2;
  const height = 26;

  // Background
  ctx.fillStyle = isDark
    ? "rgba(20, 24, 32, 0.85)"
    : "rgba(255, 255, 255, 0.85)";
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 8);
  ctx.fill();

  // Border
  ctx.strokeStyle = isDark
    ? "rgba(255, 255, 255, 0.15)"
    : "rgba(0, 0, 0, 0.1)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Text
  ctx.fillStyle = isDark
    ? "rgba(235, 240, 248, 0.9)"
    : "rgba(24, 28, 34, 0.85)";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + padding, y + height / 2);
  ctx.restore();
}
