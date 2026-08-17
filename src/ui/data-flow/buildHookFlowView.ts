import type { EdgeType, ProjectMapEdge, ProjectMapGraph, ProjectMapNode } from "../../graph/types.js";
import type { ProjectFact } from "../../scanner/facts.js";
import type { HookReturnUsageFact } from "../../analyzers/value-flow/types.js";
import type { ViewGraph, ViewGraphEdge, ViewGraphNode } from "../graph-view/viewTypes.js";
import { usageNodeFor } from "./usageNode.js";
import {
  hookDeclarationShapeFacts,
  hookReturnDependencyFacts,
  hookReturnUsageFacts,
  selectorBindingFacts,
} from "./valueFlowTypes.js";

// Hook data-flow, left to right: what the hook reads internally (selectors,
// actions, api) → the hook → each value it returns → where that value goes in
// consumers (a prop / render condition / handler). The internal→return link
// (which return is computed from which read) is not extracted from the hook
// body, so it is intentionally left unconnected — an honest gap, not a guess.

const COL_DEP = 0;
const COL_HOOK = 360;
const COL_RETURN = 720;
const COL_USAGE = 1080;
const ROW_STEP = 132;

const INTERNAL_EDGE_LABEL: Partial<Record<EdgeType, string>> = {
  usesSelector: "uses selector",
  readsSlice: "reads slice",
  dispatchesAction: "dispatches",
  callsApi: "calls api",
};

export function buildHookFlowView(graph: ProjectMapGraph, facts: ProjectFact[], hook: ProjectMapNode): ViewGraph {
  const nodes: ViewGraphNode[] = [];
  const edges: ViewGraphEdge[] = [];
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const usages = hookReturnUsageFacts(facts).filter((fact) => fact.hookName === hook.name);

  // Right side: returned values (declared order first, then any extra seen in
  // usages), each claiming one row per usage so nothing overlaps.
  const returnFields = collectReturnFields(facts, hook.name, usages);
  let row = 0;
  for (const field of returnFields) {
    const returnId = `hook-flow:${hook.id}:return:${field}`;
    const y = row * ROW_STEP;
    nodes.push(viewNode(returnId, field, "bound-value", { x: COL_RETURN, y }));
    edges.push(edge(hook.id, returnId, "returns"));

    const fieldUsages = dedupeUsages(usages.filter((usage) => (usage.sourceField ?? usage.localName) === field));
    fieldUsages.forEach((usage, index) => {
      const node = usageNodeFor(usage.usageKind, usage.targetName, usage.propName);
      const usageId = `hook-flow:${hook.id}:usage:${field}:${index}`;
      nodes.push(viewNode(usageId, node.label, node.nodeType, { x: COL_USAGE, y: (row + index) * ROW_STEP }));
      edges.push(edge(returnId, usageId, usage.usageKind));
    });
    row += Math.max(1, fieldUsages.length);
  }
  const returnsBottom = Math.max(0, row - 1) * ROW_STEP;

  // Left side: the hook's own internal reads/dispatches/calls, from the graph.
  let depRow = 0;
  const depIdByTargetName = new Map<string, string>();
  for (const dep of graph.edges) {
    if (dep.from !== hook.id) continue;
    const label = INTERNAL_EDGE_LABEL[dep.type];
    const target = nodesById.get(dep.to);
    if (!label || !target) continue;
    const depId = `hook-flow:${hook.id}:dep:${target.id}`;
    nodes.push(viewNode(depId, target.name, target.type, { x: COL_DEP, y: depRow * ROW_STEP }, target));
    edges.push(edge(depId, hook.id, label, dep));
    depIdByTargetName.set(target.name, depId);
    depRow += 1;
  }
  const depsBottom = Math.max(0, depRow - 1) * ROW_STEP;

  // The hook card sits between the two stacks, vertically centred.
  nodes.push(viewNode(hook.id, hook.name, "hook", { x: COL_HOOK, y: Math.max(returnsBottom, depsBottom) / 2 }, hook));

  // Link each return to the internal selector it's computed from (point 4): a
  // return field depends on locals; a local bound to a selector gives the source.
  linkReturnsToSources(facts, hook, returnFields, depIdByTargetName, edges);

  return { nodes, edges };
}

// return field --(dependsOn local)--> selectorBinding(local -> selector) --> dep node.
// Drawn dashed-ish via a distinct label so it reads as a derived/heuristic link.
function linkReturnsToSources(
  facts: ProjectFact[],
  hook: ProjectMapNode,
  returnFields: string[],
  depIdByTargetName: Map<string, string>,
  edges: ViewGraphEdge[]
): void {
  const selectorByLocal = new Map<string, string>();
  for (const binding of selectorBindingFacts(facts).filter((fact) => fact.owner === hook.name)) {
    selectorByLocal.set(binding.localName, binding.selectorName);
  }
  if (selectorByLocal.size === 0) return;

  const fieldSet = new Set(returnFields);
  for (const dependency of hookReturnDependencyFacts(facts).filter((fact) => fact.hookName === hook.name)) {
    if (!fieldSet.has(dependency.field)) continue;
    const returnId = `hook-flow:${hook.id}:return:${dependency.field}`;
    const seen = new Set<string>();
    for (const local of dependency.dependsOn) {
      const selectorName = selectorByLocal.get(local);
      const depId = selectorName ? depIdByTargetName.get(selectorName) : undefined;
      if (!depId || seen.has(depId)) continue;
      seen.add(depId);
      edges.push(edge(depId, returnId, "feeds"));
    }
  }
}

function collectReturnFields(facts: ProjectFact[], hookName: string, usages: HookReturnUsageFact[]): string[] {
  const fields: string[] = [];
  const seen = new Set<string>();
  const add = (name: string) => {
    if (name && !seen.has(name)) {
      seen.add(name);
      fields.push(name);
    }
  };

  for (const declaration of hookDeclarationShapeFacts(facts).filter((fact) => fact.hookName === hookName)) {
    for (const field of declaration.returnShape?.fields ?? []) add(field);
  }
  for (const usage of usages) add(usage.sourceField ?? usage.localName);
  return fields;
}

// One hook is used in many components; collapse usages that land on the same
// place (same kind/target/prop) so the graph shows distinct destinations.
function dedupeUsages(usages: HookReturnUsageFact[]): HookReturnUsageFact[] {
  const byKey = new Map<string, HookReturnUsageFact>();
  for (const usage of usages) {
    const key = `${usage.usageKind}\0${usage.targetName ?? ""}\0${usage.propName ?? ""}`;
    if (!byKey.has(key)) byKey.set(key, usage);
  }
  return [...byKey.values()];
}

function viewNode(
  id: string,
  label: string,
  nodeType: string,
  position: { x: number; y: number },
  sourceNode?: ProjectMapNode
): ViewGraphNode {
  return {
    id,
    kind: "semantic-card",
    sourceNode,
    label,
    nodeType,
    file: sourceNode?.file,
    fsdLayer: sourceNode?.fsd?.layer,
    fsdSlice: sourceNode?.fsd?.slice,
    position,
  };
}

function edge(from: string, to: string, label: string, sourceEdge?: ProjectMapEdge): ViewGraphEdge {
  return {
    id: `hook-flow-edge:${from}:${label}:${to}`,
    from,
    to,
    type: "view",
    sourceEdge,
    label,
  };
}
