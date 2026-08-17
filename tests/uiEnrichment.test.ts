import { describe, expect, it } from "vitest";
import type { ProjectMapNode } from "../src/graph/types.js";
import { FLOW_SCHEMA_VERSION, type FlowIndex, type FlowNodeKind, type FlowRelation } from "../src/flow/types.js";
import type { MergedEnrichmentEdge, MergedNodeEnrichment } from "../src/modules/enrichmentTypes.js";
import {
  applyEnrichment,
  indexEnrichmentAnnotations,
  indexEnrichmentByNodeId,
  type EnrichmentOverlay,
} from "../src/ui/graph-view/applyEnrichment.js";
import type { ViewGraph } from "../src/ui/graph-view/viewTypes.js";

describe("applyEnrichment", () => {
  it("attaches badges and summary to view nodes by canonical node id", () => {
    const result = applyEnrichment(view(), overlay([
      entry("docs", "component:a", { badges: [{ id: "docs", label: "docs", tone: "info" as const }] }),
      entry("e2e", "component:a", { summary: "Covered by checkout spec" }),
    ]));
    const enriched = result.nodes.find((node) => node.id === "view:a");

    expect(enriched?.enrichmentBadges).toEqual([{ id: "docs", label: "docs", tone: "info" }]);
    expect(enriched?.enrichmentSummary).toBe("Covered by checkout spec");
  });

  it("leaves nodes without enrichment or without a source node untouched", () => {
    const result = applyEnrichment(view(), overlay([
      entry("docs", "component:other", { badges: [{ id: "docs", label: "docs" }] }),
    ]));

    expect(result.nodes.find((node) => node.id === "view:a")?.enrichmentBadges).toBeUndefined();
    expect(result.nodes.find((node) => node.id === "view:group")?.enrichmentBadges).toBeUndefined();
  });

  it("returns the view as is for an empty overlay", () => {
    const original = view();
    expect(applyEnrichment(original, overlay([]))).toBe(original);
  });

  it("draws overlay edges between visible canonical nodes", () => {
    const result = applyEnrichment(view(), overlay([], [
      edge("e2e", "x1", "component:a", "file:src/A.po.ts"),
      edge("e2e", "x2", "component:a", "component:hidden"),
    ]));

    expect(result.edges).toEqual([
      {
        id: "enrichment:e2e:x1",
        from: "view:a",
        to: "view:file",
        type: "enrichment",
        label: "coveredByTest",
      },
    ]);
  });

  it("skips overlay edges when the toggle is off", () => {
    const result = applyEnrichment(view(), {
      ...overlay([], [edge("e2e", "x1", "component:a", "file:src/A.po.ts")]),
      showEdges: false,
    });

    expect(result.edges).toEqual([]);
  });
});

describe("indexEnrichmentAnnotations", () => {
  it("indexes one annotation under every canonical target", () => {
    const annotation = {
      moduleId: "docs",
      id: "rule:a",
      ownerNodeId: "component:a",
      kind: "business-rule",
      targets: [
        { type: "node" as const, id: "component:a" },
        { type: "flow-node" as const, id: "component-value:component:a#visible" },
      ],
      markdown: "Visible for owners.",
    };

    const index = indexEnrichmentAnnotations([annotation]);

    expect(index.get("node:component:a")).toEqual([annotation]);
    expect(index.get("flow-node:component-value:component:a#visible")).toEqual([annotation]);
  });

  it("inherits semantic annotations across identity edges and keeps derivations related", () => {
    const selectorId = "selector-result:selector:can-delete#result";
    const boundId = "component-value:component:a#canDelete";
    const propId = "prop:component:b#canDelete";
    const derivedId = "component-value:component:b#showDelete";
    const effectId = "ui-effect:component:b#DeleteButton";
    const meaning = annotation("meaning", "value-meaning", "identity", selectorId);
    const rule = annotation("rule", "business-rule", "context", selectorId);
    const index = indexEnrichmentAnnotations(
      [meaning, rule],
      flowIndex(
        [
          flowNode(selectorId, "selector-result", "selectCanDelete"),
          flowNode(boundId, "component-value", "canDelete"),
          flowNode(propId, "prop", "DeleteButton.canDelete"),
          flowNode(derivedId, "component-value", "showDelete"),
          flowNode(effectId, "ui-effect", "DeleteButton"),
        ],
        [
          flowEdge("bind", selectorId, boundId, "binds", "high"),
          flowEdge("pass", boundId, propId, "passes", "medium"),
          flowEdge("derive", propId, derivedId, "derives", "high"),
          flowEdge("control", derivedId, effectId, "controls", "high"),
        ]
      )
    );

    expect(index.get(`flow-node:${propId}`)).toEqual([
      expect.objectContaining({
        id: "meaning",
        association: {
          kind: "inherited",
          sourceTargetId: selectorId,
          sourceLabel: "selectCanDelete",
          relations: ["binds", "passes"],
          confidence: "medium",
        },
      }),
      expect.objectContaining({
        id: "rule",
        association: expect.objectContaining({ kind: "inherited" }),
      }),
    ]);
    expect(index.get(`flow-node:${derivedId}`)).toEqual([
      expect.objectContaining({
        id: "rule",
        association: {
          kind: "related",
          sourceTargetId: selectorId,
          sourceLabel: "selectCanDelete",
          relations: ["binds", "passes", "derives"],
          confidence: "medium",
        },
      }),
    ]);
    expect(index.get(`flow-node:${effectId}`)).toBeUndefined();
  });
});

