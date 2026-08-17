import type {
  SymbolContractOriginEdge,
  SymbolContractStep,
} from "../../flow/queries.js";
import type { SymbolOverviewValue, SymbolValueRole } from "../../flow/buildSymbolOverview.js";
import type { T } from "./i18n.js";

export type SymbolPipelineNodeType =
  | "API"
  | "THUNK"
  | "ACTION"
  | "STATE"
  | "SELECTOR"
  | "HOOK"
  | "PROP"
  | "COMPONENT"
  | "VALUE"
  | "COMPUTED"
  | "FUNCTION"
  | "BOUNDARY"
  | "GAP";

export type SymbolPipelineNode = {
  id: string;
  type: SymbolPipelineNodeType;
  name: string;
  fullName: string;
  source?:
    | { kind: "api-call"; flowNodeId: string }
    | { kind: "lifecycle-handler"; flowNodeId: string }
    | { kind: "state-write"; flowNodeId: string }
    | { kind: "selector-definition"; flowNodeId: string; graphNodeId?: string }
    | { kind: "flow-context"; flowNodeId: string }
    | { kind: "transformation"; flowNodeId: string }
    | { kind: "graph-node-context"; graphNodeId: string }
    | { kind: "thunk-call"; thunkNodeId: string; fallbackFlowNodeId: string };
};

export type SymbolOriginStateBranch = {
  state: SymbolPipelineNode;
  selectors: SymbolPipelineNode[];
  valueOrigin?: NonNullable<SymbolContractOriginEdge["stateWrite"]>["valueOrigin"];
};

export type SymbolOriginLifecycle = {
  id: string;
  action: SymbolPipelineNode;
  apis: SymbolPipelineNode[];
  stateBranches: SymbolOriginStateBranch[];
};

export type SymbolOriginOperation = {
  id: string;
  thunk: SymbolPipelineNode;
  apis: SymbolPipelineNode[];
  lifecycles: SymbolOriginLifecycle[];
};

export type SymbolOriginTopology = {
  operations: SymbolOriginOperation[];
  unassigned: SymbolPipelineNode[];
};

export function symbolStepLabel(step: SymbolContractStep, t: T): string {
  if (step.kind === "ui-effect" && step.uiEffect) {
    const target = step.uiEffect.targetName ?? step.ownerName;
    const template = step.uiEffect.kind === "conditional-render"
      ? t.symbolEffectControlsRender
      : t.symbolEffectRendersValue;
    return target ? template.replace("{target}", target) : template.replace(" {target}", "");
  }
  return step.path ?? step.name;
}

