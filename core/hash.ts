import type { ColorKey } from "./types";

export function djb2Hash(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
    h = h >>> 0;
  }
  return h;
}

export function hashLabel(label: string | undefined): ColorKey {
  const palette: ColorKey[] = ["purple", "teal", "coral", "pink", "blue", "amber"];
  if (!label) return "purple";
  return palette[djb2Hash(label) % palette.length];
}
