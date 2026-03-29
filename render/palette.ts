import { djb2Hash } from "../core/hash";
import { SimplicialModel } from "../core/model";
import type { ColorKey, Simplex } from "../core/types";

const SIMPLEX_COLORS: Record<ColorKey | "default-purple" | "default-teal" | "default-coral", [number, number, number]> = {
  purple: [127, 119, 221],
  teal: [29, 158, 117],
  coral: [216, 90, 48],
  pink: [208, 98, 156],
  blue: [76, 125, 212],
  amber: [214, 151, 52],
  neutral: [136, 135, 128],
  "default-purple": [127, 119, 221],
  "default-teal": [29, 158, 117],
  "default-coral": [216, 90, 48],
};

function inferredColor(simplex: Simplex): [number, number, number] {
  const signals = simplex.inferredSignals ?? [];
  if (signals.includes("soft-cluster")) return SIMPLEX_COLORS.teal;
  if (signals.some((signal) => signal.startsWith("tags:"))) return SIMPLEX_COLORS.amber;
  if (signals.some((signal) => signal === "folder:same" || signal === "folder:top")) return SIMPLEX_COLORS.pink;
  if (signals.some((signal) => signal.startsWith("title:") || signal.startsWith("content:"))) return SIMPLEX_COLORS.coral;
  if (signals.some((signal) => signal.startsWith("link:"))) return SIMPLEX_COLORS.blue;
  return SIMPLEX_COLORS.neutral;
}

function colorForOrder(order: number): [number, number, number] {
  const orderedPalette: Array<[number, number, number]> = [
    SIMPLEX_COLORS.blue,
    SIMPLEX_COLORS.teal,
    SIMPLEX_COLORS.coral,
    SIMPLEX_COLORS.pink,
    SIMPLEX_COLORS.amber,
    SIMPLEX_COLORS.purple,
  ];
  return orderedPalette[(Math.max(2, order) - 2) % orderedPalette.length];
}

function variantSeed(simplex: Simplex): string {
  return `${simplex.nodes.join("|")}|${simplex.label ?? ""}|${simplex.sourcePath ?? ""}`;
}

function varyColor(base: [number, number, number], simplex: Simplex): [number, number, number] {
  const hash = djb2Hash(variantSeed(simplex));
  const factor = 0.82 + (hash % 29) / 100;
  return base.map((channel) => Math.max(0, Math.min(255, Math.round(channel * factor)))) as [number, number, number];
}

function colorForOrderedSimplex(simplex: Simplex): [number, number, number] {
  const order = Math.max(2, simplex.nodes.length);
  const family: Array<[number, number, number]> = [
    SIMPLEX_COLORS.blue,
    SIMPLEX_COLORS.teal,
    SIMPLEX_COLORS.coral,
    SIMPLEX_COLORS.pink,
    SIMPLEX_COLORS.amber,
    SIMPLEX_COLORS.purple,
  ];
  const hash = djb2Hash(variantSeed(simplex));
  const familyOffset = (order - 2) % family.length;
  const colorIndex = (familyOffset + (hash % family.length)) % family.length;
  return varyColor(family[colorIndex], simplex);
}

export function colorForSimplex(simplex: Simplex): [number, number, number] {
  if (simplex.inferred) {
    const base = inferredColor(simplex);
    return simplex.nodes.length >= 3 ? colorForOrderedSimplex(simplex) : varyColor(base, simplex);
  }
  return colorForOrderedSimplex(simplex);
}

function isSubset(subset: string[], superset: string[]): boolean {
  return subset.every((node) => superset.includes(node));
}

function intrinsicColorForSimplex(simplex: Simplex): [number, number, number] {
  if (simplex.inferred) {
    const base = inferredColor(simplex);
    return simplex.nodes.length >= 3 ? colorForOrderedSimplex(simplex) : varyColor(base, simplex);
  }
  return colorForOrderedSimplex(simplex);
}

function inheritedColorSource(model: SimplicialModel, simplex: Simplex): Simplex | null {
  const containing = [...model.simplices.values()].filter((candidate) =>
    candidate.nodes.length > simplex.nodes.length && isSubset(simplex.nodes, candidate.nodes),
  );
  if (!containing.length) return null;

  const highest = containing
    .sort((a, b) => b.nodes.length - a.nodes.length || a.nodes.join("|").localeCompare(b.nodes.join("|")))[0];

  const leaksOutsideHighest = containing.some((candidate) => !isSubset(candidate.nodes, highest.nodes));
  return leaksOutsideHighest ? null : highest;
}

export function effectiveColorForSimplex(model: SimplicialModel | null, simplex: Simplex): [number, number, number] {
  if (!model) return intrinsicColorForSimplex(simplex);
  const source = inheritedColorSource(model, simplex);
  return intrinsicColorForSimplex(source ?? simplex);
}
