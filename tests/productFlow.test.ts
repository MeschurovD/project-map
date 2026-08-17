import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildPageScope } from "../src/flow/buildPageScope.js";
import { createFlowQueries } from "../src/flow/queries.js";
import type { FlowIndex } from "../src/flow/types.js";
import type { FlowQueries } from "../src/flow/queries.js";
import type { ProjectMapNode } from "../src/graph/types.js";
import type { ProjectFact } from "../src/scanner/facts.js";
import { runScan } from "../src/scan/runScan.js";
import {
  buildValueTrace,
  buildValueTraceGraph,
  type TraceNode,
} from "../src/ui/data-flow/buildValueTrace.js";
import {
  buildImpactQueryView,
  buildPageFlowQueryView,
  buildSingleFlowQueryView,
} from "../src/ui/graph-view/buildFlowQueryView.js";
import { buildPageFlowList, filterFlowListRows } from "../src/ui/graph-view/buildPageFlowList.js";
import { buildPageDossier } from "../src/ui/graph-view/buildPageDossier.js";
import { buildPagesDashboard } from "../src/ui/graph-view/buildPagesDashboard.js";
import { buildPageStructure, type PageStructureItem } from "../src/ui/graph-view/buildPageStructure.js";
import type { GraphViewState } from "../src/ui/graph-view/viewTypes.js";

