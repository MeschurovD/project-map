import type { ProjectFact } from "../../scanner/facts.js";
import type { FlowQueries } from "../../flow/queries.js";
import { applyEnrichment, type EnrichmentOverlay } from "./applyEnrichment.js";
import { buildFullDebugView } from "./buildFullDebugView.js";
import { buildImpactView } from "./buildImpactView.js";
import { buildPageFocusView } from "./buildPageFocusView.js";
import { buildPagesOverviewView } from "./buildPagesOverviewView.js";
import type { GraphViewState, ProjectGraph, ViewGraph } from "./viewTypes.js";

export function buildViewGraph(
  graph: ProjectGraph,
  state: GraphViewState,
  facts: ProjectFact[] = [],
  enrichment?: EnrichmentOverlay,
  flowQueries?: FlowQueries
): ViewGraph {
  const view = buildModeView(graph, state, facts, flowQueries);
  const enriched = enrichment ? applyEnrichment(view, enrichment) : view;
  return pruneEmptyNodes(enriched);
}

/**
 * Drop degenerate cards that would render as a blank rectangle — a semantic
 * card with no label (a node the scan produced without a name) — and any edges
 * left dangling. Keeps the canvas honest: no ghost nodes the user can't read.
 */
export function pruneEmptyNodes(view: ViewGraph): ViewGraph {
  const nodes = view.nodes.filter((node) => node.kind !== "semantic-card" || Boolean(node.label.trim()));
  if (nodes.length === view.nodes.length) return view;

  const keptIds = new Set(nodes.map((node) => node.id));
  return {
    nodes,
    edges: view.edges.filter((edge) => keptIds.has(edge.from) && keptIds.has(edge.to)),
  };
}

function buildModeView(
  graph: ProjectGraph,
  state: GraphViewState,
  facts: ProjectFact[],
  flowQueries?: FlowQueries
): ViewGraph {
  switch (state.mode) {
    case "pages-overview":
      return buildPagesOverviewView(graph, state);

    case "page-focus":
      if (!state.selectedPageId) {
        return buildPagesOverviewView(graph, state);
      }
      return buildPageFocusView(graph, state.selectedPageId, state, facts, flowQueries);

    case "impact":
      if (!state.impactNodeId) {
        return buildPagesOverviewView(graph, state);
      }
      return buildImpactView(graph, state.impactNodeId, flowQueries);

    case "full-debug":
      return buildFullDebugView(graph, state);

    case "component-focus":
      return buildPagesOverviewView(graph, state);

    case "redux-focus":
      return buildPagesOverviewView(graph, state);

    default:
      return buildPagesOverviewView(graph, state);
  }
}
