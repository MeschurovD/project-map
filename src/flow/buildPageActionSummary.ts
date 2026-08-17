import type { Confidence, ProjectMapEdge, ProjectMapNode } from "../graph/types.js";
import type { FlowEdge, FlowEvidence, FlowNode, ValueFlow } from "./types.js";

export type PageActionReference = {
  id: string;
  name: string;
  type: ProjectMapNode["type"] | FlowNode["kind"];
  file?: string;
  confidence?: Confidence;
  evidence: FlowEvidence[];
  context?: "page" | "project";
};

export type PageActionStateChange = PageActionReference & {
  exact: boolean;
  lifecycle?: string;
  valueOrigin?: NonNullable<FlowEdge["stateWrite"]>["valueOrigin"];
};

export type PageActionAffectedValue = {
  flowId: string;
  nodeId: string;
  name: string;
  path?: string;
};

export type PageActionIssue = {
  id: string;
  reasonCode: string;
  message: string;
};

export type PageActionOperation = {
  operation: PageActionReference;
  initiators: PageActionReference[];
  apiCalls: PageActionReference[];
  stateChanges: PageActionStateChange[];
  uiOutcomes: PageActionReference[];
  affectedValues: PageActionAffectedValue[];
  issues: PageActionIssue[];
  detailLevel: "value-proven" | "topology-only";
};

export type PageActionSummary = {
  pageId: string;
  operations: PageActionOperation[];
  stats: {
    operationsCount: number;
    initiatorsCount: number;
    apiCallsCount: number;
    exactStateChangesCount: number;
    uiOutcomesCount: number;
    issuesCount: number;
  };
};

export type PageActionFlowDetail = {
  flow: ValueFlow;
  subject: FlowNode;
  nodes: FlowNode[];
  edges: FlowEdge[];
  gaps: FlowNode[];
};

export type BuildPageActionSummaryInput = {
  pageId: string;
  topologyNodes: ProjectMapNode[];
  topologyEdges: ProjectMapEdge[];
  /** Full graph is used only for proven direct call-sites omitted by page scope. */
  projectNodes?: ProjectMapNode[];
  projectEdges?: ProjectMapEdge[];
  flowDetails: PageActionFlowDetail[];
};

const OPERATION_TYPES = new Set<ProjectMapNode["type"]>(["action", "thunk", "api"]);
const INITIATOR_EDGE_TYPES = new Set<ProjectMapEdge["type"]>(["dispatchesAction", "callsApi"]);

/** Build the proven operation → API/state/UI projection for one page. */
export function buildPageActionSummary(input: BuildPageActionSummaryInput): PageActionSummary {
  const topologyNodeById = new Map(input.topologyNodes.map((node) => [node.id, node]));
  const projectNodes = input.projectNodes ?? input.topologyNodes;
  const projectEdges = input.projectEdges ?? input.topologyEdges;
  const projectNodeById = new Map(projectNodes.map((node) => [node.id, node]));
  const pageNodeIds = new Set(input.topologyNodes.map((node) => node.id));
  const flowNodes = uniqueFlowNodes(input.flowDetails.flatMap((detail) => detail.nodes));
  const flowEdges = uniqueFlowEdges(input.flowDetails.flatMap((detail) => detail.edges));
  const flowNodeById = new Map(flowNodes.map((node) => [node.id, node]));
  const operations = input.topologyNodes
    .filter((node) => OPERATION_TYPES.has(node.type))
    .map((operation) => buildOperation({
      operation,
      topologyNodeById,
      topologyEdges: input.topologyEdges,
      projectNodeById,
      projectEdges,
      pageNodeIds,
      flowNodes,
      flowNodeById,
      flowEdges,
      flowDetails: input.flowDetails,
    }))
    .sort(compareOperations);

  return {
    pageId: input.pageId,
    operations,
    stats: {
      operationsCount: operations.length,
      initiatorsCount: uniqueReferences(operations.flatMap((operation) => operation.initiators)).length,
      apiCallsCount: uniqueReferences(operations.flatMap((operation) => operation.apiCalls)).length,
      exactStateChangesCount: uniqueReferences(operations.flatMap((operation) =>
        operation.stateChanges.filter((change) => change.exact)
      )).length,
      uiOutcomesCount: uniqueReferences(operations.flatMap((operation) => operation.uiOutcomes)).length,
      issuesCount: new Set(operations.flatMap((operation) => operation.issues.map((issue) => issue.id))).size,
    },
  };
}

