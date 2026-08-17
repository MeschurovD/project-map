import { describe, expect, it } from "vitest";
import type { FlowQueries } from "../src/flow/queries.js";
import type { ProjectMapGraph } from "../src/graph/types.js";
import { queryImpactSummary } from "../src/ui/src/components/details/ImpactSummary.js";

describe("queryImpactSummary", () => {
  it("builds an impact target from a canonical flow node", () => {
    const graph: ProjectMapGraph = {
      schemaVersion: "1.1.0",
      project: { name: "fixture", root: "/fixture", sourceRoot: "/fixture/src" },
      nodes: [{ id: "page:orders", type: "page", name: "Orders" }],
      edges: [],
      stats: { nodesCount: 1, edgesCount: 0 },
    };
    const impact = {
      targetId: "flow-node:status",
      seedNodeIds: ["flow-node:status"],
      flowIds: ["flow:status"],
      nodeIds: ["flow-node:status"],
      possibleNodeIds: [],
      edgeIds: [],
      possibleEdgeIds: [],
      terminalNodeIds: [],
      affectedOwnerNodeIds: ["page:orders"],
      possibleAffectedOwnerNodeIds: [],
      affectedPageIds: ["page:orders"],
      possibleAffectedPageIds: [],
      nodes: [{
        id: "flow-node:status",
        kind: "selector-result" as const,
        name: "order status",
        confidence: "high" as const,
        evidence: [{ file: "src/entities/order/selectors.ts", line: 12 }],
      }],
      edges: [],
      possibleNodes: [],
      possibleEdges: [],
    };
    const queries = {
      getImpact: () => impact,
    } as unknown as FlowQueries;

    const summary = queryImpactSummary(graph, queries, "flow-node:status");

    expect(summary?.target).toMatchObject({
      id: "flow-node:status",
      name: "order status",
      file: "src/entities/order/selectors.ts",
    });
    expect(summary?.pages.map((page) => page.id)).toEqual(["page:orders"]);
  });
});