/** UI-only projection: keep canonical flow kinds intact and make their role scannable. */
export function symbolPipelineNodes(step: SymbolContractStep): SymbolPipelineNode[] {
  const fullName = step.path ?? step.name;
  if (step.kind === "async-operation") {
    const actionName = shortActionName(step.name);
    const thunkFullName = withoutLifecycle(fullName);
    return [
      pipelineNode(
        `${step.id}:thunk`,
        "THUNK",
        shortThunkName(thunkFullName),
        thunkFullName,
        step.ownerNodeId
          ? { kind: "thunk-call", thunkNodeId: step.ownerNodeId, fallbackFlowNodeId: step.id }
          : flowContextSource(step.id)
      ),
      pipelineNode(step.id, "ACTION", actionName, fullName, {
        kind: "lifecycle-handler",
        flowNodeId: step.id,
      }),
    ];
  }

  if (step.kind === "api") {
    const apiFullName = /^[A-Z]+\s+\S+/.test(step.name) ? step.name : fullName;
    return [pipelineNode(step.id, "API", shortApiName(apiFullName), apiFullName, {
      kind: "api-call",
      flowNodeId: step.id,
    })];
  }
  if (step.kind === "state-field") {
    return [pipelineNode(step.id, "STATE", fullName.replace(/^state\./, ""), fullName, {
      kind: "state-write",
      flowNodeId: step.id,
    })];
  }
  if (step.kind === "selector-result") {
    return [pipelineNode(step.id, "SELECTOR", step.name, fullName, {
      kind: "selector-definition",
      flowNodeId: step.id,
      ...(step.ownerNodeId ? { graphNodeId: step.ownerNodeId } : {}),
    })];
  }
  if (step.kind === "hook-input" || step.kind === "hook-return") {
    return [pipelineNode(step.id, "HOOK", step.ownerName ?? ownerPart(step.name), fullName, flowContextSource(step.id))];
  }
  if (step.kind === "prop") {
    return [pipelineNode(step.id, "PROP", step.path ?? lastPart(step.name), fullName, flowContextSource(step.id))];
  }
  if (step.kind === "ui-effect") {
    return [pipelineNode(step.id, "COMPONENT", step.ownerName ?? step.name, fullName, flowContextSource(step.id))];
  }
  if (step.kind === "component-value") {
    return [pipelineNode(step.id, "VALUE", step.path ?? lastPart(step.name), fullName, flowContextSource(step.id))];
  }
  if (step.kind === "boundary") {
    return [pipelineNode(step.id, "BOUNDARY", step.path ?? step.name, fullName, flowContextSource(step.id))];
  }
  if (step.kind === "gap") {
    return [pipelineNode(step.id, "GAP", step.name, fullName, flowContextSource(step.id))];
  }
  return [pipelineNode(step.id, "FUNCTION", step.name, fullName, flowContextSource(step.id))];
}

export function symbolOwnerPipelineNode(
  symbolId: string,
  symbolType: "hook" | "component" | string,
  symbolName: string
): SymbolPipelineNode {
  return pipelineNode(
    `${symbolId}:pipeline-owner`,
    symbolType === "hook" ? "HOOK" : "COMPONENT",
    symbolName,
    symbolName,
    { kind: "graph-node-context", graphNodeId: symbolId }
  );
}

export function symbolValuePipelineNode(value: Pick<SymbolOverviewValue, "id" | "name" | "role"> & {
  flowNodeId?: string;
}) {
  return pipelineNode(
    `${value.id}:pipeline-value`,
    computedValueRole(value.role) ? "COMPUTED" : "VALUE",
    value.name,
    value.name,
    value.flowNodeId
      ? computedValueRole(value.role)
        ? { kind: "transformation", flowNodeId: value.flowNodeId }
        : flowContextSource(value.flowNodeId)
      : undefined
  );
}

export function uniquePipelineNodes(nodes: SymbolPipelineNode[]): SymbolPipelineNode[] {
  return nodes.filter((node, index) => {
    const previous = nodes[index - 1];
    return !previous || previous.type !== node.type || previous.fullName !== node.fullName;
  });
}

/**
 * Restore parallel operation/lifecycle branches from canonical origin edges.
 * This intentionally models a DAG instead of inventing a linear order.
 */
