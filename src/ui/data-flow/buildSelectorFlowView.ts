import type { LocalVariableUsageKind, SelectorBindingFact } from "../../analyzers/value-flow/types.js";
import type { ProjectMapNode } from "../../graph/types.js";
import type { ProjectFact } from "../../scanner/facts.js";
import type { ViewGraph, ViewGraphEdge, ViewGraphNode } from "../graph-view/viewTypes.js";
import {
  localVariableUsageFacts,
  selectorBindingFacts,
  selectorStateReadFacts,
} from "./valueFlowTypes.js";

export function buildSelectorFlowView(
  graph: { nodes: ProjectMapNode[] },
  facts: ProjectFact[],
  selector: ProjectMapNode
): ViewGraph {
  const nodes: ViewGraphNode[] = [];
  const edges: ViewGraphEdge[] = [];
  const stateReads = selectorStateReadFacts(facts).filter((fact) => fact.selectorName === selector.name);
  const bindings = uniqueSelectorBindings(selectorBindingFacts(facts).filter((fact) => fact.selectorName === selector.name));
  const usages = localVariableUsageFacts(facts);

  const selectorNode = viewNode(selector.id, selector.name, "selector", { x: 320, y: 0 }, selector);
  nodes.push(selectorNode);

  const reads: Array<{ statePath?: string; derivedFromSelectors?: string[] }> =
    stateReads.length > 0 ? stateReads : [{ statePath: "unknown" }];

  reads.forEach((read, index) => {
    const input = selectorInputNode(read);
    const id = `value-flow:${selector.id}:input:${input.idPart}`;
    nodes.push(viewNode(id, input.label, input.nodeType, { x: 0, y: index * 120 }, undefined, input.summary, input.subtitle));
    edges.push(edge(id, selector.id, input.edgeLabel));
  });

  bindings.forEach((binding, bindingIndex) => {
    const localId = `value-flow:${selector.id}:local:${binding.owner}:${binding.localName}`;
    const y = bindingIndex * 170;
    nodes.push(viewNode(localId, binding.localName, "bound-value", { x: 620, y }, undefined, undefined, binding.owner));
    edges.push(edge(selector.id, localId, "binds to"));

    usages
      .filter((usage) => usage.owner === binding.owner && usage.variableName === binding.localName)
      .forEach((usage, usageIndex) => {
        const usageId = `value-flow:${selector.id}:usage:${binding.owner}:${binding.localName}:${usage.usageKind}:${usageIndex}`;
        const usageNode = usageNodeFor(usage.usageKind, usage.targetName, usage.propName);
        nodes.push(viewNode(usageId, usageNode.label, usageNode.nodeType, { x: 920, y: y + usageIndex * 110 }, undefined, undefined, usage.code));
        edges.push(edge(localId, usageId, usage.usageKind));

        if (usage.targetName && shouldShowTargetNode(usage.usageKind)) {
          const target = resolveTarget(graph.nodes, usage.targetName);
          const targetId = target?.id ?? `value-flow:${selector.id}:target:${usage.targetName}`;
          if (!nodes.some((node) => node.id === targetId)) {
            nodes.push(viewNode(targetId, usage.targetName, target?.type ?? usageNode.nodeType, { x: 1220, y: y + usageIndex * 110 }, target ?? undefined));
          }
          edges.push(edge(usageId, targetId, usage.propName ? `to ${usage.propName}` : "to"));
        }
      });
  });

  return { nodes, edges };
}

function viewNode(
  id: string,
  label: string,
  nodeType: string,
  position: { x: number; y: number },
  sourceNode?: ProjectMapNode,
  summaryBadges?: string[],
  subtitle?: string
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
    summaryBadges,
    subtitle,
    position,
  };
}

function edge(from: string, to: string, label: string): ViewGraphEdge {
  return {
    id: `value-flow-edge:${from}:${label}:${to}`,
    from,
    to,
    type: "view",
    label,
  };
}

function resolveTarget(nodes: ProjectMapNode[], targetName: string) {
  return nodes.find((node) =>
    node.name === targetName &&
    (node.type === "component" || node.type === "feature" || node.type === "widget" || node.type === "entity")
  ) ?? null;
}

function selectorInputNode(read: { statePath?: string; derivedFromSelectors?: string[] }) {
  const derived = read.derivedFromSelectors ?? [];
  if (derived.length > 0) {
    return {
      idPart: derived.join("+") || "derived",
      label: `Input selectors (${derived.length})`,
      nodeType: "input-selectors",
      edgeLabel: "derived from",
      summary: derived.slice(0, 4),
      subtitle: derived.length > 4 ? `+${derived.length - 4} more` : undefined,
    };
  }

  if (!read.statePath) {
    return {
      idPart: "derived-selector",
      label: "Derived selector",
      nodeType: "input-selectors",
      edgeLabel: "derived from",
      summary: undefined,
      subtitle: undefined,
    };
  }

  const statePath = read.statePath;
  return {
    idPart: statePath,
    label: statePath,
    nodeType: "state-field",
    edgeLabel: statePath === "unknown" ? "reads" : "reads state",
    summary: undefined,
    subtitle: undefined,
  };
}

function uniqueSelectorBindings(bindings: SelectorBindingFact[]) {
  const byBinding = new Map<string, SelectorBindingFact>();
  for (const binding of bindings) {
    const key = `${binding.owner}\0${binding.localName}`;
    if (!byBinding.has(key)) byBinding.set(key, binding);
  }
  return [...byBinding.values()];
}

function usageNodeFor(usageKind: LocalVariableUsageKind, targetName?: string, propName?: string) {
  if (usageKind === "conditionalRender") {
    return {
      label: targetName ? `Controls render: ${targetName}` : "Controls conditional render",
      nodeType: "ui-effect",
    };
  }
  if (usageKind === "ternaryCondition") {
    return {
      label: targetName ? `Chooses render: ${targetName}` : "Controls ternary render",
      nodeType: "ui-effect",
    };
  }
  if (usageKind === "prop") {
    return {
      label: targetName ? `Passed to ${targetName}.${propName ?? "prop"}` : `Passed as ${propName ?? "prop"}`,
      nodeType: "ui-effect",
    };
  }
  if (usageKind === "eventHandler") {
    return {
      label: targetName ? `Handles ${targetName}.${propName ?? "event"}` : `Handles ${propName ?? "event"}`,
      nodeType: "ui-effect",
    };
  }
  if (usageKind === "renderedExpression") return { label: "Rendered expression", nodeType: "ui-effect" };
  if (usageKind === "hookArgument") return { label: targetName ? `Passed to ${targetName}` : "Hook argument", nodeType: "hook" };
  if (usageKind === "actionArgument") return { label: targetName ? `Passed to ${targetName}` : "Action argument", nodeType: "action" };
  if (usageKind === "functionArgument") return { label: targetName ? `Passed to ${targetName}` : "Function argument", nodeType: "function" };
  return { label: usageKind, nodeType: "ui-effect" };
}

function shouldShowTargetNode(usageKind: LocalVariableUsageKind) {
  return usageKind === "hookArgument" || usageKind === "actionArgument" || usageKind === "functionArgument";
}
