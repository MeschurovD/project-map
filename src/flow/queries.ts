import type { ProjectMapEdge, ProjectMapGraph, ProjectMapNode } from "../graph/types.js";
import { buildPageScope } from "./buildPageScope.js";
import {
  buildAnalysisIssueSummary,
  type AnalysisIssueSummary,
} from "./buildAnalysisIssueSummary.js";
import { buildPageActionSummary, type PageActionSummary } from "./buildPageActionSummary.js";
import {
  buildPageImpactSummary,
  pageImpactSeedIds,
  type PageImpactSummary,
} from "./buildPageImpactSummary.js";
import { buildPageQualitySummary, type PageQualitySummary } from "./buildPageQualitySummary.js";
import { buildPageSummary, type PageSummary } from "./buildPageSummary.js";
import { buildValueJourney, type ValueJourney } from "./buildValueJourney.js";
import {
  buildSymbolOverview,
  type SymbolOverview,
} from "./buildSymbolOverview.js";
import type {
  ComponentStructure,
  FlowEdge,
  FlowCoverage,
  FlowEvidence,
  FlowIndex,
  FlowNode,
  FlowUiEffect,
  FlowValueSemantics,
  PageScopeWarning,
  ValueFlow,
} from "./types.js";

export type FlowSummary = {
  id: string;
  subjectNodeId: string;
  subjectName: string;
  subjectKind: FlowNode["kind"];
  subjectPath?: string;
  completeness: ValueFlow["completeness"];
  coverage: FlowCoverage;
  nodeCount: number;
  edgeCount: number;
  gapCount: number;
  sourceNodeIds: string[];
  consumerNodeIds: string[];
};

export type ValueFlowDetail = {
  flow: ValueFlow;
  subject: FlowNode;
  nodes: FlowNode[];
  edges: FlowEdge[];
  sources: FlowNode[];
  consumers: FlowNode[];
  gaps: FlowNode[];
};

export type FlowImpact = {
  targetId: string;
  seedNodeIds: string[];
  flowIds: string[];
  // "proven" fields cover only nodes/edges reachable through medium/high edges;
  // "possible" fields cover targets reachable only across a low/unknown edge.
  nodeIds: string[];
  possibleNodeIds: string[];
  edgeIds: string[];
  possibleEdgeIds: string[];
  terminalNodeIds: string[];
  affectedOwnerNodeIds: string[];
  possibleAffectedOwnerNodeIds: string[];
  affectedPageIds: string[];
  possibleAffectedPageIds: string[];
  nodes: FlowNode[];
  edges: FlowEdge[];
  possibleNodes: FlowNode[];
  possibleEdges: FlowEdge[];
};

export type PageOverview = {
  pageId: string;
  primaryComponentId?: string;
  warnings: PageScopeWarning[];
  topologyNodes: ProjectMapNode[];
  topologyEdges: ProjectMapEdge[];
  flows: FlowSummary[];
  stats: {
    topologyNodesCount: number;
    topologyEdgesCount: number;
    flowsCount: number;
    completeFlowsCount: number;
    partialFlowsCount: number;
    gapsCount: number;
    originResolvedFlowsCount: number;
    originGapFlowsCount: number;
    originUnknownFlowsCount: number;
    continuationResolvedFlowsCount: number;
  };
};

export type SymbolContractValueGroup = "inputs" | "reads" | "results" | "ui-effects";

export type SymbolContractStep = {
  id: string;
  kind: FlowNode["kind"];
  name: string;
  path?: string;
  ownerNodeId?: string;
  ownerName?: string;
  distance?: number;
  relation?: FlowEdge["relation"];
  flowId?: string;
  uiEffect?: FlowUiEffect;
};

export type SymbolContractOriginEdge = Pick<
  FlowEdge,
  "id" | "from" | "to" | "relation" | "confidence" | "stateWrite"
>;

export type SymbolContractValue = {
  id: string;
  flowId: string;
  flowNodeId: string;
  name: string;
  kind: FlowNode["kind"];
  path?: string;
  group: SymbolContractValueGroup;
  coverage: FlowCoverage;
  confidence: FlowNode["confidence"];
  valueSemantics?: FlowValueSemantics;
  origin: SymbolContractStep[];
  originEdges: SymbolContractOriginEdge[];
  derivationInputs: SymbolContractStep[];
  consumers: SymbolContractStep[];
  directConsumers: SymbolContractStep[];
  downstreamConsumers: SymbolContractStep[];
  issues: Array<{ id: string; reasonCode: string; message: string }>;
};

