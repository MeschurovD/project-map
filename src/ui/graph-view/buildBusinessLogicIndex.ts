import { buildPageScope } from "../../flow/buildPageScope.js";
import type { FlowIndex } from "../../flow/types.js";
import type { FlowEvidence } from "../../flow/types.js";
import type { ProjectMapGraph, ProjectMapNode } from "../../graph/types.js";
import type {
  EnrichmentTarget,
  MergedEnrichmentAnnotation,
} from "../../modules/enrichmentTypes.js";
import { indexEnrichmentAnnotations } from "./applyEnrichment.js";

export type BusinessLogicCategory = "rule" | "scenario" | "caution" | "contract";
export type BusinessLogicAssociation = "direct" | "inherited" | "related";

export type BusinessLogicTarget = {
  target: EnrichmentTarget;
  label: string;
  association: BusinessLogicAssociation;
  ownerNodeId?: string;
  ownerLabel?: string;
  flowId?: string;
  pageIds: string[];
  relations: string[];
  confidence?: "high" | "medium" | "low" | "unknown";
  evidence: FlowEvidence[];
};

export type BusinessLogicEntry = {
  key: string;
  annotation: MergedEnrichmentAnnotation;
  category: BusinessLogicCategory;
  owner?: ProjectMapNode;
  targets: BusinessLogicTarget[];
  pageIds: string[];
  pageLabels: string[];
  diagnostics: Array<"unreviewed" | "stale" | "unlinked" | "low-confidence" | "duplicate">;
};

export type BusinessLogicIndex = {
  entries: BusinessLogicEntry[];
  pages: Array<{ id: string; label: string; count: number }>;
  undocumentedValues: BusinessLogicTarget[];
  pagesWithoutBusinessContext: Array<{ id: string; label: string }>;
  stats: {
    totalCount: number;
    ruleCount: number;
    scenarioCount: number;
    cautionCount: number;
    contractCount: number;
    reviewedCount: number;
    staleCount: number;
    unlinkedCount: number;
    undocumentedValueCount: number;
    pagesWithoutBusinessContextCount: number;
    duplicateCount: number;
  };
};

export type BusinessLogicFilters = {
  query?: string;
  category?: BusinessLogicCategory | "all";
  quality?: "all" | "reviewed" | "unreviewed" | "stale" | "unlinked" | "duplicate";
  association?: BusinessLogicAssociation | "all";
  pageId?: string | "all";
};

const CATEGORIES = new Map<string, BusinessLogicCategory>([
  ["business-rule", "rule"],
  ["role-rule", "rule"],
  ["scenario", "scenario"],
  ["user-flow", "scenario"],
  ["gotcha", "caution"],
  ["open-question", "caution"],
  ["contract", "contract"],
]);

