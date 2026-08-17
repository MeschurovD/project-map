import type { ProjectMapNode } from "../../graph/types.js";
import { collectPageStats, getPageNodes } from "./buildPagesOverviewView.js";
import { collectReachableSemanticNodes } from "./collectReachableNodes.js";
import type { GraphViewState, ProjectGraph } from "./viewTypes.js";

// Pages overview as a sortable dashboard: one row per page with its dependency
// counts, flow quality and docs/e2e coverage. Answers "which pages are heavy,
// incomplete, untested or undocumented". Pure query-backed view-model.

export type DashboardRow = {
  pageId: string;
  name: string;
  file?: string;
  widgets: number;
  features: number;
  entities: number;
  hooks: number;
  redux: number;
  /** Reachable product components — the denominator for coverage. */
  components: number;
  docsPct: number | null;
  e2ePct: number | null;
  flowsCount: number | null;
  sourceCoveragePct: number | null;
  sourceResolvedCount: number | null;
  originGapCount: number | null;
};

export type PagesDashboard = { rows: DashboardRow[] };

/** Minimal shape of the enrichment index this builder needs. */
export type DashboardEnrichment = Map<string, Array<{ badges?: Array<{ id: string }> }>>;
export type DashboardFlowQueries = {
  getPageOverview(pageId: string): {
    stats: {
      flowsCount: number;
      originResolvedFlowsCount: number;
      originGapFlowsCount: number;
    };
  } | null;
};

const PRODUCT_TYPES = new Set<ProjectMapNode["type"]>(["component", "widget", "feature", "entity"]);

export function buildPagesDashboard(
  graph: ProjectGraph,
  state: GraphViewState,
  enrichmentByNodeId?: DashboardEnrichment,
  flowQueries?: DashboardFlowQueries,
  // Free-text filter from the sidebar search box. Matches a page by name or its
  // FSD slice, case-insensitively; empty/whitespace shows every page. This is a
  // "find a page" filter only — symbol/value search stays in the Cmd+K palette.
  query?: string
): PagesDashboard {
  const normalizedQuery = query?.trim().toLowerCase() ?? "";
  const pages = getPageNodes(graph)
    .filter((page) => state.visibleLayers.has(page.fsd?.layer ?? "unknown"))
    .filter((page) => {
      if (!normalizedQuery) return true;
      const haystack = `${page.name} ${page.fsd?.slice ?? ""}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });

  const rows = pages.map((page) => {
    const stats = collectPageStats(graph, page.id, state);
    const reachable = collectReachableSemanticNodes(graph, page.id, {
      showFiles: state.showFiles,
      showHooks: state.showHooks,
      showRedux: state.showRedux,
      showUnknown: state.showUnknown,
      maxDepth: 4,
    });
    const products = reachable.filter((node) => PRODUCT_TYPES.has(node.type));
    const hasBadge = (nodeId: string, badgeId: string) =>
      Boolean(enrichmentByNodeId?.get(nodeId)?.some((entry) => entry.badges?.some((badge) => badge.id === badgeId)));

    const docsCovered = products.filter((node) => hasBadge(node.id, "docs")).length;
    const e2eCovered = products.filter((node) => hasBadge(node.id, "e2e")).length;
    const flowStats = flowQueries?.getPageOverview(page.id)?.stats;

    return {
      pageId: page.id,
      name: page.name,
      file: page.file,
      widgets: stats.widgets,
      features: stats.features,
      entities: stats.entities,
      hooks: stats.hooks,
      redux: stats.redux,
      components: products.length,
      docsPct: products.length > 0 ? Math.round((100 * docsCovered) / products.length) : null,
      e2ePct: products.length > 0 ? Math.round((100 * e2eCovered) / products.length) : null,
      flowsCount: flowStats?.flowsCount ?? null,
      sourceCoveragePct: flowStats && flowStats.flowsCount > 0
        ? Math.round((100 * flowStats.originResolvedFlowsCount) / flowStats.flowsCount)
        : null,
      sourceResolvedCount: flowStats?.originResolvedFlowsCount ?? null,
      originGapCount: flowStats?.originGapFlowsCount ?? null,
    };
  });

  return { rows };
}