describe("product flow contract from source fixture", () => {
  let tempRoot: string;
  let scan: Awaited<ReturnType<typeof runScan>>;
  let flowIndex: FlowIndex;
  let flowQueries: FlowQueries;

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "project-map-product-flow-"));
    await fs.cp(path.resolve("fixtures/basic-fsd-redux"), tempRoot, { recursive: true });
    scan = await runScan({ projectRoot: tempRoot });
    flowIndex = scan.flowIndex;
    flowQueries = createFlowQueries({ graph: scan.graph, flowIndex });
  });

  afterAll(async () => {
    if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("keeps the proven selector → state → thunk → API chain after a real scan", () => {
    const selector = nodeByTypeAndName(scan.graph.nodes, "selector", "selectCurrentUser");
    const [root] = buildValueTrace(scan.facts, selector);
    const trace = root ? flattenTrace(root) : [];

    expect(trace.map((node) => [node.kind, node.title])).toEqual(expect.arrayContaining([
      ["selector", "selectCurrentUser"],
      ["state", "state.user.current"],
      ["thunk", "fetchUser"],
      ["api", "GET /api/users/${userId}"],
    ]));

    for (const title of ["selectCurrentUser", "state.user.current", "fetchUser", "GET /api/users/${userId}"]) {
      expect(trace.find((node) => node.title === title)?.evidence).toBeDefined();
    }
  });

  it("normalizes the scanned selector value into FlowIndex without UI builders", () => {
    const value = flowIndex.nodes.find((node) =>
      node.kind === "hook-input" &&
      node.name === "user" &&
      node.ownerNodeId?.endsWith("#useUserProfile")
    );
    const flow = flowIndex.flows.find((entry) => entry.subjectNodeId === value?.id);
    const flowNodes = new Set(flow?.nodeIds ?? []);

    expect(value).toBeDefined();
    expect(flow).toMatchObject({ completeness: "complete" });
    expect(flowIndex.nodes.some((node) =>
      node.kind === "state-field" &&
      node.path === "state.user.current" &&
      flowNodes.has(node.id)
    )).toBe(true);
    expect(flowIndex.nodes.some((node) =>
      node.kind === "selector-result" &&
      node.name === "selectCurrentUser" &&
      flowNodes.has(node.id)
    )).toBe(true);
    expect(flowIndex.nodes.some((node) =>
      node.kind === "async-operation" &&
      node.name === "fetchUser.fulfilled" &&
      flowNodes.has(node.id)
    )).toBe(true);
    expect(flowIndex.nodes.some((node) =>
      node.kind === "api" &&
      node.name === "GET /api/users/${userId}" &&
      flowNodes.has(node.id)
    )).toBe(true);
    expect(flowIndex.edges.some((edge) => edge.relation === "selects")).toBe(true);
    expect(flowIndex.edges.some((edge) => edge.relation === "binds")).toBe(true);
    expect(flowIndex.edges.some((edge) => edge.relation === "writes")).toBe(true);
    expect(flowIndex.edges.some((edge) => edge.relation === "produces")).toBe(true);
  });

  it("resolves a composed selector to its state field without a source gap (PM-016)", () => {
    // selectUserError = (state) => selectUserState(state).error
    const errorInput = flowIndex.nodes.find((node) =>
      node.kind === "hook-input" &&
      node.name === "error" &&
      node.ownerNodeId?.endsWith("#useUserProfile")
    );
    const flow = flowIndex.flows.find((entry) => entry.subjectNodeId === errorInput?.id);
    const flowNodes = new Set(flow?.nodeIds ?? []);
    const composedSelector = flowIndex.nodes.find((node) =>
      node.kind === "selector-result" && node.name === "selectUserError"
    );

    expect(errorInput).toBeDefined();
    expect(composedSelector).toBeDefined();
    // The composition resolves through its base to a concrete state field.
    expect(flowIndex.nodes.some((node) =>
      node.kind === "state-field" &&
      node.path === "state.user.error" &&
      flowNodes.has(node.id)
    )).toBe(true);
    expect(flowIndex.edges.some((edge) =>
      edge.to === composedSelector!.id && edge.relation === "selects"
    )).toBe(true);
    // No selector-source-not-recorded gap remains for the composed selector.
    expect(flowIndex.nodes.some((node) =>
      node.kind === "gap" &&
      node.gap?.reasonCode === "selector-source-not-recorded" &&
      node.id.includes(composedSelector!.id)
    )).toBe(false);
  });

  it("resolves a varargs createSelector through a structured derives edge (PM-016)", () => {
    // selectUserSummary = createSelector(selectUserState, (user) => user.status)
    const summarySelector = flowIndex.nodes.find((node) =>
      node.kind === "selector-result" && node.name === "selectUserSummary"
    );
    const baseSelector = flowIndex.nodes.find((node) =>
      node.kind === "selector-result" && node.name === "selectUserState"
    );

    expect(summarySelector).toBeDefined();
    expect(baseSelector).toBeDefined();
    // Structured dependency, no "derived from" magic string.
    expect(flowIndex.edges.some((edge) =>
      edge.from === baseSelector!.id && edge.to === summarySelector!.id && edge.relation === "derives"
    )).toBe(true);
    // The base selector still resolves to real state.
    expect(flowIndex.edges.some((edge) =>
      edge.to === baseSelector!.id && edge.relation === "selects"
    )).toBe(true);

    const summaryInput = flowIndex.nodes.find((node) =>
      node.kind === "hook-input" && node.name === "summary" && node.ownerNodeId?.endsWith("#useUserProfile")
    );
    const flow = flowIndex.flows.find((entry) => entry.subjectNodeId === summaryInput?.id);
    expect(new Set(flow?.nodeIds ?? []).has(baseSelector!.id)).toBe(true);
  });

  it("preserves profile.name from hook return to the UserCard prop in FlowIndex", () => {
    const userCard = nodeByTypeAndName(scan.graph.nodes, "component", "UserCard");
    const value = flowIndex.nodes.find((node) =>
      node.kind === "component-value" && node.path === "profile.name"
    );
    const flow = flowIndex.flows.find((entry) => entry.subjectNodeId === value?.id);
    const flowNodes = new Set(flow?.nodeIds ?? []);
    const returned = flowIndex.nodes.find((node) =>
      node.kind === "hook-return" && node.name === "useUserProfile.name"
    );
    const prop = flowIndex.nodes.find((node) =>
      node.kind === "prop" && node.name === "UserCard.name"
    );

    expect(value).toMatchObject({ name: "profile.name", path: "profile.name" });
    expect(returned).toMatchObject({ path: "name" });
    expect(prop).toMatchObject({ ownerNodeId: userCard.id });
    expect(prop?.occurrenceId).toBeDefined();
    expect(flow).toMatchObject({ completeness: "complete" });
    expect([...flowNodes]).toEqual(expect.arrayContaining([returned?.id, value?.id, prop?.id]));
    expect(flowIndex.nodes.some((node) =>
      node.kind === "state-field" &&
      node.path === "state.user.current" &&
      flowNodes.has(node.id)
    )).toBe(true);
    expect(flowIndex.nodes.some((node) =>
      node.kind === "hook-input" &&
      node.path === "user" &&
      flowNodes.has(node.id)
    )).toBe(true);
    expect(flowIndex.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: returned?.id, to: value?.id, relation: "returns" }),
      expect.objectContaining({ from: value?.id, to: prop?.id, relation: "passes" }),
    ]));
  });

  it("builds page:user scope from entry component through nested state and effects", () => {
    const scope = buildPageScope({ graph: scan.graph, flowIndex, pageId: "page:user" });
    const topologyNodes = new Set(scope?.topologyNodeIds ?? []);
    const topologyEdges = new Set(scope?.topologyEdgeIds ?? []);
    const shownNodes = scan.graph.nodes.filter((node) => topologyNodes.has(node.id));
    const shownEdges = scan.graph.edges.filter((edge) => topologyEdges.has(edge.id));

    expect(scope).toMatchObject({
      primaryComponentId: expect.stringContaining("#UserPage"),
      warnings: [],
      stats: {
        flowsCount: 5,
        gapsCount: 0,
      },
    });
    expect(shownNodes.map((node) => [node.type, node.name])).toEqual(expect.arrayContaining([
      ["component", "UserPage"],
      ["component", "UserProfileWidget"],
      ["component", "UserCard"],
      ["hook", "useUserProfile"],
      ["selector", "selectCurrentUser"],
      ["action", "user.touch"],
      ["thunk", "fetchUser"],
      ["slice-model", "user"],
      ["api", "useGetUserQuery"],
    ]));
    const shownEdgeTypes = new Set(shownEdges.map((edge) => edge.type));
    for (const expectedType of [
      "renders",
      "usesHook",
      "usesSelector",
      "dispatchesAction",
      "readsSlice",
      "writesSlice",
      "callsApi",
    ] as const) {
      expect(shownEdgeTypes.has(expectedType), `missing page-scope edge type: ${expectedType}`).toBe(true);
    }
    expect(scope?.flowNodeIds.some((id) =>
      flowIndex.nodes.find((node) => node.id === id)?.path === "state.user.current"
    )).toBe(true);
  });

  it("answers overview, flow, impact and evidence from one canonical query layer", () => {
    const page = nodeByTypeAndName(scan.graph.nodes, "page", "user");
    const selector = nodeByTypeAndName(scan.graph.nodes, "selector", "selectCurrentUser");
    const userCard = nodeByTypeAndName(scan.graph.nodes, "component", "UserCard");
    const overview = flowQueries.getPageOverview(page.id);
    const summary = overview?.flows.find((flow) => flow.subjectPath === "profile.name");
    const detail = summary ? flowQueries.getValueFlow(summary.id) : null;
    const journey = summary ? flowQueries.getValueJourney(summary.id) : null;
    const impact = flowQueries.getImpact(selector.id);
    const api = detail?.nodes.find((node) => node.kind === "api" && node.name.startsWith("GET "));

    expect(overview).toMatchObject({
      warnings: [],
      stats: { flowsCount: 5, completeFlowsCount: 2, partialFlowsCount: 0, gapsCount: 0 },
    });
    expect(detail?.subject.path).toBe("profile.name");
    expect(journey).toMatchObject({
      subject: { path: "profile.name" },
      isBranched: false,
      recommendedView: "steps",
    });
    expect(journey?.steps.map((step) => step.name)).toEqual([
      "GET /api/users/${userId}",
      "fetchUser.fulfilled",
      "state.user.current",
      "selectCurrentUser",
      "user",
      "useUserProfile.name",
      "profile.name",
      "UserCard.name",
    ]);
    expect(detail?.consumers).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "prop", name: "UserCard.name", ownerNodeId: userCard.id }),
    ]));
    // The hook-return derivation is a direct single-source read (high), so the
    // whole chain past the hook input is proven, and UserCard is proven-affected.
    expect(impact?.nodes.map((node) => node.name)).toEqual(expect.arrayContaining([
      "selectCurrentUser",
      "user",
      "useUserProfile.name",
      "profile.name",
      "UserCard.name",
    ]));
    expect(impact?.affectedOwnerNodeIds).toContain(userCard.id);
    expect(impact?.affectedPageIds.map((id) => scan.graph.nodes.find((node) => node.id === id)?.name)).toEqual([
      "activity-log-page",
      "archive-page",
      "user",
    ]);
    expect(summary).toBeDefined();
    expect(impact?.flowIds).toContain(summary!.id);
    expect(api).toBeDefined();
    expect(flowQueries.getEvidence(api!.id).length).toBeGreaterThan(0);
  });

  it("surfaces canonical source coverage and explicit gaps in the pages dashboard", () => {
    const dashboard = buildPagesDashboard(scan.graph, dashboardState(), undefined, flowQueries);
    const user = dashboard.rows.find((row) => row.pageId === "page:user");

    expect(user).toMatchObject({
      flowsCount: 5,
      sourceResolvedCount: 5,
      sourceCoveragePct: 100,
      originGapCount: 0,
    });
    expect(dashboard.rows.every((row) => row.flowsCount !== null)).toBe(true);
  });

  it("lists page flows as value → consumer → source rows for the Flows list (plan §2.3)", () => {
    const page = nodeByTypeAndName(scan.graph.nodes, "page", "user");
    const rows = buildPageFlowList(flowQueries, page.id);

    // One row per page flow, in the query layer's sort order, all badged.
    expect(rows.length).toBe(5);
    expect(rows.every((row) => row.completeness !== undefined)).toBe(true);

    const profileName = rows.find((row) => row.subjectName === "profile.name");
    expect(profileName).toMatchObject({ completeness: "complete", gapCount: 0 });
    // The row resolves the final consumer and a real source summary by name.
    expect(profileName?.consumerLabel).toContain("UserCard.name");
    expect(profileName?.sourceLabel.length).toBeGreaterThan(0);
    expect(profileName?.sourceLabel).not.toBe("—");

    // The sidebar search filter narrows the list cheaply over the same rows.
    expect(filterFlowListRows(rows, "profile.name").map((row) => row.subjectName)).toEqual(["profile.name"]);
    expect(filterFlowListRows(rows, "no-such-value")).toEqual([]);
  });

  it("builds the PM-018 page → unit → value route from canonical queries", () => {
    const page = nodeByTypeAndName(scan.graph.nodes, "page", "user");
    const structure = buildPageStructure(scan.graph, flowQueries, page.id);

    expect(structure?.root?.name).toBe("UserPage");
    const flattened = flattenStructure(structure?.root);
    expect(flattened.map((item) => [item.type, item.name])).toEqual(expect.arrayContaining([
      ["component", "UserProfileWidget"],
      ["component", "UserCard"],
      ["hook", "useUserProfile"],
    ]));

    const profile = flattened.find((item) => item.name === "UserProfileWidget");
    expect(profile?.valuesCount).toBeGreaterThan(0);
    const profileItems = flattenStructure(profile);
    const hookIndex = profileItems.findIndex((item) => item.name === "useUserProfile");
    const cardIndex = profileItems.findIndex((item) => item.name === "UserCard");
    expect(hookIndex).toBeGreaterThanOrEqual(0);
    expect(cardIndex).toBeGreaterThanOrEqual(0);
    expect(hookIndex).toBeLessThan(cardIndex);
    expect(profile?.children.map((item) => item.name)).toEqual(["useUserProfile", "Return"]);
    expect(flattenStructure(profile).filter((item) => item.name === "Logic")).toEqual([]);

    const contract = flowQueries.getSymbolContract(page.id, profile!.unitId!);
    const values = contract?.groups.flatMap((group) => group.values) ?? [];
    expect(contract).toMatchObject({
      symbol: { name: "UserProfileWidget", type: "component" },
      usedBy: [expect.objectContaining({ name: "UserPage", relation: "renders" })],
      stats: { resultsCount: 1, consumersCount: 1, issueCount: 0 },
    });
    expect(values).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "profile.name",
        coverage: expect.objectContaining({ origin: "proven", continuation: "proven" }),
        group: "results",
        origin: expect.arrayContaining([
          expect.objectContaining({ kind: "api", path: "/api/users/${userId}" }),
          expect.objectContaining({ kind: "state-field", path: "state.user.current" }),
          expect.objectContaining({ kind: "selector-result", name: "selectCurrentUser" }),
        ]),
        consumers: expect.arrayContaining([
          expect.objectContaining({ kind: "prop", name: "UserCard.name" }),
        ]),
      }),
    ]));
  });

  it("projects a hook as reads → derivations → returns → consumers with explicit effects", () => {
    const page = nodeByTypeAndName(scan.graph.nodes, "page", "user");
    const hook = nodeByTypeAndName(scan.graph.nodes, "hook", "useUserProfile");
    const contract = flowQueries.getSymbolContract(page.id, hook.id);
    const values = contract?.groups.flatMap((group) => group.values) ?? [];
    const returnedName = values.find((value) => value.name === "name");

    expect(contract).toMatchObject({
      symbol: { name: "useUserProfile", type: "hook" },
      usedBy: [expect.objectContaining({ name: "UserProfileWidget", relation: "usesHook" })],
      stats: {
        readsCount: 4,
        derivationsCount: 2,
        resultsCount: 2,
        effectsCount: 3,
        consumersCount: 1,
        issueCount: 0,
      },
    });
    expect(returnedName).toMatchObject({
      group: "results",
      derivationInputs: [expect.objectContaining({ name: "user" })],
      consumers: [expect.objectContaining({ name: "UserCard.name" })],
      directConsumers: [expect.objectContaining({ name: "profile.name", distance: 1 })],
      downstreamConsumers: [expect.objectContaining({ name: "UserCard.name", distance: 2 })],
      valueSemantics: {
        type: "string",
        transformation: expect.objectContaining({
          kind: "fallback",
          inputPaths: ["user.name"],
          expression: 'user?.name ?? "Unknown"',
        }),
      },
    });
    expect(returnedName?.origin.map((step) => step.kind)).toEqual([
      "api",
      "async-operation",
      "state-field",
      "selector-result",
    ]);
    expect(returnedName?.originEdges.map((edge) => edge.relation)).toEqual(expect.arrayContaining([
      "produces",
      "writes",
      "selects",
    ]));
    expect(returnedName?.originEdges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        relation: "writes",
        stateWrite: expect.objectContaining({
          statePath: "state.user.current",
          lifecycle: "fulfilled",
          valueOrigin: "payload",
        }),
      }),
    ]));
    expect(contract?.effects.map((effect) => effect.name)).toEqual([
      "fetchUser",
      "useGetUserQuery",
      "user.touch",
    ]);

    const overview = flowQueries.getSymbolOverview(page.id, hook.id);
    expect(overview).toMatchObject({
      symbolName: "useUserProfile",
      behavior: "effectful",
      stats: {
        dependenciesCount: 4,
        resultsCount: 2,
        effectsCount: 3,
      },
    });
    expect(overview?.stories).toEqual(expect.arrayContaining([
      expect.objectContaining({
        consumerName: "UserCard",
        outputs: [expect.objectContaining({
          name: "name",
          valueType: "string",
          role: "derived",
          transformation: expect.objectContaining({ kind: "fallback", inputPaths: ["user.name"] }),
        })],
      }),
    ]));
    expect(overview?.values.find((value) => value.name === "name")?.originSummary.map((step) => step.kind)).toEqual([
      "api",
      "state-field",
    ]);
    expect(overview?.values.find((value) => value.name === "name")?.originEdges.length).toBeGreaterThan(0);
    expect(overview?.consumerGroups).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: "direct", name: "UserProfileWidget" }),
      expect.objectContaining({ level: "downstream", name: "UserCard" }),
    ]));
  });

  it("restricts a single-flow trace to that flow's own nodes with labelled stages", () => {
    const page = nodeByTypeAndName(scan.graph.nodes, "page", "user");
    const summary = flowQueries.listPageFlows(page.id).find((flow) => flow.subjectPath === "profile.name");
    expect(summary).toBeDefined();
    const detail = flowQueries.getValueFlow(summary!.id);
    const flowNodeIds = new Set(detail?.nodes.map((node) => node.id) ?? []);

    const view = buildSingleFlowQueryView(scan.graph, flowQueries, summary!.id);
    const semanticIds = view.nodes.filter((node) => node.kind === "semantic-card").map((node) => node.id);

    // Only this flow's nodes are drawn — no other page flow leaks onto the canvas.
    expect(semanticIds.length).toBeGreaterThan(0);
    expect(semanticIds.every((id) => flowNodeIds.has(id))).toBe(true);
    expect(new Set(semanticIds).size).toBe(semanticIds.length);
    expect(view.nodes.some((node) => node.label === "fetchUser.fulfilled")).toBe(true);
    expect(view.nodes.some((node) => node.label === "fetchUser.pending")).toBe(false);

    // Every flow edge stays on the single-flow canvas, left→right.
    expect(view.edges.every((edge) => edge.flowEdge)).toBe(true);

    // Column stage headers make the trace readable (the "8 columns without any
    // identification" finding). Their labels come from per-node stages.
    const stageHeaders = view.nodes.filter((node) => node.kind === "stage-header");
    expect(stageHeaders.length).toBeGreaterThan(1);
    expect(stageHeaders.map((node) => node.label)).toEqual(expect.arrayContaining(["Network", "UI receiver"]));
    // Headers sit above the cards they label.
    const topCardY = Math.min(...view.nodes.filter((node) => node.kind === "semantic-card").map((node) => node.position.y));
    expect(stageHeaders.every((header) => header.position.y < topCardY)).toBe(true);
  });

  it("explains page operations through API, exact state writes and UI outcomes", () => {
    const page = nodeByTypeAndName(scan.graph.nodes, "page", "user");
    const actions = flowQueries.getPageActions(page.id);

    expect(actions?.operations.map((operation) => operation.operation.name)).toEqual([
      "user.touch",
      "fetchUser",
      "useGetUserQuery",
    ]);
    const fetchUser = actions?.operations.find((operation) => operation.operation.name === "fetchUser");
    expect(fetchUser).toMatchObject({
      detailLevel: "value-proven",
      initiators: [expect.objectContaining({ name: "useUserProfile", type: "hook" })],
      apiCalls: [expect.objectContaining({ name: "GET /api/users/${userId}" })],
    });
    expect(fetchUser?.stateChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "state.user.current", exact: true, lifecycle: "fulfilled" }),
    ]));
    expect(fetchUser?.uiOutcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "UserCard.name", type: "prop" }),
    ]));
    expect(fetchUser?.affectedValues.map((value) => value.path ?? value.name)).toContain("profile.name");
    expect(actions?.operations.find((operation) => operation.operation.name === "user.touch")?.detailLevel)
      .toBe("topology-only");
  });

  it("summarizes page change points and keeps possible impact separate", () => {
    const page = nodeByTypeAndName(scan.graph.nodes, "page", "user");
    const impact = flowQueries.getPageImpact(page.id);

    expect(impact?.groups.map((group) => group.stage)).toEqual([
      "source",
      "state",
      "operation",
      "logic",
    ]);
    expect(impact?.items.find((item) => item.target.name === "GET /api/users/${userId}")).toMatchObject({
      affectedValues: expect.arrayContaining([expect.objectContaining({ name: "profile.name" })]),
      uiOutcomes: expect.arrayContaining([expect.objectContaining({ name: "UserCard.name" })]),
    });
    expect(impact?.items.find((item) => item.target.path === "state.user.status")).toMatchObject({
      possibleSteps: [],
    });
    expect(impact?.stats.changePointsCount).toBeGreaterThan(3);
    expect(impact?.stats.affectedValuesCount).toBeGreaterThan(0);
  });

  it("summarizes page analysis quality without mixing Docs or E2E into the result", () => {
    const page = nodeByTypeAndName(scan.graph.nodes, "page", "user");
    const quality = flowQueries.getPageQuality(page.id);

    expect(quality?.values.totalCount).toBeGreaterThan(0);
    expect(quality?.origin.resolvedCount).toBeGreaterThan(0);
    expect(quality?.confidence.totalCount).toBeGreaterThan(0);
    expect(quality?.confidence).toMatchObject({ low: 0, unknown: 0 });
    expect(quality?.status).toBe("complete");
    expect(quality?.evidence.nodesWithEvidenceCount).toBeGreaterThan(0);
    expect(quality?.issues.pageId).toBe(page.id);
  });

  it("connects page:user to its component, hook, selector, state, thunk and API flow", () => {
    const page = nodeByTypeAndName(scan.graph.nodes, "page", "user");
    const view = buildPageFlowQueryView(scan.graph, flowQueries, page.id);
    const shownTypes = new Set(view.nodes.map((node) => node.nodeType));

    expect(view.edges.length).toBeGreaterThan(0);
    for (const expectedType of [
      "component",
      "hook",
      "selector",
      "slice-model",
      "thunk",
      "api",
    ]) {
      expect(shownTypes.has(expectedType), `missing page-flow node type: ${expectedType}`).toBe(true);
    }
    const api = view.nodes.find((node) => node.dataFlow?.stage === "Network");
    const receiver = view.nodes.find((node) => node.dataFlow?.stage === "UI receiver");
    expect(api?.position.x).toBeLessThan(receiver?.position.x ?? 0);
    expect(receiver?.dataFlow?.inputs).toContain("name: profile.name");
    expect(view.edges.every((edge) => edge.flowEdge)).toBe(true);
  });

  it("lifts nested hook state and effects into the page dossier", () => {
    const page = nodeByTypeAndName(scan.graph.nodes, "page", "user");
    const dossier = buildPageDossier(scan.graph, page.id, flowQueries);
    const stateNames = dossier?.state.flatMap((group) => group.items.map((item) => item.name)) ?? [];

    expect(stateNames).toEqual(expect.arrayContaining([
      "selectCurrentUser",
      "user",
      "user.touch",
      "fetchUser",
      "useGetUserQuery",
    ]));
  });

  it("preserves profile.name from hook return through the real UserCard consumer", () => {
    const widget = nodeByTypeAndName(scan.graph.nodes, "component", "UserProfileWidget");
    const userCard = nodeByTypeAndName(scan.graph.nodes, "component", "UserCard");
    const usage = scan.facts.find((fact): fact is Extract<ProjectFact, { type: "hookReturnUsage" }> =>
      fact.type === "hookReturnUsage" &&
      fact.ownerNodeId === widget.id &&
      fact.targetName === "UserCard" &&
      fact.propName === "name"
    );

    expect(usage).toMatchObject({
      localName: "profile",
      sourceField: "name",
      targetNodeId: userCard.id,
    });

    const trace = buildValueTraceGraph(scan.facts, widget, "profile");
    expect(trace.nodes.map((node) => [node.kind, node.title])).toEqual(expect.arrayContaining([
      ["hook", "useUserProfile"],
      ["selector", "selectCurrentUser"],
      ["state", "state.user.current"],
      ["thunk", "fetchUser"],
      ["api", "GET /api/users/${userId}"],
    ]));
    expect(trace.nodes.some((node) => node.kind === "unresolved")).toBe(false);
  });

  it("keeps exact reducer assignments proven without lifecycle fan-out", () => {
    const operation = flowIndex.nodes.find((node) =>
      node.kind === "async-operation" && node.name === "fetchUser.fulfilled"
    );
    expect(operation).toBeDefined();
    const writes = flowIndex.edges.filter((edge) =>
      edge.from === operation!.id && edge.relation === "writes"
    );
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.every((edge) => edge.confidence === "high")).toBe(true);
    expect(writes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stateWrite: expect.objectContaining({
          statePath: "state.user.current",
          lifecycle: "fulfilled",
          valueOrigin: "payload",
        }),
      }),
    ]));

    const impact = flowQueries.getImpact(operation!.id);
    // Exact reducer assignments are evidence-backed proven writes.
    for (const edge of writes) {
      expect(impact?.nodeIds).toContain(edge.to);
      expect(impact?.edgeIds).toContain(edge.id);
    }
    expect(impact?.nodeIds).toContain(operation!.id);

    const pending = flowIndex.nodes.find((node) =>
      node.kind === "async-operation" && node.name === "fetchUser.pending"
    );
    const pendingWrites = flowIndex.edges.filter((edge) =>
      edge.from === pending?.id && edge.relation === "writes"
    );
    expect(pendingWrites.map((edge) => edge.stateWrite?.statePath)).not.toContain("state.user.current");

    // The selector-seeded chain is proven end to end: high selector/binding
    // edges reach the hook input, and the direct high hook-return derivation
    // carries it through to the UserCard prop, so UserCard is proven-affected.
    const selector = nodeByTypeAndName(scan.graph.nodes, "selector", "selectCurrentUser");
    const userCard = nodeByTypeAndName(scan.graph.nodes, "component", "UserCard");
    const provenImpact = flowQueries.getImpact(selector.id);
    expect(provenImpact?.nodes.map((node) => node.name)).toEqual(
      expect.arrayContaining(["selectCurrentUser", "user", "useUserProfile.name", "profile.name", "UserCard.name"])
    );
    expect(provenImpact?.affectedOwnerNodeIds).toContain(userCard.id);
    expect(provenImpact?.possibleAffectedOwnerNodeIds).not.toContain(userCard.id);
  });

  it("keeps every proven branch of a multi-source hook derivation", () => {
    const displayStatus = flowIndex.nodes.find((node) =>
      node.kind === "hook-return" && node.name === "useUserProfile.displayStatus"
    );
    expect(displayStatus).toBeDefined();
    const derives = flowIndex.edges.filter((edge) =>
      edge.to === displayStatus!.id && edge.relation === "derives"
    );
    expect(derives.length).toBeGreaterThan(0);
    expect(derives.every((edge) => edge.confidence === "medium")).toBe(true);

    // Seeded from the state field behind the inline selector, impact is proven
    // through every syntactically recorded branch of the returned expression.
    const stateField = flowIndex.nodes.find((node) =>
      node.kind === "state-field" && node.path === "state.user.status"
    );
    const hookInput = flowIndex.nodes.find((node) =>
      node.kind === "hook-input" && node.name === "status"
    );
    expect(stateField).toBeDefined();
    expect(hookInput).toBeDefined();
    const impact = flowQueries.getImpact(stateField!.id);
    expect(impact?.nodeIds).toContain(hookInput!.id);
    expect(impact?.nodeIds).toContain(displayStatus!.id);
    expect(impact?.possibleNodeIds).not.toContain(displayStatus!.id);
  });

  it("traces selectCurrentUser impact through hook return consumers to pages", () => {
    const selector = nodeByTypeAndName(scan.graph.nodes, "selector", "selectCurrentUser");
    const impact = flowQueries.getImpact(selector.id);
    const view = buildImpactQueryView(scan.graph, flowQueries, selector.id);
    // Proven and possible impact together form the full blast radius; the direct
    // high hook derivation now keeps UserCard/UserProfileWidget in the proven set.
    const titles = new Set([
      ...(impact?.nodes.map((node) => node.name) ?? []),
      ...(impact?.possibleNodes.map((node) => node.name) ?? []),
      ...([...(impact?.affectedOwnerNodeIds ?? []), ...(impact?.possibleAffectedOwnerNodeIds ?? [])]
        .flatMap((id) => scan.graph.nodes.find((node) => node.id === id)?.name ?? [])),
      ...([...(impact?.affectedPageIds ?? []), ...(impact?.possibleAffectedPageIds ?? [])]
        .flatMap((id) => scan.graph.nodes.find((node) => node.id === id)?.name ?? [])),
    ]);

    for (const expected of [
      "useUserProfile.name",
      "UserProfileWidget",
      "UserCard",
      "user",
      "activity-log-page",
      "archive-page",
    ]) {
      expect(titles.has(expected), `missing impact target: ${expected}`).toBe(true);
    }
    expect(view.nodes.filter((node) => node.kind === "page-card").map((node) => node.label)).toEqual([
      "activity-log-page",
      "archive-page",
      "user",
    ]);
  });
});

function nodeByTypeAndName(
  nodes: ProjectMapNode[],
  type: ProjectMapNode["type"],
  name: string
): ProjectMapNode {
  const node = nodes.find((entry) => entry.type === type && entry.name === name);
  expect(node, `missing ${type} node: ${name}`).toBeDefined();
  return node!;
}

function flattenTrace(root: TraceNode): TraceNode[] {
  return [root, ...root.children.flatMap(flattenTrace)];
}

function dashboardState(): GraphViewState {
  return {
    mode: "pages-overview",
    pageFocusTab: "structure",
    pagesView: "table",
    expandedNodeIds: new Set(),
    visibleEdgeTypes: new Set(),
    visibleLayers: new Set(["pages", "widgets", "features", "entities", "shared"]),
    showHooks: true,
    showRedux: true,
    showFiles: false,
    showImports: false,
    showUnknown: false,
    showEnrichmentEdges: true,
  };
}

function flattenStructure(root: PageStructureItem | null | undefined): PageStructureItem[] {
  if (!root) return [];
  return [root, ...root.children.flatMap((child) => flattenStructure(child))];
}
