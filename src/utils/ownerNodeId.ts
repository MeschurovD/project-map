import { stripExtension } from "./path.js";

export type OwnerKind = "component" | "hook";

// Hooks are required by convention to be named use*; any other call owner is
// treated as a component unless facts prove otherwise.
export function inferOwnerKind(owner: string): OwnerKind {
  return /^use[A-Z0-9]/.test(owner) ? "hook" : "component";
}

// Single source of truth for owner node ids: the value-flow analyzers stamp
// these ids into facts at scan time and the graph builder must produce the
// same ids for the UI to join facts with nodes.
export function ownerNodeId(owner: string, file: string, kind?: OwnerKind): string | undefined {
  if (!owner || owner === "<module>" || owner === "<anonymous>") return undefined;
  return `${kind ?? inferOwnerKind(owner)}:${stripExtension(file)}#${owner}`;
}
