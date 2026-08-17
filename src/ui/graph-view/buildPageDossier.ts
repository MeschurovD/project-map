import type { ProjectMapEdge, ProjectMapNode } from "../../graph/types.js";
import type { FlowQueries, PageOverview } from "../../flow/queries.js";
import { collectDirectPageComposition, findPageComponent } from "./collectDirectPageComposition.js";
import { semanticEdgesBetween } from "./pageFocusCards.js";
import type { ProjectGraph } from "./viewTypes.js";

// "README of a page": runtime product state comes from PageOverview queries.
// The graph-only branch remains for isolated topology tests, not runtime flow
// semantics. Docs summaries are overlaid from enrichment at render time.

export type DossierEvidence = { file?: string; line?: number; code?: string };

export type DossierItem = {
  nodeId: string;
  name: string;
  nodeType: string;
  file?: string;
  /** Edge type that links the page to this node, e.g. "renders", "usesSelector". */
  relation: string;
  evidence?: DossierEvidence;
};

export type DossierGroup = { key: string; items: DossierItem[] };

export type PageDossier = {
  page: { id: string; name: string; type: string; file?: string };
  composition: DossierGroup[];
  state: DossierGroup[];
};

const STATE_TYPE_TO_GROUP: Record<string, string> = {
  selector: "selectors",
  "slice-model": "slices",
  action: "actions",
  thunk: "actions",
  api: "api",
};

const STATE_GROUP_ORDER = ["selectors", "slices", "actions", "api"] as const;

export function buildPageDossier(
  graph: ProjectGraph,
  pageId: string,
  flowQueries?: FlowQueries
): PageDossier | null {
  if (flowQueries) {
    const overview = flowQueries.getPageOverview(pageId);
    return overview ? dossierFromOverview(overview) : null;
  }
  const page = graph.nodes.find((node) => node.id === pageId);
  if (!page) return null;

  const pageComponent = findPageComponent(graph, page);
  const composition = collectDirectPageComposition(graph, pageId);
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));

  const compositionGroups: DossierGroup[] = [];
  for (const [key, nodes] of [
    ["widgets", composition.widgets],
    ["features", composition.features],
    ["entities", composition.entities],
    ["shared", composition.shared],
  ] as const) {
    if (nodes.length === 0) continue;
    compositionGroups.push({
      key,
      items: nodes.map((node) => {
        const edge = pageComponent ? semanticEdgesBetween(graph, pageComponent.id, node.id)[0] : undefined;
        return dossierItem(node, edge);
      }),
    });
  }

  // State the page reads or writes: scan outgoing edges from the page component
  // and its composition, bucketed by node type, deduped, keeping one evidence.
  const consumers = [pageComponent, ...composition.widgets, ...composition.features, ...composition.entities, ...composition.shared]
    .filter((node): node is ProjectMapNode => Boolean(node));
  const stateBuckets = new Map<string, Map<string, DossierItem>>(
    STATE_GROUP_ORDER.map((key) => [key, new Map<string, DossierItem>()])
  );

  for (const consumer of consumers) {
    for (const edge of graph.edges) {
      if (edge.from !== consumer.id) continue;
      const target = nodesById.get(edge.to);
      const group = target ? STATE_TYPE_TO_GROUP[target.type] : undefined;
      if (!target || !group) continue;
      const bucket = stateBuckets.get(group)!;
      if (!bucket.has(target.id)) bucket.set(target.id, dossierItem(target, edge));
    }
  }

  const stateGroups = STATE_GROUP_ORDER
    .map((key) => ({ key, items: [...stateBuckets.get(key)!.values()].sort((a, b) => a.name.localeCompare(b.name)) }))
    .filter((group) => group.items.length > 0);

  return {
    page: { id: page.id, name: page.name, type: page.type, file: page.file },
    composition: compositionGroups,
    state: stateGroups,
  };
}

function dossierFromOverview(overview: PageOverview): PageDossier {
  const page = overview.topologyNodes.find((node) => node.id === overview.pageId);
  const compositionTypes = ["widget", "feature", "entity", "shared"] as const;
  const composition = compositionTypes.flatMap((type): DossierGroup[] => {
    const items = overview.topologyNodes
      .filter((node) => node.type === type)
      .map((node) => dossierItem(node, evidenceEdgeFor(node, overview)))
      .sort((left, right) => left.name.localeCompare(right.name));
    const key = type === "entity" ? "entities" : type === "shared" ? "shared" : `${type}s`;
    return items.length > 0 ? [{ key, items }] : [];
  });

  const stateBuckets = new Map<string, DossierItem[]>(STATE_GROUP_ORDER.map((key) => [key, []]));
  for (const node of overview.topologyNodes) {
    const group = STATE_TYPE_TO_GROUP[node.type];
    if (!group) continue;
    stateBuckets.get(group)?.push(dossierItem(node, evidenceEdgeFor(node, overview)));
  }
  const state = STATE_GROUP_ORDER.flatMap((key): DossierGroup[] => {
    const items = (stateBuckets.get(key) ?? []).sort((left, right) => left.name.localeCompare(right.name));
    return items.length > 0 ? [{ key, items }] : [];
  });

  return {
    page: {
      id: overview.pageId,
      name: page?.name ?? overview.pageId,
      type: page?.type ?? "page",
      file: page?.file,
    },
    composition,
    state,
  };
}

function evidenceEdgeFor(node: ProjectMapNode, overview: PageOverview): ProjectMapEdge | undefined {
  return overview.topologyEdges.find((edge) => edge.to === node.id) ??
    overview.topologyEdges.find((edge) => edge.from === node.id);
}

function dossierItem(node: ProjectMapNode, edge?: ProjectMapEdge): DossierItem {
  const evidence = edge?.evidence?.[0];
  return {
    nodeId: node.id,
    name: node.name,
    nodeType: node.type,
    file: node.file,
    relation: edge?.type ?? "",
    evidence: evidence ? { file: evidence.file, line: evidence.line, code: evidence.code } : undefined,
  };
}