export type SymbolContractReference = {
  id: string;
  name: string;
  type: ProjectMapNode["type"];
  relation: ProjectMapEdge["type"];
  confidence: ProjectMapEdge["confidence"];
};

/** Question-oriented projection for a standalone component/hook inspector. */
export type SymbolContract = {
  symbol: {
    id: string;
    name: string;
    type: ProjectMapNode["type"];
    file?: string;
    layer?: string;
    slice?: string;
  };
  usedBy: SymbolContractReference[];
  stats: {
    inputsCount: number;
    readsCount: number;
    derivationsCount: number;
    resultsCount: number;
    uiEffectsCount: number;
    effectsCount: number;
    consumersCount: number;
    issueCount: number;
  };
  groups: Array<{ key: SymbolContractValueGroup; values: SymbolContractValue[] }>;
  effects: SymbolContractReference[];
};

export type FlowQueries = {
  listPageFlows(pageId: string): FlowSummary[];
  getValueFlow(flowId: string): ValueFlowDetail | null;
  getValueJourney(flowId: string): ValueJourney | null;
  getImpact(nodeOrFlowNodeId: string): FlowImpact | null;
  getPageOverview(pageId: string): PageOverview | null;
  getPageSummary(pageId: string): PageSummary | null;
  getPageIssues(pageId: string): AnalysisIssueSummary | null;
  getPageActions(pageId: string): PageActionSummary | null;
  getPageImpact(pageId: string): PageImpactSummary | null;
  getPageQuality(pageId: string): PageQualitySummary | null;
  getSymbolContract(pageId: string, symbolId: string): SymbolContract | null;
  getSymbolOverview(pageId: string, symbolId: string): SymbolOverview | null;
  getComponentStructure(componentId: string): ComponentStructure | null;
  getEvidence(flowNodeOrEdgeId: string): FlowEvidence[];
};

export type CreateFlowQueriesInput = {
  graph: ProjectMapGraph;
  flowIndex: FlowIndex;
};