export function symbolOriginTopology(
  steps: SymbolContractStep[],
  edges: SymbolContractOriginEdge[],
  options?: { targetName?: string }
): SymbolOriginTopology {
  const stepById = new Map(steps.map((step) => [step.id, step]));
  const incoming = groupOriginEdges(edges, "to");
  const outgoing = groupOriginEdges(edges, "from");
  const assigned = new Set<string>();
  const operations = new Map<string, SymbolOriginOperation>();

  for (const operationStep of steps.filter((step) => step.kind === "async-operation")) {
    const [thunk, action] = symbolPipelineNodes(operationStep);
    if (!thunk || !action) continue;
    const operationId = operationStep.ownerNodeId ?? withoutLifecycle(operationStep.path ?? operationStep.name);
    const current = operations.get(operationId) ?? {
      id: operationId,
      thunk,
      apis: [],
      lifecycles: [],
    };

    const apiSteps = (incoming.get(operationStep.id) ?? [])
      .flatMap((edge) => stepById.get(edge.from) ?? [])
      .filter((step) => step.kind === "api");
    const stateEdges = (outgoing.get(operationStep.id) ?? [])
      .filter((edge) => stepById.get(edge.to)?.kind === "state-field");
    const stateBranches = stateEdges.map((edge) => {
      const stateStep = stepById.get(edge.to)!;
      const selectorSteps = reachableSelectors(stateStep.id, stepById, outgoing);
      assigned.add(stateStep.id);
      selectorSteps.forEach((selector) => assigned.add(selector.id));
      return {
        state: symbolPipelineNodes(stateStep)[0]!,
        selectors: uniqueNodesById(selectorSteps.flatMap(symbolPipelineNodes)),
        ...(edge.stateWrite?.valueOrigin ? { valueOrigin: edge.stateWrite.valueOrigin } : {}),
      };
    });

    assigned.add(operationStep.id);
    apiSteps.forEach((api) => assigned.add(api.id));
    current.apis = uniqueNodesById([
      ...current.apis,
      ...apiSteps.flatMap(symbolPipelineNodes),
    ]);
    current.lifecycles.push({
      id: operationStep.id,
      action,
      apis: uniqueNodesById(apiSteps.flatMap(symbolPipelineNodes)).sort(byPipelineName),
      stateBranches,
    });
    operations.set(operationId, current);
  }

  const orderedOperations = [...operations.values()]
    .map((operation) => normalizeOperationLifecycles({
      ...operation,
      apis: [...operation.apis].sort(byPipelineName),
      lifecycles: [...operation.lifecycles].sort(compareLifecycle),
    }, options?.targetName))
    .sort((left, right) => byPipelineName(left.thunk, right.thunk));
  const unassigned = uniqueNodesById(
    steps.filter((step) => !assigned.has(step.id)).flatMap(symbolPipelineNodes)
  );
  return { operations: orderedOperations, unassigned };
}

function normalizeOperationLifecycles(
  operation: SymbolOriginOperation,
  targetName?: string
): SymbolOriginOperation {
  if (!targetName || isLifecycleValue(targetName)) return operation;

  const domainLifecycles = operation.lifecycles.map((lifecycle) => ({
    ...lifecycle,
    stateBranches: lifecycle.stateBranches.filter((branch) => !isLifecycleValue(branch.state.fullName)),
  }));
  const branchesByState = new Map<string, Array<{
    lifecycle: SymbolOriginLifecycle;
    branch: SymbolOriginStateBranch;
  }>>();
  for (const lifecycle of domainLifecycles) {
    for (const branch of lifecycle.stateBranches) {
      const branches = branchesByState.get(branch.state.fullName) ?? [];
      branches.push({ lifecycle, branch });
      branchesByState.set(branch.state.fullName, branches);
    }
  }

  const preferredBranches = new Set<SymbolOriginStateBranch>();
  for (const candidates of branchesByState.values()) {
    if (candidates.length === 1) {
      preferredBranches.add(candidates[0]!.branch);
      continue;
    }
    const preferred = [...candidates].sort((left, right) =>
      stateBranchRank(right.lifecycle, right.branch) - stateBranchRank(left.lifecycle, left.branch)
    )[0];
    if (preferred) preferredBranches.add(preferred.branch);
  }

  return {
    ...operation,
    lifecycles: domainLifecycles
      .map((lifecycle) => ({
        ...lifecycle,
        stateBranches: lifecycle.stateBranches.filter((branch) => preferredBranches.has(branch)),
      }))
      .filter((lifecycle) => lifecycle.apis.length > 0 || lifecycle.stateBranches.length > 0),
  };
}

