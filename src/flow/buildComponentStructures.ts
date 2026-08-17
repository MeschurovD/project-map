import type { ProjectMapGraph, ProjectMapNode } from "../graph/types.js";
import type { ProjectFact } from "../scanner/facts.js";
import type { ComponentStructure, JsxOccurrence } from "./types.js";

type JsxOccurrenceFact = Extract<ProjectFact, { type: "jsxOccurrence" }>;

export function buildComponentStructures(
  graph: ProjectMapGraph,
  facts: ProjectFact[]
): ComponentStructure[] {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const structures = new Map<string, ComponentStructure>();

  for (const fact of facts) {
    if (fact.type !== "jsxOccurrence") continue;
    const owner = resolveOwner(graph, fact);
    if (!owner) continue;

    const structure = structures.get(owner.id) ?? {
      componentNodeId: owner.id,
      componentName: owner.name,
      file: fact.sourceFile,
      occurrences: [],
    };
    structure.occurrences.push(toOccurrence(graph, nodesById, owner, fact));
    structures.set(owner.id, structure);
  }

  return [...structures.values()]
    .map((structure) => ({
      ...structure,
      occurrences: structure.occurrences.sort(bySourcePosition),
    }))
    .sort((left, right) => left.componentNodeId.localeCompare(right.componentNodeId));
}

function resolveOwner(graph: ProjectMapGraph, fact: JsxOccurrenceFact): ProjectMapNode | undefined {
  const candidates = graph.nodes.filter((node) =>
    node.type === "component" &&
    node.name === fact.ownerComponent &&
    node.file === fact.sourceFile
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

function toOccurrence(
  graph: ProjectMapGraph,
  nodesById: Map<string, ProjectMapNode>,
  owner: ProjectMapNode,
  fact: JsxOccurrenceFact
): JsxOccurrence {
  const target = fact.kind === "component"
    ? resolveTarget(graph, nodesById, owner.id, fact.tagName)
    : undefined;

  return {
    id: fact.occurrenceId,
    ...(fact.parentOccurrenceId ? { parentId: fact.parentOccurrenceId } : {}),
    kind: fact.kind,
    name: fact.tagName,
    ...(target ? { targetNodeId: target.id } : {}),
    ...(fact.slotName ? { slotName: fact.slotName } : {}),
    returnIndex: fact.returnIndex,
    evidence: {
      file: fact.sourceFile,
      line: fact.location.line,
      column: fact.location.column,
      code: fact.code,
    },
  };
}

function resolveTarget(
  graph: ProjectMapGraph,
  nodesById: Map<string, ProjectMapNode>,
  ownerId: string,
  name: string
): ProjectMapNode | undefined {
  const candidates = graph.edges.flatMap((edge) => {
    if (edge.from !== ownerId || edge.type !== "renders") return [];
    const target = nodesById.get(edge.to);
    return target?.type === "component" && target.name === name ? [target] : [];
  });
  const unique = [...new Map(candidates.map((node) => [node.id, node])).values()];
  return unique.length === 1 ? unique[0] : undefined;
}

function bySourcePosition(left: JsxOccurrence, right: JsxOccurrence): number {
  return (left.evidence.line ?? 0) - (right.evidence.line ?? 0) ||
    (left.evidence.column ?? 0) - (right.evidence.column ?? 0) ||
    left.id.localeCompare(right.id);
}