/** Build read-only, UI-independent product queries over canonical artifacts. */
export function createFlowQueries(input: CreateFlowQueriesInput): FlowQueries {
  const { graph, flowIndex } = input;
  const flowById = new Map(flowIndex.flows.map((flow) => [flow.id, flow]));
  const nodeById = new Map(flowIndex.nodes.map((node) => [node.id, node]));
  const edgeById = new Map(flowIndex.edges.map((edge) => [edge.id, edge]));
  const graphNodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const graphEdgeById = new Map(graph.edges.map((edge) => [edge.id, edge]));
  const componentStructureById = new Map(
    (flowIndex.componentStructures ?? []).map((structure) => [structure.componentNodeId, structure])
  );
  const outgoing = groupOutgoing(flowIndex.edges);
  const pageScopeCache = new Map<string, ReturnType<typeof buildPageScope>>();

  function pageScope(pageId: string) {
    if (pageScopeCache.has(pageId)) return pageScopeCache.get(pageId) ?? null;
    const scope = buildPageScope({ graph, flowIndex, pageId });
    pageScopeCache.set(pageId, scope);
    return scope;
  }

  function getValueFlow(flowId: string): ValueFlowDetail | null {
    const flow = flowById.get(flowId);
    if (!flow) return null;
    const nodes = flow.nodeIds.flatMap((id) => nodeById.get(id) ?? []);
    const edges = flow.edgeIds.flatMap((id) => edgeById.get(id) ?? []);
    const roles = terminalRoles(nodes, edges);
    const subject = nodeById.get(flow.subjectNodeId);
    if (!subject) return null;

    return {
      flow,
      subject,
      nodes,
      edges,
      sources: roles.sourceNodeIds.flatMap((id) => nodeById.get(id) ?? []),
      consumers: roles.consumerNodeIds.flatMap((id) => nodeById.get(id) ?? []),
      gaps: nodes.filter((node) => node.kind === "gap"),
    };
  }

  function summaryOf(flowId: string): FlowSummary | null {
    const detail = getValueFlow(flowId);
    if (!detail) return null;
    return {
      id: detail.flow.id,
      subjectNodeId: detail.flow.subjectNodeId,
      subjectName: detail.subject.name,
      subjectKind: detail.subject.kind,
      subjectPath: detail.subject.path,
      completeness: detail.flow.completeness,
      coverage: detail.flow.coverage,
      nodeCount: detail.nodes.length,
      edgeCount: detail.edges.length,
      gapCount: detail.gaps.length,
      sourceNodeIds: detail.sources.map((node) => node.id),
      consumerNodeIds: detail.consumers.map((node) => node.id),
    };
  }

  function getValueJourney(flowId: string): ValueJourney | null {
    const detail = getValueFlow(flowId);
    return detail ? buildValueJourney(detail) : null;
  }

  function listPageFlows(pageId: string): FlowSummary[] {
    const scope = pageScope(pageId);
    if (!scope) return [];
    return scope.flowIds.flatMap((id) => summaryOf(id) ?? []).sort(bySubjectThenId);
  }

  function getPageOverview(pageId: string): PageOverview | null {
    const scope = pageScope(pageId);
    if (!scope) return null;
    const flows = listPageFlows(pageId);
    return {
      pageId,
      primaryComponentId: scope.primaryComponentId,
      warnings: scope.warnings,
      topologyNodes: scope.topologyNodeIds.flatMap((id) => graphNodeById.get(id) ?? []),
      topologyEdges: scope.topologyEdgeIds.flatMap((id) => graphEdgeById.get(id) ?? []),
      flows,
      stats: {
        topologyNodesCount: scope.stats.topologyNodesCount,
        topologyEdgesCount: scope.stats.topologyEdgesCount,
        flowsCount: flows.length,
        completeFlowsCount: flows.filter((flow) => flow.completeness === "complete").length,
        partialFlowsCount: flows.filter((flow) => flow.completeness === "partial").length,
        gapsCount: scope.stats.gapsCount,
        originResolvedFlowsCount: flows.filter((flow) =>
          flow.coverage.origin === "proven" || flow.coverage.origin === "boundary"
        ).length,
        originGapFlowsCount: flows.filter((flow) => flow.coverage.origin === "gap").length,
        originUnknownFlowsCount: flows.filter((flow) => flow.coverage.origin === "unknown").length,
        continuationResolvedFlowsCount: flows.filter((flow) =>
          flow.coverage.continuation === "proven"
        ).length,
      },
    };
  }

  function getImpact(targetId: string): FlowImpact | null {
    const directNode = nodeById.get(targetId);
    const directFlow = flowById.get(targetId);
    const seedNodeIds = directNode
      ? [directNode.id]
      : directFlow
        ? [directFlow.subjectNodeId]
        : flowIndex.nodes.filter((node) => node.ownerNodeId === targetId).map((node) => node.id);
    if (seedNodeIds.length === 0) return null;

    // Proven traversal only follows medium/high edges, so low/unknown guesses
    // (e.g. the slice-write fan-out) never enter the proven answer.
    const provenNodeIds = new Set(seedNodeIds);
    const provenEdgeIds = new Set<string>();
    const provenQueue = [...seedNodeIds];
    while (provenQueue.length > 0) {
      const current = provenQueue.shift()!;
      for (const edge of outgoing.get(current) ?? []) {
        if (!isProvenEdge(edge)) continue;
        provenEdgeIds.add(edge.id);
        if (provenNodeIds.has(edge.to)) continue;
        provenNodeIds.add(edge.to);
        provenQueue.push(edge.to);
      }
    }

    // Full traversal follows every edge; the possible sets are what it reaches
    // beyond the proven closure (reachable only across a low/unknown edge).
    const reachableNodeIds = new Set(seedNodeIds);
    const reachableEdgeIds = new Set<string>();
    const reachableQueue = [...seedNodeIds];
    while (reachableQueue.length > 0) {
      const current = reachableQueue.shift()!;
      for (const edge of outgoing.get(current) ?? []) {
        reachableEdgeIds.add(edge.id);
        if (reachableNodeIds.has(edge.to)) continue;
        reachableNodeIds.add(edge.to);
        reachableQueue.push(edge.to);
      }
    }

    const nodes = [...provenNodeIds].sort().flatMap((id) => nodeById.get(id) ?? []);
    const edges = [...provenEdgeIds].sort().flatMap((id) => edgeById.get(id) ?? []);
    const possibleNodes = [...reachableNodeIds]
      .filter((id) => !provenNodeIds.has(id))
      .sort()
      .flatMap((id) => nodeById.get(id) ?? []);
    const possibleEdges = [...reachableEdgeIds]
      .filter((id) => !provenEdgeIds.has(id))
      .sort()
      .flatMap((id) => edgeById.get(id) ?? []);
    const terminalNodeIds = terminalRoles(nodes, edges).consumerNodeIds;
    const flowIds = flowIndex.flows
      .filter((flow) => seedNodeIds.some((id) => flow.nodeIds.includes(id)))
      .map((flow) => flow.id)
      .sort();

    const affectedOwnerNodeIds = [...new Set(nodes.flatMap((node) => node.ownerNodeId ?? []))].sort();
    const affectedOwners = new Set(affectedOwnerNodeIds);
    const affectedPageIds = graph.nodes
      .filter((node) => node.type === "page")
      .filter((page) => pageScope(page.id)?.topologyNodeIds.some((id) => affectedOwners.has(id)))
      .map((page) => page.id)
      .sort();
    const provenPages = new Set(affectedPageIds);

    const possibleAffectedOwnerNodeIds = [...new Set(possibleNodes.flatMap((node) => node.ownerNodeId ?? []))]
      .filter((id) => !affectedOwners.has(id))
      .sort();
    const possibleOwners = new Set(possibleAffectedOwnerNodeIds);
    const possibleAffectedPageIds = graph.nodes
      .filter((node) => node.type === "page")
      .filter((page) => !provenPages.has(page.id))
      .filter((page) => pageScope(page.id)?.topologyNodeIds.some((id) => possibleOwners.has(id)))
      .map((page) => page.id)
      .sort();

    return {
      targetId,
      seedNodeIds: [...seedNodeIds].sort(),
      flowIds,
      nodeIds: nodes.map((node) => node.id),
      possibleNodeIds: possibleNodes.map((node) => node.id),
      edgeIds: edges.map((edge) => edge.id),
      possibleEdgeIds: possibleEdges.map((edge) => edge.id),
      terminalNodeIds,
      affectedOwnerNodeIds,
      possibleAffectedOwnerNodeIds,
      affectedPageIds,
      possibleAffectedPageIds,
      nodes,
      edges,
      possibleNodes,
      possibleEdges,
    };
  }

  function getPageSummary(pageId: string): PageSummary | null {
    const overview = getPageOverview(pageId);
    if (!overview) return null;
    return buildPageSummary({
      overview,
      flowDetails: overview.flows.flatMap((flow) => getValueFlow(flow.id) ?? []),
    });
  }

  function getPageIssues(pageId: string): AnalysisIssueSummary | null {
    const overview = getPageOverview(pageId);
    if (!overview) return null;
    return buildAnalysisIssueSummary({
      pageId,
      topologyNodes: overview.topologyNodes,
      flowDetails: overview.flows.flatMap((flow) => getValueFlow(flow.id) ?? []),
    });
  }

  function getPageActions(pageId: string): PageActionSummary | null {
    const overview = getPageOverview(pageId);
    if (!overview) return null;
    return buildPageActionSummary({
      pageId,
      topologyNodes: overview.topologyNodes,
      topologyEdges: overview.topologyEdges,
      projectNodes: graph.nodes,
      projectEdges: graph.edges,
      flowDetails: overview.flows.flatMap((flow) => getValueFlow(flow.id) ?? []),
    });
  }

  function getPageImpact(pageId: string): PageImpactSummary | null {
    const overview = getPageOverview(pageId);
    if (!overview) return null;
    const flowDetails = overview.flows.flatMap((flow) => getValueFlow(flow.id) ?? []);
    const impactsBySeedId = new Map(pageImpactSeedIds(flowDetails).flatMap((seedId) => {
      const impact = getImpact(seedId);
      return impact ? [[seedId, impact] as const] : [];
    }));
    return buildPageImpactSummary({
      pageId,
      graphNodes: graph.nodes,
      flowDetails,
      impactsBySeedId,
    });
  }

  function getPageQuality(pageId: string): PageQualitySummary | null {
    const overview = getPageOverview(pageId);
    if (!overview) return null;
    const flowDetails = overview.flows.flatMap((flow) => getValueFlow(flow.id) ?? []);
    const issues = buildAnalysisIssueSummary({
      pageId,
      topologyNodes: overview.topologyNodes,
      flowDetails,
    });
    return buildPageQualitySummary({ pageId, flowDetails, issues });
  }

  function getSymbolContract(pageId: string, symbolId: string): SymbolContract | null {
    const symbol = graphNodeById.get(symbolId);
    const scope = pageScope(pageId);
    if (!symbol || !scope?.topologyNodeIds.includes(symbolId)) return null;

    const valuesByNodeId = new Map<string, { value: SymbolContractValue; priority: number }>();
    const relevantIssueIds = new Set<string>();

    for (const summary of listPageFlows(pageId)) {
      const detail = getValueFlow(summary.id);
      if (!detail) continue;

      for (const node of detail.nodes) {
        if (node.ownerNodeId !== symbolId || !isContractValue(node)) continue;

        for (const gap of detail.gaps) relevantIssueIds.add(gap.id);

        const consumerLayers = contractConsumerLayers(
          detail,
          node.id,
          node.ownerNodeId,
          graphNodeById
        );
        const originGraph = contractOriginGraph(detail, node.id, graphNodeById);
        const value: SymbolContractValue = {
          id: `${detail.flow.id}:${node.id}`,
          flowId: detail.flow.id,
          flowNodeId: node.id,
          name: displayContractName(node),
          kind: node.kind,
          path: node.path,
          group: contractGroupFor(node),
          coverage: detail.flow.coverage,
          confidence: node.confidence,
          valueSemantics: node.valueSemantics,
          origin: originGraph.nodes,
          originEdges: originGraph.edges,
          derivationInputs: contractDerivationInputs(detail, node.id, graphNodeById),
          consumers: contractConsumers(detail, node.id, graphNodeById),
          directConsumers: consumerLayers.direct,
          downstreamConsumers: consumerLayers.downstream,
          issues: detail.gaps.map((gap) => ({
            id: gap.id,
            reasonCode: gap.gap?.reasonCode ?? "unknown",
            message: gap.gap?.message ?? gap.name,
          })),
        };
        const priority =
          (detail.subject.id === node.id ? 100 : 0) +
          value.consumers.length * 10 +
          contractOriginPriority(detail.flow.coverage);
        const current = valuesByNodeId.get(node.id);
        if (!current) {
          valuesByNodeId.set(node.id, { value, priority });
        } else {
          const preferred = priority > current.priority ? value : current.value;
          const additional = preferred === value ? current.value : value;
          valuesByNodeId.set(node.id, {
            value: mergeContractValues(preferred, additional),
            priority: Math.max(priority, current.priority),
          });
        }
      }
    }

    const values = [...valuesByNodeId.values()].map((entry) => entry.value);
    const scopeNodeIds = new Set(scope.topologyNodeIds);
    const usedBy = contractReferences(
      graph.edges.filter((edge) =>
        edge.to === symbolId &&
        scopeNodeIds.has(edge.from) &&
        (edge.type === "usesHook" || edge.type === "renders")
      ),
      "from",
      graphNodeById
    );
    const effects = contractReferences(
      graph.edges.filter((edge) =>
        edge.from === symbolId && (edge.type === "dispatchesAction" || edge.type === "callsApi")
      ),
      "to",
      graphNodeById
    );
    const consumerIds = new Set(values.flatMap((value) => value.consumers
      .filter((consumer) => consumer.ownerNodeId !== symbolId)
      .map((consumer) => consumer.id)));
    const derivationIds = new Set(values
      .filter((value) => value.derivationInputs.length > 0)
      .map((value) => value.flowNodeId));
    const groupOrder: SymbolContractValueGroup[] = ["inputs", "reads", "results", "ui-effects"];

    return {
      symbol: {
        id: symbol.id,
        name: symbol.name,
        type: symbol.type,
        file: symbol.file,
        layer: symbol.fsd?.layer,
        slice: symbol.fsd?.slice ?? undefined,
      },
      usedBy,
      stats: {
        inputsCount: values.filter((value) => value.group === "inputs").length,
        readsCount: values.filter((value) => value.group === "reads").length,
        derivationsCount: derivationIds.size,
        resultsCount: values.filter((value) => value.group === "results").length,
        uiEffectsCount: values.filter((value) => value.group === "ui-effects").length,
        effectsCount: effects.length,
        consumersCount: consumerIds.size,
        issueCount: relevantIssueIds.size,
      },
      groups: groupOrder.flatMap((key) => {
        const groupValues = values
          .filter((value) => value.group === key)
          .sort((left, right) => left.name.localeCompare(right.name));
        return groupValues.length > 0 ? [{ key, values: groupValues }] : [];
      }),
      effects,
    };
  }

  function getEvidence(id: string): FlowEvidence[] {
    return mergeEvidence(nodeById.get(id)?.evidence ?? [], edgeById.get(id)?.evidence ?? []);
  }

  function getSymbolOverview(pageId: string, symbolId: string): SymbolOverview | null {
    const contract = getSymbolContract(pageId, symbolId);
    return contract ? buildSymbolOverview(contract) : null;
  }

  function getComponentStructure(componentId: string): ComponentStructure | null {
    return componentStructureById.get(componentId) ?? null;
  }

  return {
    listPageFlows,
    getValueFlow,
    getValueJourney,
    getImpact,
    getPageOverview,
    getPageSummary,
    getPageIssues,
    getPageActions,
    getPageImpact,
    getPageQuality,
    getSymbolContract,
    getSymbolOverview,
    getComponentStructure,
    getEvidence,
  };
}