function annotation(
  id: string,
  kind: string,
  propagation: "identity" | "context",
  targetId: string
) {
  return {
    moduleId: "docs",
    id,
    ownerNodeId: "component:a",
    kind,
    targets: [{ type: "flow-node" as const, id: targetId }],
    markdown: id,
    propagation,
  };
}

function flowIndex(
  nodes: FlowIndex["nodes"],
  edges: FlowIndex["edges"]
): FlowIndex {
  return {
    schemaVersion: FLOW_SCHEMA_VERSION,
    runId: "run",
    generatedAt: "2026-08-09T00:00:00.000Z",
    sourceFingerprint: "test",
    nodes,
    edges,
    flows: [],
    componentStructures: [],
    stats: {
      flowsCount: 0,
      completeFlowsCount: 0,
      gapsCount: 0,
      originResolvedFlowsCount: 0,
      originGapFlowsCount: 0,
      originUnknownFlowsCount: 0,
      continuationResolvedFlowsCount: 0,
    },
  };
}

function flowNode(id: string, kind: FlowNodeKind, name: string): FlowIndex["nodes"][number] {
  return { id, kind, name, confidence: "high", evidence: [] };
}

function flowEdge(
  id: string,
  from: string,
  to: string,
  relation: FlowRelation,
  confidence: "high" | "medium" | "low" | "unknown"
): FlowIndex["edges"][number] {
  return { id, from, to, relation, confidence, evidence: [] };
}

function view(): ViewGraph {
  return {
    nodes: [
      {
        id: "view:a",
        kind: "semantic-card",
        sourceNode: node("component:a"),
        label: "A",
        position: { x: 0, y: 0 },
      },
      {
        id: "view:file",
        kind: "semantic-card",
        sourceNode: node("file:src/A.po.ts"),
        label: "A.po.ts",
        position: { x: 360, y: 0 },
      },
      {
        id: "view:group",
        kind: "group-card",
        label: "widgets",
        position: { x: 0, y: 130 },
      },
    ],
    edges: [],
  };
}

function overlay(
  entries: MergedNodeEnrichment[],
  edges: MergedEnrichmentEdge[] = []
): EnrichmentOverlay {
  return {
    byNodeId: indexEnrichmentByNodeId(entries),
    edges,
    showEdges: true,
  };
}

function entry(
  moduleId: string,
  nodeId: string,
  rest: Partial<MergedNodeEnrichment>
): MergedNodeEnrichment {
  return { moduleId, nodeId, ...rest };
}

function edge(moduleId: string, id: string, from: string, to: string): MergedEnrichmentEdge {
  return { moduleId, id, from, to, type: "coveredByTest" };
}

function node(id: string): ProjectMapNode {
  return { id, type: "component", name: "A", file: "src/A.tsx" };
}