export function buildBusinessLogicIndex(params: {
  graph: ProjectMapGraph;
  flowIndex: FlowIndex;
  annotations: MergedEnrichmentAnnotation[];
}): BusinessLogicIndex {
  const graphNodeById = new Map(params.graph.nodes.map((node) => [node.id, node]));
  const flowNodeById = new Map(params.flowIndex.nodes.map((node) => [node.id, node]));
  const flowsByNodeId = new Map<string, string[]>();
  for (const flow of params.flowIndex.flows) {
    for (const nodeId of flow.nodeIds) {
      const current = flowsByNodeId.get(nodeId);
      if (current) current.push(flow.id);
      else flowsByNodeId.set(nodeId, [flow.id]);
    }
  }

  const pages = params.graph.nodes.filter((node) => node.type === "page");
  const pageNodeIds = new Map<string, Set<string>>();
  const pageFlowNodeIds = new Map<string, Set<string>>();
  for (const page of pages) {
    const scope = buildPageScope({ graph: params.graph, flowIndex: params.flowIndex, pageId: page.id });
    pageNodeIds.set(page.id, new Set([page.id, ...(scope?.topologyNodeIds ?? [])]));
    pageFlowNodeIds.set(page.id, new Set(scope?.flowNodeIds ?? []));
  }

  const entries = new Map<string, BusinessLogicEntry>();
  for (const annotation of params.annotations) {
    const category = annotation.moduleId === "docs" ? CATEGORIES.get(annotation.kind) : undefined;
    if (!category) continue;
    const key = annotationKey(annotation);
    const owner = graphNodeById.get(annotation.ownerNodeId);
    const directTargets = annotation.targets.map((target) => targetPresentation({
      target,
      association: "direct",
      graphNodeById,
      flowNodeById,
      flowsByNodeId,
      pageNodeIds,
      pageFlowNodeIds,
    }));
    entries.set(key, {
      key,
      annotation,
      category,
      owner,
      targets: directTargets,
      pageIds: [],
      pageLabels: [],
      diagnostics: [],
    });
  }

  const semanticIndex = indexEnrichmentAnnotations(
    params.annotations.filter((annotation) => annotation.moduleId === "docs" && CATEGORIES.has(annotation.kind)),
    params.flowIndex
  );
  for (const [targetKey, annotations] of semanticIndex) {
    if (!targetKey.startsWith("flow-node:")) continue;
    const targetId = targetKey.slice("flow-node:".length);
    for (const annotation of annotations) {
      if (!annotation.association) continue;
      const entry = entries.get(annotationKey(annotation));
      if (!entry || entry.targets.some((target) => target.target.type === "flow-node" && target.target.id === targetId)) {
        continue;
      }
      entry.targets.push(targetPresentation({
        target: { type: "flow-node", id: targetId },
        association: annotation.association.kind,
        relations: annotation.association.relations,
        confidence: annotation.association.confidence,
        graphNodeById,
        flowNodeById,
        flowsByNodeId,
        pageNodeIds,
        pageFlowNodeIds,
      }));
    }
  }

  const pageCount = new Map<string, number>();
  for (const entry of entries.values()) {
    const pageIds = new Set(entry.targets.flatMap((target) => target.pageIds));
    if (entry.owner) {
      for (const [pageId, nodeIds] of pageNodeIds) {
        if (nodeIds.has(entry.owner.id)) pageIds.add(pageId);
      }
    }
    entry.pageIds = [...pageIds];
    entry.pageLabels = entry.pageIds.map((id) => graphNodeById.get(id)?.name ?? id);
    for (const pageId of entry.pageIds) pageCount.set(pageId, (pageCount.get(pageId) ?? 0) + 1);
    if (entry.annotation.review !== "reviewed") entry.diagnostics.push("unreviewed");
    if (entry.annotation.stale) entry.diagnostics.push("stale");
    if (entry.targets.length === 0) entry.diagnostics.push("unlinked");
    if (entry.annotation.confidence === "low" || entry.targets.some((target) => target.confidence === "low" || target.confidence === "unknown")) {
      entry.diagnostics.push("low-confidence");
    }
    entry.targets.sort((left, right) => associationRank(left.association) - associationRank(right.association) || left.label.localeCompare(right.label));
  }

  const result = [...entries.values()].sort((left, right) => {
    if (left.diagnostics.includes("stale") !== right.diagnostics.includes("stale")) {
      return left.diagnostics.includes("stale") ? -1 : 1;
    }
    return plainText(left.annotation.markdown).localeCompare(plainText(right.annotation.markdown));
  });
  const documentedValues = new Set(params.annotations
    .filter((annotation) => annotation.moduleId === "docs" && annotation.kind === "value-meaning")
    .flatMap((annotation) => annotation.targets)
    .filter((target): target is Extract<EnrichmentTarget, { type: "flow-node" }> => target.type === "flow-node")
    .map((target) => target.id));
  const documentableValues = params.flowIndex.nodes.filter((node) => !["gap", "boundary", "ui-effect"].includes(node.kind));
  const duplicatesByText = new Map<string, BusinessLogicEntry[]>();
  for (const entry of result) {
    const text = normalizedMeaning(entry.annotation.markdown);
    if (!text) continue;
    const matches = duplicatesByText.get(text);
    if (matches) matches.push(entry);
    else duplicatesByText.set(text, [entry]);
  }
  for (const matches of duplicatesByText.values()) {
    if (matches.length < 2) continue;
    for (const entry of matches) entry.diagnostics.push("duplicate");
  }
  const undocumentedValues = documentableValues
    .filter((node) => !documentedValues.has(node.id))
    .map((node) => targetPresentation({
      target: { type: "flow-node", id: node.id },
      association: "direct",
      graphNodeById,
      flowNodeById,
      flowsByNodeId,
      pageNodeIds,
      pageFlowNodeIds,
    }));
  const pagesWithoutBusinessContext = pages
    .filter((page) => !pageCount.get(page.id))
    .map((page) => ({ id: page.id, label: page.name }));

  return {
    entries: result,
    undocumentedValues,
    pagesWithoutBusinessContext,
    pages: pages
      .map((page) => ({ id: page.id, label: page.name, count: pageCount.get(page.id) ?? 0 }))
      .sort((left, right) => left.label.localeCompare(right.label)),
    stats: {
      totalCount: result.length,
      ruleCount: result.filter((entry) => entry.category === "rule").length,
      scenarioCount: result.filter((entry) => entry.category === "scenario").length,
      cautionCount: result.filter((entry) => entry.category === "caution").length,
      contractCount: result.filter((entry) => entry.category === "contract").length,
      reviewedCount: result.filter((entry) => entry.annotation.review === "reviewed").length,
      staleCount: result.filter((entry) => entry.annotation.stale).length,
      unlinkedCount: result.filter((entry) => entry.targets.length === 0).length,
      undocumentedValueCount: undocumentedValues.length,
      pagesWithoutBusinessContextCount: pagesWithoutBusinessContext.length,
      duplicateCount: result.filter((entry) => entry.diagnostics.includes("duplicate")).length,
    },
  };
}