const CONTRACT_VALUE_KINDS = new Set<FlowNode["kind"]>([
  "prop",
  "hook-input",
  "hook-return",
  "component-value",
  "ui-effect",
]);

const CONTRACT_ORIGIN_KINDS = new Set<FlowNode["kind"]>([
  "boundary",
  "api",
  "async-operation",
  "state-field",
  "selector-result",
]);

const CONTRACT_ORIGIN_ORDER: Record<FlowNode["kind"], number> = {
  boundary: 0,
  api: 1,
  "async-operation": 2,
  "state-field": 3,
  "selector-result": 4,
  "hook-input": 5,
  "hook-return": 6,
  "component-value": 7,
  prop: 8,
  "ui-effect": 9,
  gap: 10,
};

function isContractValue(node: FlowNode) {
  return CONTRACT_VALUE_KINDS.has(node.kind);
}

function contractGroupFor(node: FlowNode): SymbolContractValueGroup {
  if (node.kind === "prop") return "inputs";
  if (node.kind === "hook-input") return "reads";
  if (node.kind === "ui-effect") return "ui-effects";
  return "results";
}

function displayContractName(node: FlowNode) {
  if (node.kind === "hook-return" && node.path) return node.path;
  if (node.path && node.name !== node.path) return `${node.name} · ${node.path}`;
  return node.name;
}