function buildOperation(input: {
  operation: ProjectMapNode;
  topologyNodeById: Map<string, ProjectMapNode>;
  topologyEdges: ProjectMapEdge[];
  projectNodeById: Map<string, ProjectMapNode>;
  projectEdges: ProjectMapEdge[];
  pageNodeIds: Set<string>;
  flowNodes: FlowNode[];
  flowNodeById: Map<string, FlowNode>;
  flowEdges: FlowEdge[];
  flowDetails: PageActionFlowDetail[];
}): PageActionOperation {
  const { operation } = input;
  const initiatorEdges = input.projectEdges.filter((edge) =>
    edge.to === operation.id && INITIATOR_EDGE_TYPES.has(edge.type)
  );
  const initiators = initiatorEdges.flatMap((edge) => {
    const node = input.projectNodeById.get(edge.from);
    return node ? [{
      ...graphReference(node, edge),
      context: input.pageNodeIds.has(node.id) ? "page" as const : "project" as const,
    }] : [];
  });
  const operationFlowNodes = input.flowNodes.filter((node) =>
    node.kind === "async-operation" && node.ownerNodeId === operation.id
  );
  const operationFlowNodeIds = new Set(operationFlowNodes.map((node) => node.id));
  const apiFlowNodes = input.flowEdges
    .filter((edge) => operationFlowNodeIds.has(edge.to))
    .flatMap((edge) => input.flowNodeById.get(edge.from) ?? [])
    .filter((node) => node.kind === "api");
  const topologyApiNodes = input.projectEdges
    .filter((edge) => edge.from === operation.id && edge.type === "callsApi")
    .flatMap((edge) => input.projectNodeById.get(edge.to) ?? []);
  const apiCalls = uniqueReferences([
    ...(operation.type === "api" ? [graphReference(operation, initiatorEdges[0])] : []),
    ...apiFlowNodes.map((node) => flowReference(node)),
    ...topologyApiNodes.map((node) => graphReference(
      node,
      input.projectEdges.find((edge) => edge.from === operation.id && edge.to === node.id)
    )),
  ]);

  const exactWrites = input.flowEdges.filter((edge) =>
    operationFlowNodeIds.has(edge.from) && edge.relation === "writes"
  );
  const exactStateChanges = exactWrites.flatMap((edge): PageActionStateChange[] => {
    const node = input.flowNodeById.get(edge.to);
    if (!node || node.kind !== "state-field") return [];
    return [{
      ...flowReference(node, edge),
      exact: true,
      lifecycle: edge.stateWrite?.lifecycle,
      valueOrigin: edge.stateWrite?.valueOrigin,
    }];
  });
  const synchronousStateChanges = operation.type === "action"
    ? actionStateChanges(operation, input.topologyNodeById, input.flowNodes)
    : [];
  const provenStateChanges = uniqueStateChanges([...exactStateChanges, ...synchronousStateChanges]);
  const exactOwnerIds = new Set(exactStateChanges.flatMap((change) => {
    const node = input.flowNodeById.get(change.id);
    return node?.ownerNodeId ? [node.ownerNodeId] : [];
  }));
  if (synchronousStateChanges.length > 0) {
    const sliceName = typeof operation.meta?.sliceName === "string" ? operation.meta.sliceName : undefined;
    const slice = sliceName
      ? [...input.topologyNodeById.values()].find((node) => node.type === "slice-model" && node.name === sliceName)
      : undefined;
    if (slice) exactOwnerIds.add(slice.id);
  }
  const fallbackStateChanges = input.topologyEdges
    .filter((edge) => edge.from === operation.id && edge.type === "writesSlice")
    .flatMap((edge): PageActionStateChange[] => {
      const node = input.topologyNodeById.get(edge.to);
      if (!node || exactOwnerIds.has(node.id)) return [];
      return [{ ...graphReference(node, edge), exact: false }];
    });
  const stateChanges = uniqueStateChanges([...provenStateChanges, ...fallbackStateChanges]);

  const relevantSeedIds = new Set([
    ...operationFlowNodes.map((node) => node.id),
    ...apiFlowNodes.map((node) => node.id),
    ...provenStateChanges.map((change) => change.id),
  ]);
  const downstreamIds = traverseDownstream([...relevantSeedIds], input.flowEdges);
  const uiOutcomes = uniqueReferences(input.flowNodes
    .filter((node) => downstreamIds.has(node.id) && (node.kind === "prop" || node.kind === "ui-effect"))
    .map((node) => flowReference(node)));
  const relevantDetails = input.flowDetails.filter((detail) =>
    detail.nodes.some((node) => relevantSeedIds.has(node.id))
  );
  const affectedValues = [...new Map(relevantDetails.map((detail) => [detail.flow.id, {
    flowId: detail.flow.id,
    nodeId: detail.subject.id,
    name: detail.subject.name,
    path: detail.subject.path,
  }])).values()].sort((left, right) => (left.path ?? left.name).localeCompare(right.path ?? right.name));
  const issues = [...new Map(relevantDetails.flatMap((detail) => detail.gaps).map((gap) => [gap.id, {
    id: gap.id,
    reasonCode: gap.gap?.reasonCode ?? "unknown",
    message: gap.gap?.message ?? gap.name,
  }])).values()];
  const operationEvidence = mergeEvidence(
    initiatorEdges.flatMap((edge) => edge.evidence),
    operationFlowNodes.flatMap((node) => node.evidence)
  );

  return {
    operation: {
      id: operation.id,
      name: operation.name,
      type: operation.type,
      file: operation.file,
      confidence: initiatorEdges[0]?.confidence,
      evidence: operationEvidence,
    },
    initiators: uniqueReferences(initiators),
    apiCalls,
    stateChanges,
    uiOutcomes,
    affectedValues,
    issues,
    detailLevel: apiFlowNodes.length > 0 || provenStateChanges.length > 0 || uiOutcomes.length > 0
      ? "value-proven"
      : "topology-only",
  };
}

