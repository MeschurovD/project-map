import { describe, expect, it } from "vitest";
import { createFlowQueries } from "../src/flow/queries.js";
import type { FlowIndex } from "../src/flow/types.js";
import type { ProjectMapGraph } from "../src/graph/types.js";

const ids = {
  page: "page:user",
  file: "file:src/pages/user/UserPage.tsx",
  pageComponent: "component:src/pages/user/UserPage#UserPage",
  widget: "component:src/widgets/UserWidget#UserWidget",
  card: "component:src/entities/UserCard#UserCard",
  selectorOwner: "selector:src/model/selectUser#selectUser",
  api: "api:http:GET:%2Fusers%2F%7Bid%7D",
  state: "state-field:slice-model:user#current",
  selector: "selector-result:selector:src/model/selectUser#selectUser",
  value: "component-value:component:src/widgets/UserWidget#UserWidget#user.name",
  prop: "prop:component:src/entities/UserCard#UserCard#name",
};

const graph: ProjectMapGraph = {
  schemaVersion: "1.1.0",
  project: { name: "queries", root: "/queries", sourceRoot: "src" },
  nodes: [
    { id: ids.page, type: "page", name: "user", fsd: { layer: "pages", slice: "user" } },
    { id: ids.file, type: "file", name: "UserPage.tsx", file: "src/pages/user/UserPage.tsx" },
    { id: ids.pageComponent, type: "component", name: "UserPage", fsd: { layer: "pages", slice: "user" } },
    { id: ids.widget, type: "component", name: "UserWidget", fsd: { layer: "widgets", slice: "user" } },
    { id: ids.card, type: "component", name: "UserCard", fsd: { layer: "entities", slice: "user" } },
    { id: ids.selectorOwner, type: "selector", name: "selectUser" },
  ],
  edges: [
    topologyEdge("page-file", ids.page, ids.file, "contains"),
    topologyEdge("component-file", ids.pageComponent, ids.file, "definedIn"),
    topologyEdge("page-widget", ids.pageComponent, ids.widget, "renders"),
    topologyEdge("widget-card", ids.widget, ids.card, "renders"),
    topologyEdge("widget-selector", ids.widget, ids.selectorOwner, "usesSelector"),
  ],
  stats: { nodesCount: 6, edgesCount: 5 },
};