function contractOriginGraph(
  detail: ValueFlowDetail,
  targetId: string,
  graphNodeById: Map<string, ProjectMapNode>
): { nodes: SymbolContractStep[]; edges: SymbolContractOriginEdge[] } {
  const ancestorIds = traverseFlow(targetId, detail.edges, "incoming");
  const nodes = detail.nodes
    .filter((node) => ancestorIds.has(node.id) && CONTRACT_ORIGIN_KINDS.has(node.kind))
    .sort((left, right) =>
      CONTRACT_ORIGIN_ORDER[left.kind] - CONTRACT_ORIGIN_ORDER[right.kind] ||
      left.name.localeCompare(right.name)
    )
    .map((node) => contractStep(node, graphNodeById, { flowId: detail.flow.id }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = detail.edges
    .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
    .map(({ id, from, to, relation, confidence, stateWrite }) => ({
      id,
      from,
      to,
      relation,
      confidence,
      ...(stateWrite ? { stateWrite } : {}),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return { nodes, edges };
}

function contractDerivationInputs(
  detail: ValueFlowDetail,
  targetId: string,
  graphNodeById: Map<string, ProjectMapNode>
): SymbolContractStep[] {
  const nodeById = new Map(detail.nodes.map((node) => [node.id, node]));
  return detail.edges
    .filter((edge) => edge.to === targetId && edge.relation === "derives")
    .flatMap((edge) => nodeById.get(edge.from) ?? [])
    .map((node) => contractStep(node, graphNodeById, { flowId: detail.flow.id }));
}

function contractConsumers(
  detail: ValueFlowDetail,
  sourceId: string,
  graphNodeById: Map<string, ProjectMapNode>
): SymbolContractStep[] {
  const descendantIds = traverseFlow(sourceId, detail.edges, "outgoing");
  return detail.consumers
    .filter((node) => node.id !== sourceId && descendantIds.has(node.id) && node.kind !== "gap")
    .map((node) => contractStep(node, graphNodeById, { flowId: detail.flow.id }));
}

function contractStep(
  node: FlowNode,
  graphNodeById: Map<string, ProjectMapNode>,
  detail?: { distance?: number; relation?: FlowEdge["relation"]; flowId?: string }
): SymbolContractStep {
  return {
    id: node.id,
    kind: node.kind,
    name: node.name,
    path: node.path,
    ownerNodeId: node.ownerNodeId,
    ownerName: node.ownerNodeId ? graphNodeById.get(node.ownerNodeId)?.name : undefined,
    distance: detail?.distance,
    relation: detail?.relation,
    flowId: detail?.flowId,
    uiEffect: node.uiEffect,
  };
}

function contractConsumerLayers(
  detail: ValueFlowDetail,
  sourceId: string,
  sourceOwnerNodeId: string | undefined,
  graphNodeById: Map<string, ProjectMapNode>
): { direct: SymbolContractStep[]; downstream: SymbolContractStep[] } {
  const nodeById = new Map(detail.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, FlowEdge[]>();
  for (const edge of detail.edges) {
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
  }

  const direct = new Map<string, SymbolContractStep>();
  const downstream = new Map<string, SymbolContractStep>();
  const queue = (outgoing.get(sourceId) ?? []).map((edge) => ({
    id: edge.to,
    distance: 1,
    relation: edge.relation,
    hasExternalConsumer: false,
  }));
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    const visitKey = `${current.id}:${current.hasExternalConsumer}`;
    if (visited.has(visitKey)) continue;
    visited.add(visitKey);
    const node = nodeById.get(current.id);
    if (!node) continue;

    const isExternalConsumer = (
      node.kind === "component-value" || node.kind === "prop" || node.kind === "ui-effect"
    ) && node.ownerNodeId !== sourceOwnerNodeId;
    const step = isExternalConsumer
      ? contractStep(node, graphNodeById, {
        distance: current.distance,
        relation: current.relation,
        flowId: detail.flow.id,
      })
      : undefined;

    if (step && !current.hasExternalConsumer) {
      direct.set(node.id, step);
      downstream.delete(node.id);
    } else if (step && !direct.has(node.id)) {
      downstream.set(node.id, step);
    }

    const nextHasConsumer = current.hasExternalConsumer || isExternalConsumer;
    for (const edge of outgoing.get(node.id) ?? []) {
      queue.push({
        id: edge.to,
        distance: current.distance + 1,
        relation: edge.relation,
        hasExternalConsumer: nextHasConsumer,
      });
    }
  }

  return {
    direct: [...direct.values()].sort(compareContractSteps),
    downstream: [...downstream.values()].sort(compareContractSteps),
  };
}

function compareContractSteps(left: SymbolContractStep, right: SymbolContractStep): number {
  return (left.distance ?? 0) - (right.distance ?? 0) ||
    (left.ownerName ?? left.name).localeCompare(right.ownerName ?? right.name) ||
    left.name.localeCompare(right.name);
}

function mergeContractValues(
  primary: SymbolContractValue,
  additional: SymbolContractValue
): SymbolContractValue {
  const directConsumers = uniqueContractSteps([
    ...primary.directConsumers,
    ...additional.directConsumers,
  ]);
  const directIds = new Set(directConsumers.map((step) => step.id));
  return {
    ...primary,
    valueSemantics: primary.valueSemantics ?? additional.valueSemantics,
    origin: uniqueContractSteps([...primary.origin, ...additional.origin]),
    originEdges: uniqueOriginEdges([...primary.originEdges, ...additional.originEdges]),
    derivationInputs: uniqueContractSteps([
      ...primary.derivationInputs,
      ...additional.derivationInputs,
    ]),
    consumers: uniqueContractSteps([...primary.consumers, ...additional.consumers]),
    directConsumers,
    downstreamConsumers: uniqueContractSteps([
      ...primary.downstreamConsumers,
      ...additional.downstreamConsumers,
    ]).filter((step) => !directIds.has(step.id)),
    issues: [...new Map(
      [...primary.issues, ...additional.issues].map((issue) => [issue.id, issue])
    ).values()],
  };
}

function uniqueOriginEdges(edges: SymbolContractOriginEdge[]): SymbolContractOriginEdge[] {
  return [...new Map(edges.map((edge) => [edge.id, edge])).values()]
    .sort((left, right) => left.id.localeCompare(right.id));
}

function uniqueContractSteps(steps: SymbolContractStep[]): SymbolContractStep[] {
  const unique = new Map<string, SymbolContractStep>();
  for (const step of steps) {
    if (!unique.has(step.id)) unique.set(step.id, step);
  }
  return [...unique.values()];
}

function traverseFlow(
  startId: string,
  edges: FlowEdge[],
  direction: "incoming" | "outgoing"
): Set<string> {
  const adjacent = new Map<string, string[]>();
  for (const edge of edges) {
    const key = direction === "incoming" ? edge.to : edge.from;
    const next = direction === "incoming" ? edge.from : edge.to;
    const current = adjacent.get(key) ?? [];
    current.push(next);
    adjacent.set(key, current);
  }

  const visited = new Set<string>();
  const queue = [...(adjacent.get(startId) ?? [])];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    queue.push(...(adjacent.get(current) ?? []));
  }
  return visited;
}

function contractReferences(
  edges: ProjectMapEdge[],
  endpoint: "from" | "to",
  nodesById: Map<string, ProjectMapNode>
): SymbolContractReference[] {
  const references = new Map<string, SymbolContractReference>();
  for (const edge of edges) {
    const node = nodesById.get(edge[endpoint]);
    if (!node) continue;
    references.set(`${node.id}:${edge.type}`, {
      id: node.id,
      name: node.name,
      type: node.type,
      relation: edge.type,
      confidence: edge.confidence,
    });
  }
  return [...references.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function contractOriginPriority(coverage: FlowCoverage) {
  if (coverage.origin === "proven") return 4;
  if (coverage.origin === "boundary") return 3;
  if (coverage.origin === "gap") return 2;
  return 1;
}

function terminalRoles(nodes: FlowNode[], edges: FlowEdge[]) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const incoming = new Set(edges.filter((edge) => nodeIds.has(edge.from)).map((edge) => edge.to));
  const outgoing = new Set(edges.filter((edge) => nodeIds.has(edge.to)).map((edge) => edge.from));
  return {
    sourceNodeIds: nodes.filter((node) => !incoming.has(node.id)).map((node) => node.id),
    consumerNodeIds: nodes.filter((node) => !outgoing.has(node.id)).map((node) => node.id),
  };
}

function isProvenEdge(edge: FlowEdge): boolean {
  return edge.confidence === "high" || edge.confidence === "medium";
}

function groupOutgoing(edges: FlowEdge[]): Map<string, FlowEdge[]> {
  const grouped = new Map<string, FlowEdge[]>();
  for (const edge of edges) {
    const current = grouped.get(edge.from) ?? [];
    current.push(edge);
    grouped.set(edge.from, current);
  }
  return grouped;
}

function mergeEvidence(left: FlowEvidence[], right: FlowEvidence[]): FlowEvidence[] {
  const merged = new Map<string, FlowEvidence>();
  for (const evidence of [...left, ...right]) {
    const key = `${evidence.file}\0${evidence.line ?? ""}\0${evidence.column ?? ""}\0${evidence.code ?? ""}`;
    merged.set(key, evidence);
  }
  return [...merged.values()];
}

function bySubjectThenId(left: FlowSummary, right: FlowSummary): number {
  return left.subjectName.localeCompare(right.subjectName) || left.id.localeCompare(right.id);
}