function actionStateChanges(
  operation: ProjectMapNode,
  topologyNodeById: Map<string, ProjectMapNode>,
  flowNodes: FlowNode[]
): PageActionStateChange[] {
  const sliceName = typeof operation.meta?.sliceName === "string" ? operation.meta.sliceName : undefined;
  const writes = Array.isArray(operation.meta?.writes) ? operation.meta.writes : [];
  if (!sliceName || writes.length === 0) return [];

  const slice = [...topologyNodeById.values()].find((node) =>
    node.type === "slice-model" && node.name === sliceName
  );

  return writes.flatMap((candidate): PageActionStateChange[] => {
    if (!isActionWrite(candidate)) return [];
    const evidence: FlowEvidence[] = [{
      file: operation.file ?? "",
      line: candidate.location.line,
      column: candidate.location.column,
      code: candidate.code,
    }];
    const stateNode = flowNodes.find((node) =>
      node.kind === "state-field" &&
      (!slice || node.ownerNodeId === slice.id) &&
      pathEndsWith(node.path ?? node.name, candidate.statePath)
    );

    if (stateNode) {
      return [{
        ...flowReference({ ...stateNode, evidence: mergeEvidence(stateNode.evidence, evidence) }),
        exact: true,
        valueOrigin: candidate.valueOrigin,
      }];
    }

    return [{
      id: `state-field:${slice?.id ?? sliceName}#${candidate.statePath}`,
      name: `state.${sliceName}.${candidate.statePath}`,
      type: "state-field",
      confidence: "high",
      evidence,
      exact: true,
      valueOrigin: candidate.valueOrigin,
    }];
  });
}

function isActionWrite(value: unknown): value is {
  statePath: string;
  valueOrigin: NonNullable<FlowEdge["stateWrite"]>["valueOrigin"];
  location: { line: number; column: number };
  code: string;
} {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  const location = candidate.location as Record<string, unknown> | undefined;
  return typeof candidate.statePath === "string" &&
    typeof candidate.valueOrigin === "string" &&
    typeof candidate.code === "string" &&
    typeof location?.line === "number" &&
    typeof location.column === "number";
}

function pathEndsWith(path: string, suffix: string): boolean {
  const pathParts = path.split(".");
  const suffixParts = suffix.split(".");
  return suffixParts.every((part, index) => part === pathParts[pathParts.length - suffixParts.length + index]);
}

function graphReference(node: ProjectMapNode, edge?: ProjectMapEdge): PageActionReference {
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    file: node.file,
    confidence: edge?.confidence,
    evidence: edge?.evidence ?? [],
  };
}

function flowReference(node: FlowNode, edge?: FlowEdge): PageActionReference {
  return {
    id: node.id,
    name: node.name,
    type: node.kind,
    confidence: edge?.confidence ?? node.confidence,
    evidence: mergeEvidence(node.evidence, edge?.evidence ?? []),
  };
}

function traverseDownstream(seedIds: string[], edges: FlowEdge[]) {
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
  const visited = new Set(seedIds);
  const queue = [...seedIds];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of outgoing.get(current) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push(next);
    }
  }
  return visited;
}

function uniqueFlowNodes(nodes: FlowNode[]) {
  return [...new Map(nodes.map((node) => [node.id, node])).values()];
}

function uniqueFlowEdges(edges: FlowEdge[]) {
  return [...new Map(edges.map((edge) => [edge.id, edge])).values()];
}

function uniqueReferences<T extends PageActionReference>(references: T[]): T[] {
  return [...new Map(references.map((reference) => [reference.id, reference])).values()]
    .sort((left, right) => left.name.localeCompare(right.name));
}

function uniqueStateChanges(changes: PageActionStateChange[]) {
  return [...new Map(changes.map((change) => [change.id, change])).values()]
    .sort((left, right) => left.name.localeCompare(right.name));
}

function mergeEvidence(...groups: FlowEvidence[][]) {
  return [...new Map(groups.flat().map((entry) => [
    `${entry.file}\0${entry.line ?? ""}\0${entry.column ?? ""}\0${entry.code ?? ""}`,
    entry,
  ])).values()];
}

function compareOperations(left: PageActionOperation, right: PageActionOperation) {
  return Number(right.initiators.length > 0) - Number(left.initiators.length > 0) ||
    operationTypeOrder(left.operation.type) - operationTypeOrder(right.operation.type) ||
    left.operation.name.localeCompare(right.operation.name);
}

function operationTypeOrder(type: PageActionReference["type"]) {
  return type === "action" ? 0 : type === "thunk" ? 1 : type === "api" ? 2 : 3;
}
