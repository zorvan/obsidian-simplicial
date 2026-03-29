import type { NoteProfile } from "../types";

export function passesDiversityConstraint(nodes: NoteProfile[], dim: number): boolean {
  const roles = new Set(nodes.map((n) => n.role));
  const domains = new Set(nodes.map((n) => n.domain));

  if (dim === 1) {
    return roles.size >= 2 || domains.size >= 2;
  }

  if (dim === 2) {
    return domains.size >= 2 && roles.size >= 2;
  }

  return true;
}