function stateBranchRank(
  lifecycle: SymbolOriginLifecycle,
  branch: SymbolOriginStateBranch
): number {
  const valueOriginRank = {
    payload: 60,
    derived: 50,
    literal: 20,
    unknown: 10,
    reset: 0,
  }[branch.valueOrigin ?? "unknown"];
  const actionRank = lifecycle.action.name.endsWith(".fulfilled")
    ? 30
    : lifecycle.action.name.endsWith(".rejected")
      ? 10
      : 0;
  return valueOriginRank + actionRank + (lifecycle.apis.length > 0 ? 15 : 0);
}

function isLifecycleValue(name: string): boolean {
  return /(?:loading|pending|error|status|fetching|submitting|saving|deleting|processing)/i.test(name);
}

function pipelineNode(
  id: string,
  type: SymbolPipelineNodeType,
  name: string,
  fullName: string,
  source?: SymbolPipelineNode["source"]
): SymbolPipelineNode {
  return { id, type, name: name || fullName, fullName, ...(source ? { source } : {}) };
}

function flowContextSource(flowNodeId: string): NonNullable<SymbolPipelineNode["source"]> {
  return { kind: "flow-context", flowNodeId };
}

function groupOriginEdges(
  edges: SymbolContractOriginEdge[],
  endpoint: "from" | "to"
): Map<string, SymbolContractOriginEdge[]> {
  const grouped = new Map<string, SymbolContractOriginEdge[]>();
  for (const edge of edges) {
    grouped.set(edge[endpoint], [...(grouped.get(edge[endpoint]) ?? []), edge]);
  }
  return grouped;
}

function reachableSelectors(
  startId: string,
  stepById: Map<string, SymbolContractStep>,
  outgoing: Map<string, SymbolContractOriginEdge[]>
): SymbolContractStep[] {
  const selectors: SymbolContractStep[] = [];
  const visited = new Set<string>();
  const queue = [...(outgoing.get(startId) ?? []).map((edge) => edge.to)];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const step = stepById.get(id);
    if (!step || step.kind !== "selector-result") continue;
    selectors.push(step);
    queue.push(...(outgoing.get(id) ?? []).map((edge) => edge.to));
  }
  return selectors.sort((left, right) => left.name.localeCompare(right.name));
}

function uniqueNodesById(nodes: SymbolPipelineNode[]) {
  return [...new Map(nodes.map((node) => [node.id, node])).values()];
}

function byPipelineName(left: SymbolPipelineNode, right: SymbolPipelineNode) {
  return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
}

function compareLifecycle(left: SymbolOriginLifecycle, right: SymbolOriginLifecycle) {
  return lifecycleRank(left.action.name) - lifecycleRank(right.action.name) ||
    left.action.name.localeCompare(right.action.name);
}

function lifecycleRank(name: string) {
  if (name.endsWith(".pending")) return 0;
  if (name.endsWith(".fulfilled")) return 1;
  if (name.endsWith(".rejected")) return 2;
  return 3;
}

function computedValueRole(role: SymbolValueRole) {
  return role === "derived" || role === "combined" || role === "constant";
}

function withoutLifecycle(value: string) {
  return value.replace(/\.(?:pending|fulfilled|rejected)$/, "");
}

function shortThunkName(value: string) {
  return lastPart(value);
}

function shortActionName(value: string) {
  const lifecycle = value.match(/\.(pending|fulfilled|rejected)$/)?.[1];
  const owner = lastPart(withoutLifecycle(value));
  return lifecycle ? `${owner}.${lifecycle}` : owner;
}

function shortApiName(value: string) {
  if (value.includes("/") || /^https?:/i.test(value)) return value;
  const parts = value.split(".").filter(Boolean);
  return parts.length > 2 ? parts.slice(-2).join(".") : value;
}

function ownerPart(value: string) {
  return value.split(".")[0] ?? value;
}

function lastPart(value: string) {
  const slashPart = value.split("/").at(-1) ?? value;
  return slashPart.split(".").at(-1) ?? slashPart;
}
