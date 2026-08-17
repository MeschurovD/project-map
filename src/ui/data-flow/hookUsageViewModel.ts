import type { ProjectMapNode } from "../../graph/types.js";
import type { Evidence } from "../../scanner/facts.js";
import type { HookReturnUsageFact } from "../../analyzers/value-flow/types.js";
import type { DataFlowUsage } from "./valueFlowTypes.js";

export function hookReturnUsagesToDataFlowUsages(
  usages: HookReturnUsageFact[],
  graph: { nodes: ProjectMapNode[] }
): DataFlowUsage[] {
  return usages.map((usage) => {
    const target = usage.targetNodeId
      ? graph.nodes.find((node) => node.id === usage.targetNodeId)
      : usage.targetName
        ? resolveTarget(graph.nodes, usage.targetName)
        : undefined;

    return {
      sourceName: usage.sourceField ?? usage.localName,
      sourceKind: "hookReturn",
      usageKind: usage.usageKind,
      targetName: usage.targetName,
      targetNodeId: usage.targetNodeId ?? target?.id,
      targetType: inferTargetType(usage, target),
      propName: usage.propName,
      evidence: evidenceFromUsage(usage),
      confidence: usage.confidence,
    };
  });
}

function inferTargetType(
  usage: HookReturnUsageFact,
  target: ProjectMapNode | undefined
): DataFlowUsage["targetType"] {
  if (target?.type === "hook") return "hook";
  if (target?.type === "action") return "action";
  if (target && ["component", "widget", "feature", "entity", "shared", "page"].includes(target.type)) return "component";
  if (usage.usageKind === "hookArgument") return "hook";
  if (usage.usageKind === "functionArgument") return "function";
  if (usage.usageKind === "actionArgument") return "action";
  if (usage.usageKind === "conditionalRender" && !usage.targetName) return "condition";
  if (usage.targetName && (usage.usageKind === "prop" || usage.usageKind === "eventHandler")) return "component";
  return "unknown";
}

function evidenceFromUsage(usage: HookReturnUsageFact): Evidence | undefined {
  const line = usage.location?.line ?? usage.location?.startLine;
  if (!line) return undefined;

  return {
    file: usage.location?.file ?? usage.file,
    line,
    column: usage.location?.column ?? 1,
    code: usage.code,
  };
}

function resolveTarget(nodes: ProjectMapNode[], targetName: string) {
  return nodes.find((node) =>
    node.name === targetName &&
    (node.type === "component" ||
      node.type === "feature" ||
      node.type === "widget" ||
      node.type === "entity" ||
      node.type === "hook" ||
      node.type === "action")
  );
}
