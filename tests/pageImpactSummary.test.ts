import { describe, expect, it } from "vitest";
import { buildPageImpactSummary } from "../src/flow/buildPageImpactSummary.js";
import type { FlowNode, ValueFlow } from "../src/flow/types.js";

describe("buildPageImpactSummary", () => {
  it("separates proven and possible impact and surfaces cross-page dependencies", () => {
    const api = node("api", "api", "GET /records");
    const state = node("state", "state-field", "state.records.current", "slice:records");
    const selector = node("selector", "selector-result", "selectRecords", "selector:records");
    const value = node("value", "component-value", "records", "component:page");
    const prop = node("prop", "prop", "RecordsTable.values", "component:table");
    const possibleEffect = node("possible-effect", "ui-effect", "StatusBadge.visible", "component:badge");
    const flow: ValueFlow = {
      id: "flow:records",
      scopeNodeIds: [],
      subjectNodeId: value.id,
      nodeIds: [api.id, state.id, selector.id, value.id, prop.id],
      edgeIds: [],
      completeness: "complete",
      coverage: { origin: "proven", continuation: "proven", reasonCodes: [] },
    };

    const summary = buildPageImpactSummary({
      pageId: "page:records",
      graphNodes: [
        { id: "page:records", type: "page", name: "records" },
        { id: "page:dashboard", type: "page", name: "dashboard" },
        { id: "page:possible", type: "page", name: "possible" },
        { id: "selector:records", type: "selector", name: "selectRecords" },
        { id: "component:table", type: "component", name: "RecordsTable" },
        { id: "component:badge", type: "component", name: "StatusBadge" },
      ],
      flowDetails: [{ flow, subject: value, nodes: [api, state, selector, value, prop], gaps: [] }],
      impactsBySeedId: new Map([
        [api.id, {
          nodes: [api, state, selector, value, prop],
          possibleNodes: [possibleEffect],
          affectedOwnerNodeIds: ["selector:records", "component:table"],
          possibleAffectedOwnerNodeIds: ["component:badge"],
          affectedPageIds: ["page:records", "page:dashboard"],
          possibleAffectedPageIds: ["page:possible"],
        }],
        [state.id, {
          nodes: [state, selector, value, prop],
          possibleNodes: [],
          affectedOwnerNodeIds: ["selector:records", "component:table"],
          possibleAffectedOwnerNodeIds: [],
          affectedPageIds: ["page:records"],
          possibleAffectedPageIds: [],
        }],
        [selector.id, {
          nodes: [selector, value, prop],
          possibleNodes: [],
          affectedOwnerNodeIds: ["selector:records", "component:table"],
          possibleAffectedOwnerNodeIds: [],
          affectedPageIds: ["page:records"],
          possibleAffectedPageIds: [],
        }],
      ]),
    });

    expect(summary.groups.map((group) => group.stage)).toEqual(["source", "state", "logic"]);
    expect(summary.stats).toMatchObject({
      changePointsCount: 3,
      affectedValuesCount: 1,
      uiOutcomesCount: 1,
      crossPageDependenciesCount: 1,
      possibleLinksCount: 3,
    });
    const source = summary.items.find((item) => item.target.name === "GET /records");
    expect(source).toMatchObject({
      stage: "source",
      crossPage: "proven",
      affectedValues: [{ flowId: "flow:records", name: "records" }],
      uiOutcomes: [{ name: "RecordsTable.values" }],
      possibleUiOutcomes: [{ name: "StatusBadge.visible" }],
    });
    expect(source?.affectedPages.map((page) => page.name)).toEqual(["dashboard", "records"]);
    expect(source?.possiblePages.map((page) => page.name)).toEqual(["possible"]);
  });
});

function node(id: string, kind: FlowNode["kind"], name: string, ownerNodeId?: string): FlowNode {
  return {
    id,
    kind,
    name,
    ownerNodeId,
    confidence: "high",
    evidence: [{ file: "src/records.ts", line: 1 }],
  };
}
