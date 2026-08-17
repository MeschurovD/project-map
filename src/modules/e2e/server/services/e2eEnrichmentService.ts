import type { ProjectMapGraph } from "../../../../graph/types.js";
import type { EnrichmentEdge, GraphEnrichment, NodeEnrichment } from "../../../enrichmentTypes.js";
import type { EnrichmentContext } from "../../../types.js";
import { e2eFileExists } from "./e2eFileService.js";
import { resolveComponentE2eTargets } from "./e2ePathResolver.js";

// E2e coverage as a graph layer: components with an existing page object get
// a "covered" badge and a coveredByTest edge to the test file node; pages get
// an "e2e N/M" badge over their rendered components, so the pages overview
// shows which pages have no e2e at all.

export type E2eCoverageSummary = {
  /** Pages whose every page-object target exists. */
  coveredPages: number;
  /** Pages that have at least one page-object target. */
  totalPages: number;
};

type PageObjectInfo = {
  path: string;
  exists: boolean;
};

export async function buildE2eEnrichment(context: EnrichmentContext): Promise<GraphEnrichment> {
  const coverage = await collectPageObjectCoverage(context.graph, context.projectRoot);
  const knownNodeIds = new Set(context.graph.nodes.map((node) => node.id));

  const nodes: NodeEnrichment[] = [];
  const edges: EnrichmentEdge[] = [];

  for (const [componentId, pageObject] of coverage) {
    if (!pageObject.exists) continue;
    nodes.push({
      nodeId: componentId,
      badges: [{ id: "e2e-covered", label: "e2e", tone: "ok" }],
    });

    // Colocated page objects are usually scanned into the graph as file
    // nodes; when they are not (e.g. excluded from the scan), skip the edge
    // instead of producing a merge warning per covered component.
    const fileNodeId = `file:${pageObject.path}`;
    if (knownNodeIds.has(fileNodeId)) {
      edges.push({
        id: `e2e-covered:${componentId}`,
        from: componentId,
        to: fileNodeId,
        type: "coveredByTest",
        label: "covered by",
      });
    }
  }

  for (const page of context.graph.nodes) {
    if (page.type !== "page") continue;
    const { existing, total } = pageCoverage(context.graph, page.id, coverage);
    if (total === 0) continue;

    nodes.push({
      nodeId: page.id,
      badges: [{
        id: "e2e-coverage",
        label: `e2e ${existing}/${total}`,
        tone: existing === total ? "ok" : existing > 0 ? "info" : "warn",
      }],
    });
  }

  return { nodes, edges };
}

export async function buildE2eCoverageSummary(
  graph: ProjectMapGraph,
  projectRoot: string
): Promise<E2eCoverageSummary> {
  const coverage = await collectPageObjectCoverage(graph, projectRoot);
  let coveredPages = 0;
  let totalPages = 0;

  for (const page of graph.nodes) {
    if (page.type !== "page") continue;
    const { existing, total } = pageCoverage(graph, page.id, coverage);
    if (total === 0) continue;
    totalPages += 1;
    if (existing === total) coveredPages += 1;
  }

  return { coveredPages, totalPages };
}

/** Page-object path and existence per component node, one fs check per path. */
async function collectPageObjectCoverage(graph: ProjectMapGraph, projectRoot: string) {
  const infoByComponentId = new Map<string, PageObjectInfo>();
  const existsByPath = new Map<string, boolean>();

  for (const node of graph.nodes) {
    const targets = resolveComponentE2eTargets(node);
    if (!targets) continue;

    let exists = existsByPath.get(targets.pageObjectPath);
    if (exists === undefined) {
      exists = await e2eFileExists(projectRoot, targets.pageObjectPath);
      existsByPath.set(targets.pageObjectPath, exists);
    }
    infoByComponentId.set(node.id, { path: targets.pageObjectPath, exists });
  }

  return infoByComponentId;
}

function pageCoverage(
  graph: ProjectMapGraph,
  pageId: string,
  coverage: Map<string, PageObjectInfo>
) {
  let existing = 0;
  let total = 0;
  for (const edge of graph.edges) {
    if (edge.from !== pageId || edge.type !== "renders") continue;
    const pageObject = coverage.get(edge.to);
    if (!pageObject) continue;
    total += 1;
    if (pageObject.exists) existing += 1;
  }
  return { existing, total };
}
