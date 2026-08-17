import type { ProjectMapNode } from "../graph/types.js";
import type { FlowEvidence, FlowNode, ValueFlow } from "./types.js";

export type PageImpactStage = "source" | "state" | "operation" | "logic";

export type PageImpactReference = {
  id: string;
  name: string;
  type: ProjectMapNode["type"] | FlowNode["kind"];
  file?: string;
  path?: string;
  evidence: FlowEvidence[];
};

export type PageImpactValue = {
  flowId: string;
  nodeId: string;
  name: string;
  path?: string;
};

export type PageImpactIssue = { id: string; reasonCode: string; message: string };

export type PageImpactItem = {
  id: string;
  target: PageImpactReference;
  stage: PageImpactStage;
  seedNodeIds: string[];
  affectedValues: PageImpactValue[];
  uiOutcomes: PageImpactReference[];
  affectedSymbols: PageImpactReference[];
  affectedPages: PageImpactReference[];
  possibleUiOutcomes: PageImpactReference[];
  possibleSteps: PageImpactReference[];
  possibleSymbols: PageImpactReference[];
  possiblePages: PageImpactReference[];
  issues: PageImpactIssue[];
  crossPage: "proven" | "possible" | null;
};

export type PageImpactSummary = {
  pageId: string;
  items: PageImpactItem[];
  groups: Array<{ stage: PageImpactStage; items: PageImpactItem[] }>;
  stats: {
    changePointsCount: number;
    affectedValuesCount: number;
    uiOutcomesCount: number;
    affectedSymbolsCount: number;
    crossPageDependenciesCount: number;
    possibleLinksCount: number;
    issuesCount: number;
  };
};

export type PageImpactFlowDetail = {
  flow: ValueFlow;
  subject: FlowNode;
  nodes: FlowNode[];
  gaps: FlowNode[];
};

export type PageImpactReachability = {
  nodes: FlowNode[];
  possibleNodes: FlowNode[];
  affectedOwnerNodeIds: string[];
  possibleAffectedOwnerNodeIds: string[];
  affectedPageIds: string[];
  possibleAffectedPageIds: string[];
};

export type BuildPageImpactSummaryInput = {
  pageId: string;
  graphNodes: ProjectMapNode[];
  flowDetails: PageImpactFlowDetail[];
  impactsBySeedId: ReadonlyMap<string, PageImpactReachability>;
};

const TARGET_KINDS = new Set<FlowNode["kind"]>([
  "api", "state-field", "async-operation", "selector-result", "hook-return",
]);
const OWNER_GROUPED_KINDS = new Set<FlowNode["kind"]>([
  "async-operation", "selector-result", "hook-return",
]);
const STAGE_ORDER: PageImpactStage[] = ["source", "state", "operation", "logic"];

/** Candidate flow nodes whose change can have a meaningful downstream blast radius. */
export function pageImpactSeedIds(details: PageImpactFlowDetail[]): string[] {
  return [...new Set(details.flatMap((detail) => detail.nodes)
    .filter((node) => TARGET_KINDS.has(node.kind))
    .map((node) => node.id))].sort();
}

/** Build a page-oriented, proven-vs-possible impact read model. */
export function buildPageImpactSummary(input: BuildPageImpactSummaryInput): PageImpactSummary {
  const graphNodeById = new Map(input.graphNodes.map((node) => [node.id, node]));
  const candidates = uniqueFlowNodes(input.flowDetails.flatMap((detail) => detail.nodes))
    .filter((node) => TARGET_KINDS.has(node.kind));
  const grouped = new Map<string, FlowNode[]>();

  for (const node of candidates) {
    const key = OWNER_GROUPED_KINDS.has(node.kind) && node.ownerNodeId ? node.ownerNodeId : node.id;
    grouped.set(key, [...(grouped.get(key) ?? []), node]);
  }

  const items = [...grouped.entries()]
    .map(([id, seeds]) => buildItem({ ...input, id, seeds, graphNodeById }))
    .filter((item): item is PageImpactItem => item !== null)
    .sort(compareItems);
  const groups = STAGE_ORDER
    .map((stage) => ({ stage, items: items.filter((item) => item.stage === stage) }))
    .filter((group) => group.items.length > 0);

  return {
    pageId: input.pageId,
    items,
    groups,
    stats: {
      changePointsCount: items.length,
      affectedValuesCount: uniqueBy(items.flatMap((item) => item.affectedValues), (value) => value.flowId).length,
      uiOutcomesCount: uniqueReferences(items.flatMap((item) => item.uiOutcomes)).length,
      affectedSymbolsCount: uniqueReferences(items.flatMap((item) => item.affectedSymbols)).length,
      crossPageDependenciesCount: items.filter((item) => item.crossPage !== null).length,
      possibleLinksCount: uniqueReferences(items.flatMap((item) => [
        ...item.possibleUiOutcomes, ...item.possibleSteps, ...item.possibleSymbols, ...item.possiblePages,
      ])).length,
      issuesCount: new Set(items.flatMap((item) => item.issues.map((issue) => issue.id))).size,
    },
  };
}

