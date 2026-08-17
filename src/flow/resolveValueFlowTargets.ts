import type { ProjectMapGraph, ProjectMapNode } from "../graph/types.js";
import type { ProjectFact } from "../scanner/facts.js";

type TargetFact = Extract<ProjectFact, { type: "localVariableUsage" | "hookReturnUsage" }>;

/**
 * Replace analyzer placeholders with canonical graph node ids when topology
 * proves the target. Ambiguous same-named components intentionally stay
 * unresolved.
 */
export function resolveValueFlowTargets(
  facts: ProjectFact[],
  graph: ProjectMapGraph
): ProjectFact[] {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const componentsByName = groupComponentsByName(graph.nodes);

  return facts.map((fact) => {
    if (!isTargetFact(fact) || !fact.targetName || !isComponentUsage(fact)) return fact;
    if (fact.targetNodeId && nodesById.get(fact.targetNodeId)?.type === "component") return fact;

    const target = resolveRenderedTarget(fact, graph, nodesById) ??
      uniqueComponent(componentsByName.get(fact.targetName));
    return target ? { ...fact, targetNodeId: target.id } : fact;
  });
}

function resolveRenderedTarget(
  fact: TargetFact,
  graph: ProjectMapGraph,
  nodesById: Map<string, ProjectMapNode>
): ProjectMapNode | undefined {
  if (!fact.ownerNodeId) return undefined;

  const candidates = graph.edges.flatMap((edge) => {
    if (edge.type !== "renders" || edge.from !== fact.ownerNodeId) return [];
    const target = nodesById.get(edge.to);
    return target?.type === "component" && target.name === fact.targetName ? [target] : [];
  });
  return uniqueComponent(candidates);
}

function groupComponentsByName(nodes: ProjectMapNode[]): Map<string, ProjectMapNode[]> {
  const grouped = new Map<string, ProjectMapNode[]>();
  for (const node of nodes) {
    if (node.type !== "component") continue;
    const current = grouped.get(node.name) ?? [];
    current.push(node);
    grouped.set(node.name, current);
  }
  return grouped;
}

function uniqueComponent(nodes: ProjectMapNode[] | undefined): ProjectMapNode | undefined {
  return nodes?.length === 1 ? nodes[0] : undefined;
}

function isTargetFact(fact: ProjectFact): fact is TargetFact {
  return fact.type === "localVariableUsage" || fact.type === "hookReturnUsage";
}

function isComponentUsage(fact: TargetFact): boolean {
  return fact.usageKind === "conditionalRender" ||
    fact.usageKind === "prop" ||
    fact.usageKind === "eventHandler";
}