export function filterBusinessLogicEntries(
  entries: BusinessLogicEntry[],
  filters: BusinessLogicFilters
): BusinessLogicEntry[] {
  const query = filters.query?.trim().toLowerCase() ?? "";
  return entries.filter((entry) => {
    if (filters.category && filters.category !== "all" && entry.category !== filters.category) return false;
    if (filters.pageId && filters.pageId !== "all" && !entry.pageIds.includes(filters.pageId)) return false;
    if (filters.association && filters.association !== "all" && !entry.targets.some((target) => target.association === filters.association)) return false;
    if (filters.quality && filters.quality !== "all") {
      if (filters.quality === "reviewed" && entry.annotation.review !== "reviewed") return false;
      if (filters.quality === "unreviewed" && entry.annotation.review === "reviewed") return false;
      if (filters.quality === "stale" && !entry.annotation.stale) return false;
      if (filters.quality === "unlinked" && entry.targets.length > 0) return false;
      if (filters.quality === "duplicate" && !entry.diagnostics.includes("duplicate")) return false;
    }
    if (!query) return true;
    const haystack = [
      entry.annotation.markdown,
      entry.annotation.kind,
      entry.owner?.name,
      ...entry.pageLabels,
      ...entry.targets.flatMap((target) => [target.label, target.ownerLabel]),
    ].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(query);
  });
}

function targetPresentation(params: {
  target: EnrichmentTarget;
  association: BusinessLogicAssociation;
  relations?: string[];
  confidence?: BusinessLogicTarget["confidence"];
  graphNodeById: Map<string, ProjectMapNode>;
  flowNodeById: Map<string, FlowIndex["nodes"][number]>;
  flowsByNodeId: Map<string, string[]>;
  pageNodeIds: Map<string, Set<string>>;
  pageFlowNodeIds: Map<string, Set<string>>;
}): BusinessLogicTarget {
  if (params.target.type === "node") {
    const node = params.graphNodeById.get(params.target.id);
    return {
      target: params.target,
      label: node?.name ?? params.target.id,
      association: params.association,
      ownerNodeId: node?.id,
      ownerLabel: node?.name,
      pageIds: [...params.pageNodeIds].filter(([, ids]) => ids.has(params.target.id)).map(([id]) => id),
      relations: params.relations ?? [],
      confidence: params.confidence,
      evidence: [],
    };
  }
  if (params.target.type === "flow-node") {
    const node = params.flowNodeById.get(params.target.id);
    const owner = node?.ownerNodeId ? params.graphNodeById.get(node.ownerNodeId) : undefined;
    return {
      target: params.target,
      label: node?.path ?? node?.name ?? params.target.id,
      association: params.association,
      ownerNodeId: node?.ownerNodeId,
      ownerLabel: owner?.name,
      flowId: params.flowsByNodeId.get(params.target.id)?.[0],
      pageIds: [...params.pageFlowNodeIds].filter(([, ids]) => ids.has(params.target.id)).map(([id]) => id),
      relations: params.relations ?? [],
      confidence: params.confidence ?? node?.confidence,
      evidence: node?.evidence ?? [],
    };
  }
  return {
    target: params.target,
    label: params.target.id,
    association: params.association,
    pageIds: [],
    relations: params.relations ?? [],
    confidence: params.confidence,
    evidence: [],
  };
}

function annotationKey(annotation: MergedEnrichmentAnnotation) {
  return `${annotation.moduleId}:${annotation.documentId ?? annotation.ownerNodeId}:${annotation.id}`;
}

function associationRank(association: BusinessLogicAssociation) {
  if (association === "direct") return 0;
  if (association === "inherited") return 1;
  return 2;
}

function plainText(markdown: string) {
  return markdown.replace(/[`*_#[\]()]/g, " ").replace(/\s+/g, " ").trim();
}

function normalizedMeaning(markdown: string) {
  return plainText(markdown).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