function buildItem(input: BuildPageImpactSummaryInput & {
  id: string;
  seeds: FlowNode[];
  graphNodeById: Map<string, ProjectMapNode>;
}): PageImpactItem | null {
  const impacts = input.seeds.flatMap((seed) => input.impactsBySeedId.get(seed.id) ?? []);
  if (impacts.length === 0) return null;

  const owner = input.graphNodeById.get(input.id);
  const representative = input.seeds[0]!;
  const target = owner ? graphReference(owner, input.seeds) : flowReference(representative);
  const seedIds = new Set(input.seeds.map((seed) => seed.id));
  const relevantDetails = input.flowDetails.filter((detail) => detail.nodes.some((node) => seedIds.has(node.id)));
  const affectedValues = uniqueBy(relevantDetails.map((detail) => ({
    flowId: detail.flow.id,
    nodeId: detail.subject.id,
    name: detail.subject.name,
    path: detail.subject.path,
  })), (value) => value.flowId).sort((left, right) =>
    (left.path ?? left.name).localeCompare(right.path ?? right.name)
  );

  const provenNodes = uniqueFlowNodes(impacts.flatMap((impact) => impact.nodes));
  const possibleNodes = uniqueFlowNodes(impacts.flatMap((impact) => impact.possibleNodes));
  const affectedPages = graphReferences(input.graphNodeById, impacts.flatMap((impact) => impact.affectedPageIds));
  if (!affectedPages.some((page) => page.id === input.pageId)) {
    const currentPage = input.graphNodeById.get(input.pageId);
    if (currentPage) affectedPages.push(graphReference(currentPage));
  }
  const possiblePages = graphReferences(input.graphNodeById, impacts.flatMap((impact) => impact.possibleAffectedPageIds))
    .filter((page) => !affectedPages.some((proven) => proven.id === page.id));
  const targetOwnerIds = new Set(input.seeds.flatMap((seed) => seed.ownerNodeId ?? []));
  if (owner) targetOwnerIds.add(owner.id);
  const affectedSymbols = graphReferences(input.graphNodeById, impacts.flatMap((impact) => impact.affectedOwnerNodeIds))
    .filter((reference) => !targetOwnerIds.has(reference.id) && reference.type !== "page");
  const possibleSymbols = graphReferences(
    input.graphNodeById,
    impacts.flatMap((impact) => impact.possibleAffectedOwnerNodeIds)
  ).filter((reference) =>
    !targetOwnerIds.has(reference.id) && reference.type !== "page" &&
    !affectedSymbols.some((proven) => proven.id === reference.id)
  );
  const uiOutcomes = uniqueReferences(provenNodes.filter(isUiOutcome).map(flowReference));
  const possibleUiOutcomes = uniqueReferences(possibleNodes.filter(isUiOutcome).map(flowReference)
    .filter((reference) => !uiOutcomes.some((proven) => proven.id === reference.id)));
  const possibleSteps = uniqueReferences(possibleNodes
    .filter((node) => !seedIds.has(node.id) && !isUiOutcome(node) && node.kind !== "gap")
    .map(flowReference));
  const issues = uniqueBy(relevantDetails.flatMap((detail) => detail.gaps).map((gap) => ({
    id: gap.id,
    reasonCode: gap.gap?.reasonCode ?? "unknown",
    message: gap.gap?.message ?? gap.name,
  })), (issue) => issue.id);

  return {
    id: input.id,
    target,
    stage: stageOf(representative.kind),
    seedNodeIds: [...seedIds].sort(),
    affectedValues,
    uiOutcomes,
    affectedSymbols,
    affectedPages: affectedPages.sort(byName),
    possibleUiOutcomes,
    possibleSteps,
    possibleSymbols,
    possiblePages: possiblePages.sort(byName),
    issues,
    crossPage: affectedPages.some((page) => page.id !== input.pageId)
      ? "proven"
      : possiblePages.some((page) => page.id !== input.pageId)
        ? "possible"
        : null,
  };
}

function graphReference(node: ProjectMapNode, seeds: FlowNode[] = []): PageImpactReference {
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    file: node.file,
    evidence: mergeEvidence(seeds.flatMap((seed) => seed.evidence)),
  };
}

function graphReferences(nodes: Map<string, ProjectMapNode>, ids: string[]): PageImpactReference[] {
  return uniqueReferences(ids.flatMap((id) => {
    const node = nodes.get(id);
    return node ? [graphReference(node)] : [];
  }));
}

function flowReference(node: FlowNode): PageImpactReference {
  return {
    id: node.id,
    name: node.name,
    type: node.kind,
    path: node.path,
    file: node.evidence[0]?.file,
    evidence: node.evidence,
  };
}

function stageOf(kind: FlowNode["kind"]): PageImpactStage {
  if (kind === "api") return "source";
  if (kind === "state-field") return "state";
  if (kind === "async-operation") return "operation";
  return "logic";
}

function isUiOutcome(node: FlowNode) {
  return node.kind === "prop" || node.kind === "ui-effect";
}

function compareItems(left: PageImpactItem, right: PageImpactItem) {
  return crossPagePriority(right.crossPage) - crossPagePriority(left.crossPage) ||
    right.uiOutcomes.length - left.uiOutcomes.length ||
    right.affectedValues.length - left.affectedValues.length ||
    left.target.name.localeCompare(right.target.name);
}

function crossPagePriority(value: PageImpactItem["crossPage"]) {
  return value === "proven" ? 2 : value === "possible" ? 1 : 0;
}

function uniqueFlowNodes(nodes: FlowNode[]) {
  return uniqueBy(nodes, (node) => node.id);
}

function uniqueReferences(references: PageImpactReference[]) {
  return uniqueBy(references, (reference) => reference.id).sort(byName);
}

function uniqueBy<T>(values: T[], keyOf: (value: T) => string): T[] {
  return [...new Map(values.map((value) => [keyOf(value), value])).values()];
}

function mergeEvidence(evidence: FlowEvidence[]) {
  return uniqueBy(evidence, (entry) =>
    `${entry.file}\0${entry.line ?? ""}\0${entry.column ?? ""}\0${entry.code ?? ""}`
  );
}

function byName(left: PageImpactReference, right: PageImpactReference) {
  return left.name.localeCompare(right.name);
}