const flowIndex: FlowIndex = {
  schemaVersion: "1.4.0",
  runId: "query-test",
  generatedAt: "2026-07-12T00:00:00.000Z",
  sourceFingerprint: "query-fixture",
  nodes: [
    flowNode(ids.api, "api", "GET /users/${id}"),
    flowNode(ids.state, "state-field", "state.user.current", "slice-model:user"),
    flowNode(ids.selector, "selector-result", "selectUser", ids.selectorOwner),
    flowNode(ids.value, "component-value", "user.name", ids.widget),
    flowNode(ids.prop, "prop", "UserCard.name", ids.card),
  ],
  edges: [
    flowEdge("api-state", ids.api, ids.state, "writes"),
    flowEdge("state-selector", ids.state, ids.selector, "selects"),
    flowEdge("selector-value", ids.selector, ids.value, "binds"),
    flowEdge("value-prop", ids.value, ids.prop, "passes"),
  ],
  flows: [{
    id: `flow:${ids.value}`,
    scopeNodeIds: [ids.card, ids.selectorOwner, ids.widget, "slice-model:user"],
    subjectNodeId: ids.value,
    nodeIds: [ids.api, ids.prop, ids.selector, ids.state, ids.value].sort(),
    edgeIds: ["api-state", "selector-value", "state-selector", "value-prop"].map((id) => `flow-edge:${id}`),
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

describe("createFlowQueries", () => {
  const queries = createFlowQueries({ graph, flowIndex });
  const flowId = flowIndex.flows[0]!.id;

  it("returns stable page summaries and hydrated flow details", () => {
    const [summary] = queries.listPageFlows(ids.page);
    const detail = queries.getValueFlow(flowId);

    expect(summary).toMatchObject({
      id: flowId,
      subjectName: "user.name",
      completeness: "complete",
      coverage: { origin: "proven", continuation: "proven" },
      nodeCount: 5,
      edgeCount: 4,
      sourceNodeIds: [ids.api],
      consumerNodeIds: [ids.prop],
    });
    expect(detail?.subject.id).toBe(summary?.subjectNodeId);
    expect(detail?.nodes.map((node) => node.id)).toEqual(flowIndex.flows[0]?.nodeIds);
    expect(detail?.sources.map((node) => node.id)).toEqual([ids.api]);
    expect(detail?.consumers.map((node) => node.id)).toEqual([ids.prop]);
  });

  it("builds a linear value journey with ordered steps and evidence", () => {
    const journey = queries.getValueJourney(flowId);

    expect(journey).toMatchObject({
      flowId,
      subject: { id: ids.value, name: "user.name" },
      sourceNames: ["GET /users/${id}"],
      consumerNames: ["UserCard.name"],
      isBranched: false,
      recommendedView: "steps",
      stats: { stepsCount: 5, gapCount: 0 },
    });
    expect(journey?.steps.map((step) => step.id)).toEqual([
      ids.api,
      ids.state,
      ids.selector,
      ids.value,
      ids.prop,
    ]);
    expect(journey?.steps[1]).toMatchObject({
      name: "state.user.current",
      incomingRelations: ["writes"],
      predecessorIds: [ids.api],
      successorIds: [ids.selector],
    });
    expect(journey?.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: "src/source.ts", line: 1, stepName: "GET /users/${id}", source: "node" }),
      expect.objectContaining({ file: "src/source.ts", line: 2, stepName: "state.user.current", source: "relation", relation: "writes" }),
    ]));
  });

  it("builds page overview from the same scope and summaries", () => {
    const overview = queries.getPageOverview(ids.page);

    expect(overview).toMatchObject({
      primaryComponentId: ids.pageComponent,
      warnings: [],
      stats: {
        flowsCount: 1,
        completeFlowsCount: 1,
        partialFlowsCount: 0,
        gapsCount: 0,
        originResolvedFlowsCount: 1,
        originGapFlowsCount: 0,
        originUnknownFlowsCount: 0,
        continuationResolvedFlowsCount: 1,
      },
    });
    expect(overview?.flows).toEqual(queries.listPageFlows(ids.page));
    expect(overview?.topologyNodes.map((node) => node.id)).toEqual(expect.arrayContaining([
      ids.pageComponent,
      ids.widget,
      ids.card,
      ids.selectorOwner,
    ]));
  });

  it("builds a question-oriented page summary without presentation inference", () => {
    const summary = queries.getPageSummary(ids.page);

    expect(summary).toMatchObject({
      page: { id: ids.page, name: "user", type: "page" },
      primaryComponent: { id: ids.pageComponent, name: "UserPage" },
      keyLogic: [],
      composition: {
        componentsCount: 3,
        hooksCount: 0,
        domainBlocks: [
          expect.objectContaining({ id: ids.card, name: "UserCard" }),
          expect.objectContaining({ id: ids.widget, name: "UserWidget" }),
        ],
      },
      behavior: { operations: [], uiEffects: [] },
      quality: {
        valuesCount: 1,
        originResolvedCount: 1,
        originCoveragePct: 100,
        issueCount: 0,
      },
    });
    expect(summary?.data.stateFields).toEqual([
      expect.objectContaining({ id: ids.state, name: "state.user.current" }),
    ]);
    expect(summary?.data.apis).toEqual([
      expect.objectContaining({ id: ids.api, name: "GET /users/${id}" }),
    ]);
    expect(summary?.data.selectors).toEqual([
      expect.objectContaining({ id: ids.selector, name: "selectUser" }),
    ]);
  });

  it("returns an explicit empty issue summary for a fully traced page", () => {
    expect(queries.getPageIssues(ids.page)).toEqual({
      pageId: ids.page,
      totalCount: 0,
      originCount: 0,
      continuationCount: 0,
      unknownCount: 0,
      groups: [],
      issues: [],
    });
  });

  it("builds a transparent page quality summary from the same canonical scope", () => {
    expect(queries.getPageQuality(ids.page)).toMatchObject({
      pageId: ids.page,
      status: "complete",
      values: { totalCount: 1, completeCount: 1, partialCount: 0 },
      origin: { resolvedCount: 1, resolvedPct: 100, statuses: { proven: 1 } },
      continuation: { resolvedCount: 1, resolvedPct: 100, statuses: { proven: 1 } },
      confidence: { totalCount: 4, high: 4, low: 0, unknown: 0 },
      evidence: {
        nodesCount: 5,
        nodesWithEvidenceCount: 5,
        edgesCount: 4,
        edgesWithEvidenceCount: 4,
      },
      issues: { totalCount: 0 },
    });
  });

  it("returns an explicit empty action summary when the page has no operations", () => {
    expect(queries.getPageActions(ids.page)).toEqual({
      pageId: ids.page,
      operations: [],
      stats: {
        operationsCount: 0,
        initiatorsCount: 0,
        apiCallsCount: 0,
        exactStateChangesCount: 0,
        uiOutcomesCount: 0,
        issuesCount: 0,
      },
    });
  });

  it("hydrates page issues from the same canonical flow scope", () => {
    const gapId = "gap:selector-source-not-recorded:selectUser";
    const gap = {
      ...flowNode(gapId, "gap", "Source not resolved for selectUser", ids.selectorOwner),
      gap: {
        reasonCode: "selector-source-not-recorded",
        message: "No normalized source is available for selector selectUser",
      },
      confidence: "unknown" as const,
    };
    const gapEdge = flowEdge("gap-api", gapId, ids.api, "produces", "unknown");
    const baseFlow = flowIndex.flows[0]!;
    const issueIndex: FlowIndex = {
      ...flowIndex,
      nodes: [...flowIndex.nodes, gap],
      edges: [...flowIndex.edges, gapEdge],
      flows: [{
        ...baseFlow,
        nodeIds: [...baseFlow.nodeIds, gapId].sort(),
        edgeIds: [...baseFlow.edgeIds, gapEdge.id].sort(),
        completeness: "partial",
        coverage: {
          origin: "gap",
          continuation: "proven",
          reasonCodes: ["selector-source-not-recorded"],
        },
      }],
      stats: { ...flowIndex.stats, completeFlowsCount: 0, gapsCount: 1, originResolvedFlowsCount: 0, originGapFlowsCount: 1 },
    };
    const issueQueries = createFlowQueries({ graph, flowIndex: issueIndex });

    expect(issueQueries.getPageIssues(ids.page)).toMatchObject({
      totalCount: 1,
      originCount: 1,
      continuationCount: 0,
      groups: [{
        reasonCode: "selector-source-not-recorded",
        position: "origin",
        affectedValuesCount: 1,
      }],
      issues: [{
        id: gapId,
        affectedValues: [{ flowId: baseFlow.id, name: "user.name" }],
        affectedOwners: expect.arrayContaining([
          expect.objectContaining({ id: ids.selectorOwner, name: "selectUser" }),
          expect.objectContaining({ id: ids.widget, name: "UserWidget" }),
        ]),
      }],
    });
  });

  it("traverses impact downstream from a topology owner", () => {
    const impact = queries.getImpact(ids.selectorOwner);

    expect(impact?.seedNodeIds).toEqual([ids.selector]);
    expect(impact?.nodeIds).toEqual(expect.arrayContaining([ids.selector, ids.value, ids.prop]));
    expect(impact?.nodeIds).not.toContain(ids.state);
    expect(impact?.terminalNodeIds).toEqual([ids.prop]);
    expect(impact?.affectedOwnerNodeIds).toEqual(expect.arrayContaining([ids.selectorOwner, ids.widget, ids.card]));
    expect(impact?.affectedPageIds).toEqual([ids.page]);
  });

  it("aggregates page change points into a semantic impact summary", () => {
    const impact = queries.getPageImpact(ids.page);

    expect(impact?.groups.map((group) => group.stage)).toEqual(["source", "state", "logic"]);
    expect(impact?.items.find((item) => item.target.id === ids.api)).toMatchObject({
      affectedValues: [expect.objectContaining({ flowId })],
      uiOutcomes: [expect.objectContaining({ id: ids.prop })],
    });
    expect(impact?.stats).toMatchObject({
      changePointsCount: 3,
      affectedValuesCount: 1,
      uiOutcomesCount: 1,
    });
  });

  it("returns deduplicated evidence for nodes and edges", () => {
    expect(queries.getEvidence(ids.api)).toEqual([{
      file: "src/source.ts",
      line: 1,
      code: ids.api,
    }]);
    expect(queries.getEvidence("flow-edge:api-state")).toEqual([{
      file: "src/source.ts",
      line: 2,
      code: "api-state",
    }]);
  });

  it("returns explicit empty results for unknown ids", () => {
    expect(queries.listPageFlows("page:missing")).toEqual([]);
    expect(queries.getPageOverview("page:missing")).toBeNull();
    expect(queries.getPageSummary("page:missing")).toBeNull();
    expect(queries.getPageIssues("page:missing")).toBeNull();
    expect(queries.getPageActions("page:missing")).toBeNull();
    expect(queries.getValueFlow("flow:missing")).toBeNull();
    expect(queries.getValueJourney("flow:missing")).toBeNull();
    expect(queries.getImpact("node:missing")).toBeNull();
    expect(queries.getPageImpact("page:missing")).toBeNull();
    expect(queries.getPageQuality("page:missing")).toBeNull();
    expect(queries.getEvidence("node:missing")).toEqual([]);
  });
});

