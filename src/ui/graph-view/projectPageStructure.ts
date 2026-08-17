import type {
  PageStructure,
  PageStructureItem,
} from "./buildPageStructure.js";

export type PageStructureMode = "semantic" | "logic-data" | "exact";

/**
 * Project the evidence-preserving occurrence tree for a particular reading
 * intent. Exact mode returns the analyzer-facing AST structure unchanged;
 * semantic modes remove structural wrappers while preserving occurrences,
 * slots and hooks as explicit annotations.
 */
export function projectPageStructure(
  structure: PageStructure,
  mode: PageStructureMode
): PageStructure {
  if (mode === "exact" || !structure.root) return structure;

  return {
    ...structure,
    root: projectUnit(structure.root, mode),
  };
}

function projectUnit(item: PageStructureItem, mode: Exclude<PageStructureMode, "exact">) {
  const projected = projectChildren(item.children, mode);
  return {
    ...item,
    children: annotateRepeatedOccurrences(projected.children),
    ...(mode === "semantic" && projected.logicUnits.length > 0
      ? { logicUnits: uniqueLogicUnits(projected.logicUnits) }
      : { logicUnits: undefined }),
  };
}

function projectChildren(
  children: PageStructureItem[],
  mode: Exclude<PageStructureMode, "exact">
): {
  children: PageStructureItem[];
  logicUnits: NonNullable<PageStructureItem["logicUnits"]>;
} {
  const projectedChildren: PageStructureItem[] = [];
  const logicUnits: NonNullable<PageStructureItem["logicUnits"]> = [];

  for (const child of children) {
    if (child.kind === "unit") {
      if (mode === "semantic" && child.type === "hook" && child.unitId) {
        logicUnits.push(...collectHookUnits(child));
        continue;
      }
      projectedChildren.push(projectUnit(child, mode));
      continue;
    }

    const nested = projectChildren(child.children, mode);
    if (child.kind === "slot") {
      projectedChildren.push(...nested.children.map((nestedChild) => ({
        ...nestedChild,
        relationLabel: child.name,
      })));
    } else {
      projectedChildren.push(...nested.children);
    }
    logicUnits.push(...nested.logicUnits);
  }

  return { children: projectedChildren, logicUnits };
}

function collectHookUnits(item: PageStructureItem): NonNullable<PageStructureItem["logicUnits"]> {
  return item.unitId ? [{ id: item.id, unitId: item.unitId, name: item.name }] : [];
}

function uniqueLogicUnits(
  units: NonNullable<PageStructureItem["logicUnits"]>
): NonNullable<PageStructureItem["logicUnits"]> {
  const unique = new Map<string, (typeof units)[number]>();
  for (const unit of units) unique.set(unit.unitId, unit);
  return [...unique.values()];
}

function annotateRepeatedOccurrences(items: PageStructureItem[]): PageStructureItem[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.kind !== "unit" || !item.occurrenceId) continue;
    const key = item.unitId ?? item.name;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const positions = new Map<string, number>();
  return items.map((item) => {
    if (item.kind !== "unit" || !item.occurrenceId) return item;
    const key = item.unitId ?? item.name;
    const count = counts.get(key) ?? 1;
    if (count < 2) return item;
    const index = (positions.get(key) ?? 0) + 1;
    positions.set(key, index);
    return { ...item, occurrenceIndex: index, occurrenceCount: count };
  });
}
