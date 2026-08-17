import { describe, expect, it } from "vitest";
import {
  buildPaletteEntries,
  filterNodesForPalette,
  filterPaletteEntries,
} from "../src/ui/src/components/CommandPalette.js";
import type { ProjectMapNode } from "../src/graph/types.js";
import { FLOW_SCHEMA_VERSION, type FlowIndex } from "../src/flow/types.js";

const nodes: ProjectMapNode[] = [
  { id: "page:feature", type: "page", name: "FeaturePage", file: "src/pages/feature/ui/FeaturePage.tsx", fsd: { layer: "pages" } },
  { id: "feature:configure-feature", type: "component", name: "ConfigureFeature", file: "src/features/configure-feature/ui/ConfigureFeature.tsx", fsd: { layer: "features" } },
  { id: "selector:feature", type: "selector", name: "selectFeature", file: "src/entities/feature/model/selectors.ts" },
  { id: "hook:useFeature", type: "hook", name: "useFeature", file: "src/entities/feature/model/useFeature.ts" },
];

describe("filterNodesForPalette", () => {
  it("ranks a name prefix above name substrings, then sorts ties by name", () => {
    const result = filterNodesForPalette(nodes, "feature");
    expect(result.map((node) => node.id)).toEqual([
      "page:feature", // FeaturePage — name prefix (rank 0)
      "feature:configure-feature", // ConfigureFeature — name substring (rank 1), wins tie by name
      "selector:feature", // selectFeature — name substring (rank 1)
      "hook:useFeature", // useFeature — name substring (rank 1)
    ]);
  });

  it("matches on file path and FSD layer, not just name", () => {
    expect(filterNodesForPalette(nodes, "entities").map((node) => node.id)).toEqual([
      "selector:feature",
      "hook:useFeature",
    ]);
    expect(filterNodesForPalette(nodes, "configure-feature").map((node) => node.id)).toEqual(["feature:configure-feature"]);
  });

  it("returns all nodes sorted by name for an empty query, capped by the limit", () => {
    expect(filterNodesForPalette(nodes, "  ").map((node) => node.name)).toEqual([
      "ConfigureFeature",
      "FeaturePage",
      "selectFeature",
      "useFeature",
    ]);
    expect(filterNodesForPalette(nodes, "", 2)).toHaveLength(2);
  });

  it("finds owners and canonical values by documented business meaning", () => {
    const flowNodeId = "hook-return:hook:useFeature#visible";
    const entries = buildPaletteEntries({
      nodes,
      annotations: [{
        moduleId: "docs",
        id: "visibility-rule",
        ownerNodeId: "hook:useFeature",
        kind: "business-rule",
        targets: [
          { type: "node", id: "hook:useFeature" },
          { type: "flow-node", id: flowNodeId },
        ],
        markdown: "Настройка доступна только владельцу пространства.",
      }],
      flowIndex: paletteFlowIndex(flowNodeId),
    });

    const results = filterPaletteEntries(entries, "владельцу");
    expect(results.map((entry) => [entry.kind, entry.name])).toEqual([
      ["value", "feature.visible"],
      ["node", "useFeature"],
    ]);
    expect(results[0]?.matchedText).toContain("доступна только владельцу");
    expect(results[0]).toMatchObject({ flowNodeId, flowId: "flow:visible" });
    expect(filterPaletteEntries(entries, "").some((entry) => entry.kind === "value")).toBe(false);
  });
});

function paletteFlowIndex(flowNodeId: string): FlowIndex {
  return {
    schemaVersion: FLOW_SCHEMA_VERSION,
    runId: "run",
    generatedAt: "2026-08-09T00:00:00.000Z",
    sourceFingerprint: "test",
    nodes: [{
      id: flowNodeId,
      kind: "hook-return",
      name: "useFeature.visible",
      path: "feature.visible",
      ownerNodeId: "hook:useFeature",
      confidence: "high",
      evidence: [],
    }],
    edges: [],
    flows: [{
      id: "flow:visible",
      scopeNodeIds: ["hook:useFeature"],
      subjectNodeId: flowNodeId,
      nodeIds: [flowNodeId],
      edgeIds: [],
      completeness: "complete",
      coverage: { origin: "proven", continuation: "proven", reasonCodes: [] },
    }],
    componentStructures: [],
    stats: {
      flowsCount: 1,
      completeFlowsCount: 1,
      gapsCount: 0,
      originResolvedFlowsCount: 1,
      originGapFlowsCount: 0,
      originUnknownFlowsCount: 0,
      continuationResolvedFlowsCount: 1,
    },
  };
}