describe("createFlowQueries impact confidence split", () => {
  // op --produces(high)--> provenValue (owner ProvenOwner)
  // op --writes(low)-----> possibleField (owner PossibleOwner)
  // op --high--> mid --high--> reachedBoth  and  op --writes(low)--> reachedBoth
  const confidenceGraph: ProjectMapGraph = {
    schemaVersion: "1.1.0",
    project: { name: "confidence", root: "/c", sourceRoot: "src" },
    nodes: [
      { id: "page:both", type: "page", name: "both" },
      { id: "file:both", type: "file", name: "both.tsx", file: "both.tsx" },
      { id: "comp:both", type: "component", name: "BothPage" },
      { id: "page:pos", type: "page", name: "pos" },
      { id: "file:pos", type: "file", name: "pos.tsx", file: "pos.tsx" },
      { id: "comp:pos", type: "component", name: "PosPage" },
      { id: "owner:proven", type: "component", name: "ProvenOwner" },
      { id: "owner:possible", type: "component", name: "PossibleOwner" },
    ],
    edges: [
      topologyEdge("both-file", "page:both", "file:both", "contains"),
      topologyEdge("both-comp", "comp:both", "file:both", "definedIn"),
      topologyEdge("both-proven", "comp:both", "owner:proven", "renders"),
      topologyEdge("both-possible", "comp:both", "owner:possible", "renders"),
      topologyEdge("pos-file", "page:pos", "file:pos", "contains"),
      topologyEdge("pos-comp", "comp:pos", "file:pos", "definedIn"),
      topologyEdge("pos-possible", "comp:pos", "owner:possible", "renders"),
    ],
    stats: { nodesCount: 8, edgesCount: 7 },
  };

  const confidenceIndex: FlowIndex = {
    schemaVersion: "1.4.0",
    runId: "confidence-test",
    generatedAt: "2026-07-14T00:00:00.000Z",
    sourceFingerprint: "confidence-fixture",
    nodes: [
      flowNode("op", "async-operation", "fetch.fulfilled"),
      flowNode("proven-value", "component-value", "proven", "owner:proven"),
      flowNode("possible-field", "state-field", "state.slice.error", "owner:possible"),
      flowNode("mid", "selector-result", "mid"),
      flowNode("reached-both", "selector-result", "reachedBoth"),
    ],
    edges: [
      flowEdge("op-proven", "op", "proven-value", "produces", "high"),
      flowEdge("op-possible", "op", "possible-field", "writes", "low"),
      flowEdge("op-mid", "op", "mid", "produces", "high"),
      flowEdge("mid-both", "mid", "reached-both", "derives", "high"),
      flowEdge("op-both", "op", "reached-both", "writes", "low"),
    ],
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

  const queries = createFlowQueries({ graph: confidenceGraph, flowIndex: confidenceIndex });

  it("routes low-confidence writes targets into possibleNodeIds, not nodeIds", () => {
    const impact = queries.getImpact("op");

    expect(impact?.nodeIds).toContain("proven-value");
    expect(impact?.nodeIds).not.toContain("possible-field");
    expect(impact?.possibleNodeIds).toContain("possible-field");
    expect(impact?.possibleEdgeIds).toContain("flow-edge:op-possible");
    expect(impact?.edgeIds).not.toContain("flow-edge:op-possible");
  });

  it("keeps a node reachable via both a proven and a low path proven", () => {
    const impact = queries.getImpact("op");

    expect(impact?.nodeIds).toContain("reached-both");
    expect(impact?.possibleNodeIds).not.toContain("reached-both");
  });

  it("excludes already-proven pages from possibleAffectedPageIds", () => {
    const impact = queries.getImpact("op");

    expect(impact?.affectedPageIds).toEqual(["page:both"]);
    expect(impact?.possibleAffectedPageIds).toEqual(["page:pos"]);
    expect(impact?.possibleAffectedOwnerNodeIds).toEqual(["owner:possible"]);
  });
});

function topologyEdge(
  id: string,
  from: string,
  to: string,
  type: ProjectMapGraph["edges"][number]["type"]
): ProjectMapGraph["edges"][number] {
  return { id, from, to, type, confidence: "high", evidence: [] };
}

function flowNode(
  id: string,
  kind: FlowIndex["nodes"][number]["kind"],
  name: string,
  ownerNodeId?: string
): FlowIndex["nodes"][number] {
  return {
    id,
    kind,
    name,
    ownerNodeId,
    confidence: "high",
    evidence: [{ file: "src/source.ts", line: 1, code: id }],
  };
}

function flowEdge(
  id: string,
  from: string,
  to: string,
  relation: FlowIndex["edges"][number]["relation"],
  confidence: FlowIndex["edges"][number]["confidence"] = "high"
): FlowIndex["edges"][number] {
  return {
    id: `flow-edge:${id}`,
    from,
    to,
    relation,
    confidence,
    evidence: [{ file: "src/source.ts", line: 2, code: id }],
  };
}
