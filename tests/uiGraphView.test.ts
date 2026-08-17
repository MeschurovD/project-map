import { describe, expect, it } from "vitest";
import type { EdgeType, ProjectMapEdge, ProjectMapGraph, ProjectMapNode } from "../src/graph/types.js";
import type { ProjectFact } from "../src/scanner/facts.js";
import { buildComponentValueFlowView } from "../src/ui/data-flow/buildComponentValueFlowView.js";
import { buildComponentSemanticSummary } from "../src/ui/data-flow/buildComponentSemanticSummary.js";
import { buildHookFlowView } from "../src/ui/data-flow/buildHookFlowView.js";
import { buildSelectorFlowView } from "../src/ui/data-flow/buildSelectorFlowView.js";
import { pruneEmptyNodes } from "../src/ui/graph-view/buildViewGraph.js";
import { buildPageDataFlowView } from "../src/ui/graph-view/buildPageDataFlowView.js";
import { buildPageDossier } from "../src/ui/graph-view/buildPageDossier.js";
import { buildPagesDashboard } from "../src/ui/graph-view/buildPagesDashboard.js";
import { buildPageFocusView } from "../src/ui/graph-view/buildPageFocusView.js";
import { buildPagesOverviewView } from "../src/ui/graph-view/buildPagesOverviewView.js";
import { collectDirectPageComposition } from "../src/ui/graph-view/collectDirectPageComposition.js";
import { collectNodeInternals } from "../src/ui/graph-view/collectNodeInternals.js";
import { collectReachableSemanticNodes } from "../src/ui/graph-view/collectReachableNodes.js";
import { groupByFsdLayer } from "../src/ui/graph-view/groupByFsdLayer.js";
import {
  DEFAULT_VISIBLE_EDGE_TYPES,
  type GraphViewState,
} from "../src/ui/graph-view/viewTypes.js";

const graph = createGraph();

describe("groupByFsdLayer", () => {
  it("groups nodes by focus FSD layers", () => {
    const groups = groupByFsdLayer([
      node("widget:profile", "widget", "ProfileWidget", "widgets"),
      node("feature:user", "feature", "user", "features"),
      node("file:a", "file", "a.ts", "features"),
      node("external-package:react", "external-package", "react"),
    ]);

    expect(groups.widgets.map((entry) => entry.id)).toEqual(["widget:profile"]);
    expect(groups.features.map((entry) => entry.id)).toEqual(["file:a", "feature:user"]);
    expect(groups.entities).toEqual([]);
  });
});

describe("collectReachableSemanticNodes", () => {
  it("walks semantic edges and skips technical edges, files, and unknown nodes by default", () => {
    const reachable = collectReachableSemanticNodes(graph, "page:home", {
      showFiles: false,
      showHooks: true,
      showRedux: true,
      showUnknown: false,
    });

    expect(reachable.map((entry) => entry.id)).toContain("widget:profile");
    expect(reachable.map((entry) => entry.id)).toContain("hook:useProfile");
    expect(reachable.map((entry) => entry.id)).toContain("selector:selectUser");
    expect(reachable.map((entry) => entry.id)).not.toContain("file:home");
    expect(reachable.map((entry) => entry.id)).not.toContain("component:unknown:Button");
  });
});

describe("buildPagesOverviewView", () => {
  it("returns only page cards with semantic stats and no edges", () => {
    const view = buildPagesOverviewView(graph, defaultState());

    expect(view.nodes).toHaveLength(1);
    expect(view.nodes[0]?.id).toBe("page:home");
    expect(view.nodes[0]?.kind).toBe("page-card");
    expect(view.nodes[0]?.stats).toMatchObject({
      widgets: 1,
      features: 1,
      entities: 1,
      shared: 1,
      hooks: 1,
      redux: 1,
    });
    expect(view.edges).toEqual([]);
  });

  it("groups nested pages by the common folder under pages", () => {
    const view = buildPagesOverviewView(createNestedPagesGraph(), defaultState());

    expect(view.nodes.map((entry) => entry.id)).toEqual([
      "folder:pages:examples",
      "page:activity-log-page",
      "page:archive-page",
      "page:user",
    ]);
    expect(view.nodes.find((entry) => entry.id === "folder:pages:examples")?.kind).toBe("folder-card");
    expect(view.nodes.find((entry) => entry.id === "folder:pages:examples")?.count).toBe(2);
    expect(view.edges.map((entry) => [entry.from, entry.to])).toEqual([
      ["folder:pages:examples", "page:activity-log-page"],
      ["folder:pages:examples", "page:archive-page"],
    ]);
  });
});

describe("buildPageFocusView", () => {
  it("creates contentful composition groups for a selected page", () => {
    const view = buildPageFocusView(graph, "page:home", defaultState());

    expect(view.nodes.map((entry) => entry.id)).toEqual([
      "page:home",
      "group:page:home:widgets",
      "widget:profile",
    ]);
    expect(view.nodes.find((entry) => entry.id === "group:page:home:widgets")?.count).toBe(1);
    expect(view.nodes.find((entry) => entry.id === "group:page:home:widgets")?.badgeLabel).toBe("widgets 1");
    expect(view.nodes.find((entry) => entry.id === "group:page:home:features")).toBeUndefined();
    expect(view.nodes.find((entry) => entry.id === "group:page:home:entities")).toBeUndefined();
  });

  it("shows page composition children without expanding groups", () => {
    const view = buildPageFocusView(graph, "page:home", defaultState());
    expect(view.nodes.map((entry) => entry.id)).toContain("widget:profile");
    expect(view.edges.some((edge) => edge.from === "group:page:home:widgets" && edge.to === "widget:profile")).toBe(true);
  });
});

describe("collectDirectPageComposition", () => {
  it("uses direct page component edges and ignores transitive store dependencies", () => {
    const compositionGraph = createDirectCompositionGraph();
    const composition = collectDirectPageComposition(compositionGraph, "page:record-info-page");

    expect(composition.widgets.map((entry) => entry.name)).toEqual(["RecordInfo"]);
    expect(composition.features.map((entry) => entry.name)).toEqual(["DeleteRecord", "SyncPreferences"]);
    expect(composition.entities).toEqual([]);
    expect(composition.selectors.map((entry) => entry.name)).toEqual([
      "selectFeatureSyncVisible",
      "selectPrimaryActionVisible",
    ]);
    expect(composition.external.map((entry) => entry.name)).toEqual(["Gap", "Space"]);
  });

  it("keeps page focus counts based on direct composition", () => {
    const compositionGraph = createDirectCompositionGraph();
    const view = buildPageFocusView(compositionGraph, "page:record-info-page", defaultState());

    expect(view.nodes.find((entry) => entry.id === "group:page:record-info-page:widgets")?.count).toBe(1);
    expect(view.nodes.find((entry) => entry.id === "group:page:record-info-page:features")?.count).toBe(2);
    expect(view.nodes.find((entry) => entry.id === "group:page:record-info-page:entities")).toBeUndefined();
    expect(view.nodes.find((entry) => entry.id === "group:page:record-info-page:shared")).toBeUndefined();
    expect(view.nodes.find((entry) => entry.id === "group:page:record-info-page:external")).toBeUndefined();
    expect(view.nodes.find((entry) => entry.id === "widget:record-info")).toBeDefined();
    expect(view.nodes.find((entry) => entry.id === "feature:delete-record")).toBeDefined();
    expect(view.nodes.find((entry) => entry.id === "feature:sync-preferences")).toBeDefined();
    expect(view.nodes.find((entry) => entry.id === "group:page:record-info-page:selectors")?.badgeLabel).toBe("selectors 2");
  });

  it("keeps source evidence on page focus nodes and view edges", () => {
    const compositionGraph = createDirectCompositionGraph();
    const view = buildPageFocusView(compositionGraph, "page:record-info-page", defaultState());

    const deleteRecord = view.nodes.find((entry) => entry.id === "feature:delete-record");
    const deleteRecordEdge = view.edges.find((entry) =>
      entry.from === "group:page:record-info-page:features" &&
      entry.to === "feature:delete-record"
    );
    const selector = view.nodes.find((entry) => entry.id === "selector:delete");

    expect(deleteRecord?.reasonEdges?.[0]?.type).toBe("renders");
    expect(deleteRecord?.reasonEdges?.[0]?.evidence[0]).toMatchObject({
      file: "src/pages/examples/record-info-page/ui/RecordInfoPage.tsx",
      line: 22,
      code: "{shouldDeleteButtonShown && <DeleteRecord />}",
    });
    expect(deleteRecordEdge?.sourceEdge?.id).toBe(deleteRecord?.reasonEdges?.[0]?.id);
    expect(selector?.reasonEdges?.[0]?.type).toBe("usesSelector");
    expect(selector?.reasonEdges?.[0]?.evidence[0]).toMatchObject({
      code: "useAppSelector(selectPrimaryActionVisible)",
    });
  });

  it("adds internals column for the selected page composition node", () => {
    const compositionGraph = createDirectCompositionGraph();
    const state = defaultState();
    state.inspectedNodeId = "widget:record-info";
    const view = buildPageFocusView(compositionGraph, "page:record-info-page", state);

    const renderedInternal = view.nodes.find((entry) => entry.id === "internal:widget:record-info:renders:component:edit-display-options");
    const actionInternal = view.nodes.find((entry) => entry.id === "internal:widget:record-info:actions:action:record.update");

    const uiGroup = view.nodes.find((entry) => entry.id === "internal-group:widget:record-info:renders");
    const actionGroup = view.nodes.find((entry) => entry.id === "internal-group:widget:record-info:actions");

    expect(uiGroup).toMatchObject({ kind: "group-card", label: "UI children", position: { x: 980 } });
    expect(actionGroup).toMatchObject({ kind: "group-card", label: "Actions", position: { x: 980 } });
    expect(renderedInternal?.position.x).toBe(1300);
    expect(actionInternal?.position.x).toBe(1300);
    expect(view.edges.some((edge) =>
      edge.from === "internal-group:widget:record-info:renders" &&
      edge.to === "internal:widget:record-info:renders:component:edit-display-options" &&
      edge.label === "renders"
    )).toBe(true);
    expect(view.edges.some((edge) =>
      edge.from === "internal-group:widget:record-info:actions" &&
      edge.to === "internal:widget:record-info:actions:action:record.update" &&
      edge.label === "dispatches"
    )).toBe(true);
  });

  it("keeps nested inspected nodes under their page composition parent", () => {
    const nestedGraph = createNestedInspectionGraph();
    const state = defaultState();
    state.inspectedNodeId = "hook:use-feature-panel";
    const view = buildPageFocusView(nestedGraph, "page:checkout", state);

    const panel = view.nodes.find((entry) => entry.sourceNode?.id === "component:feature-panel");
    const hook = view.nodes.find((entry) => entry.sourceNode?.id === "hook:use-feature-panel");
    const uiChild = view.nodes.find((entry) => entry.sourceNode?.id === "component:panel-child");

    expect(panel?.position.x).toBe(1300);
    expect(hook?.position.x).toBe(1950);
    expect(uiChild?.position.x).toBe(1950);
    expect(view.edges.some((edge) => edge.from === "page:checkout" && edge.to === "hook:use-feature-panel")).toBe(false);
    expect(view.edges.some((edge) =>
      edge.from === "internal-group:feature:checkout:renders" &&
      edge.to === panel?.id
    )).toBe(true);
    expect(view.edges.some((edge) =>
      edge.from === "internal-group:component:feature-panel:hooks" &&
      edge.to === hook?.id
    )).toBe(true);
    expect(view.edges.some((edge) =>
      edge.from === "internal-group:component:feature-panel:renders" &&
      edge.to === uiChild?.id
    )).toBe(true);
  });

  it("adds readable summary badges to page and semantic cards", () => {
    const compositionGraph = createDirectCompositionGraph();
    const view = buildPageFocusView(compositionGraph, "page:record-info-page", defaultState());

    expect(view.nodes.find((entry) => entry.id === "page:record-info-page")?.summaryBadges).toEqual([
      "widgets 1",
      "features 2",
      "selectors 2",
    ]);
    expect(view.nodes.find((entry) => entry.id === "widget:record-info")?.summaryBadges).toEqual([
      "renders 2",
      "hooks 1",
      "redux 2",
    ]);
  });
});

describe("buildPagesDashboard", () => {
  it("builds a row per page with dependency counts and docs coverage", () => {
    const dashboard = buildPagesDashboard(graph, defaultState(), new Map([
      ["widget:profile", [{ badges: [{ id: "docs" }] }]],
    ]));

    expect(dashboard.rows).toHaveLength(1);
    const row = dashboard.rows[0]!;
    expect(row).toMatchObject({ pageId: "page:home", name: "home", widgets: 1, features: 1, entities: 1 });
    // Reachable products: widget:profile, feature:user, entity:user — one documented.
    expect(row.components).toBe(3);
    expect(row.docsPct).toBe(33);
    expect(row.e2ePct).toBe(0);
    expect(row).toMatchObject({
      flowsCount: null,
      sourceCoveragePct: null,
      sourceResolvedCount: null,
      originGapCount: null,
    });
  });

  it("adds source coverage and explicit origin gaps from canonical page overview", () => {
    const dashboard = buildPagesDashboard(graph, defaultState(), undefined, {
      getPageOverview: () => ({
        stats: { flowsCount: 4, originResolvedFlowsCount: 3, originGapFlowsCount: 1 },
      }),
    });

    expect(dashboard.rows[0]).toMatchObject({
      flowsCount: 4,
      sourceResolvedCount: 3,
      sourceCoveragePct: 75,
      originGapCount: 1,
    });
  });

  // The sidebar search box filters the pages table via this query parameter
  // (PM-014 wiring fix). "find a page" only — symbol search stays in Cmd+K.
  it("shows every page when the query is empty or whitespace", () => {
    expect(buildPagesDashboard(graph, defaultState()).rows).toHaveLength(1);
    expect(buildPagesDashboard(graph, defaultState(), undefined, undefined, "").rows).toHaveLength(1);
    expect(buildPagesDashboard(graph, defaultState(), undefined, undefined, "   ").rows).toHaveLength(1);
  });

  it("filters pages by name and is case-insensitive", () => {
    const lower = buildPagesDashboard(graph, defaultState(), undefined, undefined, "home");
    const upper = buildPagesDashboard(graph, defaultState(), undefined, undefined, "HOME");
    const partial = buildPagesDashboard(graph, defaultState(), undefined, undefined, "om");

    expect(lower.rows.map((row) => row.name)).toEqual(["home"]);
    expect(upper.rows.map((row) => row.name)).toEqual(["home"]);
    expect(partial.rows.map((row) => row.name)).toEqual(["home"]);
  });

  it("returns no rows for a query that matches nothing", () => {
    expect(buildPagesDashboard(graph, defaultState(), undefined, undefined, "no-such-page").rows).toEqual([]);
  });
});

describe("buildPageDossier", () => {
  const graph = createDirectCompositionGraph();

  it("groups composition with evidence and the page's state dependencies", () => {
    const dossier = buildPageDossier(graph, "page:record-info-page")!;

    expect(dossier.page.name).toBe("record-info-page");
    expect(dossier.composition.map((group) => group.key)).toEqual(["widgets", "features"]);
    expect(dossier.composition.find((g) => g.key === "features")?.items.map((i) => i.name)).toEqual(["DeleteRecord", "SyncPreferences"]);

    const deleteRecord = dossier.composition.find((g) => g.key === "features")?.items.find((i) => i.name === "DeleteRecord");
    expect(deleteRecord?.relation).toBe("renders");
    expect(deleteRecord?.evidence).toMatchObject({ line: 22, code: "{shouldDeleteButtonShown && <DeleteRecord />}" });

    const selectors = dossier.state.find((g) => g.key === "selectors");
    expect(selectors?.items.map((i) => i.name)).toEqual([
      "selectFeatureData",
      "selectFeatureSyncVisible",
      "selectPrimaryActionVisible",
    ]);
    expect(dossier.state.find((g) => g.key === "actions")?.items.map((i) => i.name)).toEqual(["record.update"]);
  });

  it("returns null for an unknown page id", () => {
    expect(buildPageDossier(graph, "page:nope")).toBeNull();
  });
});

describe("pruneEmptyNodes", () => {
  it("drops label-less semantic cards (ghost nodes) and their dangling edges", () => {
    const pruned = pruneEmptyNodes({
      nodes: [
        { id: "a", kind: "semantic-card", label: "A", position: { x: 0, y: 0 } },
        { id: "ghost", kind: "semantic-card", label: "  ", position: { x: 100, y: 0 } },
        { id: "g", kind: "group-card", label: "", count: 2, position: { x: 0, y: 0 } },
      ],
      edges: [
        { id: "a-ghost", from: "a", to: "ghost", type: "view" },
        { id: "g-a", from: "g", to: "a", type: "view" },
      ],
    });

    expect(pruned.nodes.map((node) => node.id)).toEqual(["a", "g"]); // group cards kept even with empty label
    expect(pruned.edges.map((edge) => edge.id)).toEqual(["g-a"]); // edge into the ghost is dropped
  });

  it("returns the same reference when there is nothing to prune", () => {
    const view = { nodes: [{ id: "a", kind: "semantic-card" as const, label: "A", position: { x: 0, y: 0 } }], edges: [] };
    expect(pruneEmptyNodes(view)).toBe(view);
  });
});

describe("buildPageDataFlowView", () => {
  const compositionGraph = createDirectCompositionGraph();
  const page = compositionGraph.nodes.find((entry) => entry.id === "page:record-info-page")!;

  it("places nodes in flow-role columns and keeps only data-flow edges", () => {
    const view = buildPageDataFlowView(compositionGraph, page, defaultState());
    const at = (id: string) => view.nodes.find((entry) => entry.id === id);

    // Consumers in column 0, selectors in column 2, actions in column 4.
    expect(at("page:record-info-page")?.position.x).toBe(0);
    expect(at("widget:record-info")?.position.x).toBe(0);
    expect(at("selector:record-info")?.position.x).toBe(720);
    expect(at("action:record.update")?.position.x).toBe(1440);

    // Flow edges kept; composition edges (renders) dropped.
    expect(view.edges.some((edge) => edge.from === "widget:record-info" && edge.to === "selector:record-info")).toBe(true);
    expect(view.edges.some((edge) => edge.from === "widget:record-info" && edge.to === "action:record.update")).toBe(true);
    expect(view.edges.some((edge) => edge.sourceEdge?.type === "renders")).toBe(false);
  });

  it("does not reconstruct page flow without canonical queries", () => {
    const view = buildPageFocusView(compositionGraph, "page:record-info-page", {
      ...defaultState(),
      pageFocusTab: "data-flow",
    });

    expect(view).toEqual({ nodes: [], edges: [] });
  });

  it("hides redux nodes when Redux is toggled off", () => {
    const view = buildPageDataFlowView(compositionGraph, page, { ...defaultState(), showRedux: false });
    expect(view.nodes.some((entry) => entry.nodeType === "selector")).toBe(false);
  });
});

describe("collectNodeInternals", () => {
  it("groups direct outgoing and incoming semantic links for an inspected node", () => {
    const compositionGraph = createDirectCompositionGraph();
    const internals = collectNodeInternals(compositionGraph, "widget:record-info", {
      showFiles: false,
      showImports: false,
      showUnknown: false,
    });

    expect(internals.renderedComponents.map((entry) => entry.name)).toEqual([
      "EditDisplayOptions",
      "ProfileForm",
    ]);
    expect(internals.hooks.map((entry) => entry.name)).toEqual(["useRecordInfo"]);
    expect(internals.selectors.map((entry) => entry.name)).toEqual(["selectFeatureData"]);
    expect(internals.actions.map((entry) => entry.name)).toEqual(["record.update"]);
    expect(internals.usedBy.map((entry) => entry.name)).toContain("RecordInfoPage");
  });
});

describe("buildHookFlowView", () => {
  const hookGraph: ProjectMapGraph = {
    schemaVersion: "1.1.0",
    project: { name: "record", root: "/record", sourceRoot: "src" },
    nodes: [
      node("hook:record-info", "hook", "useRecordInfo", "entities", undefined, "src/entities/record/model/useRecordInfo.ts"),
      node("selector:record-info", "selector", "selectFeatureData", "entities"),
      node("action:record.refresh", "action", "record.refresh", "entities"),
    ],
    edges: [
      edge("hook:record-info", "selector:record-info", "usesSelector"),
      edge("hook:record-info", "action:record.refresh", "dispatchesAction"),
    ],
    stats: { nodesCount: 3, edgesCount: 2 },
  };
  const hook = hookGraph.nodes.find((entry) => entry.id === "hook:record-info")!;
  const facts: ProjectFact[] = [
    { type: "hookDeclarationShape", hookName: "useRecordInfo", file: "src/entities/record/model/useRecordInfo.ts", params: [], returnShape: { kind: "object", fields: ["data", "isLoading"] }, confidence: "high" },
    { type: "hookReturnUsage", owner: "ProfileForm", ownerNodeId: "component:details-form", hookName: "useRecordInfo", localName: "data", sourceField: "data", usageKind: "prop", targetName: "ProfileForm", propName: "values", file: "src/widgets/record-info/ui/ProfileForm.tsx", confidence: "high" },
    { type: "hookReturnUsage", owner: "ProfileForm", ownerNodeId: "component:details-form", hookName: "useRecordInfo", localName: "isLoading", sourceField: "isLoading", usageKind: "prop", targetName: "ProfileForm", propName: "loading", file: "src/widgets/record-info/ui/ProfileForm.tsx", confidence: "high" },
  ];

  it("lays out internal deps → hook → returned values → consumers in columns", () => {
    const view = buildHookFlowView(hookGraph, facts, hook);
    const at = (id: string) => view.nodes.find((entry) => entry.id === id);

    // Internal reads on the left, hook in the middle.
    expect(at("hook-flow:hook:record-info:dep:selector:record-info")?.position.x).toBe(0);
    expect(at("hook:record-info")?.position.x).toBe(360);
    // Returned values, then their destinations.
    expect(at("hook-flow:hook:record-info:return:data")?.position.x).toBe(720);
    expect(at("hook-flow:hook:record-info:return:isLoading")?.position.x).toBe(720);
    expect(at("hook-flow:hook:record-info:usage:data:0")?.position.x).toBe(1080);
  });

  it("wires selector→hook, hook→return and return→usage edges", () => {
    const view = buildHookFlowView(hookGraph, facts, hook);
    const has = (from: string, to: string) => view.edges.some((e) => e.from === from && e.to === to);

    expect(has("hook-flow:hook:record-info:dep:selector:record-info", "hook:record-info")).toBe(true);
    expect(has("hook-flow:hook:record-info:dep:action:record.refresh", "hook:record-info")).toBe(true);
    expect(has("hook:record-info", "hook-flow:hook:record-info:return:data")).toBe(true);
    expect(has("hook-flow:hook:record-info:return:isLoading", "hook-flow:hook:record-info:usage:isLoading:0")).toBe(true);
  });

  it("links a returned value back to the selector it is computed from (point 4)", () => {
    const withDeps: ProjectFact[] = [
      ...facts,
      { type: "selectorBinding", owner: "useRecordInfo", selectorName: "selectFeatureData", localName: "data", file: "src/entities/record/model/useRecordInfo.ts", confidence: "high" },
      { type: "hookReturnDependency", hookName: "useRecordInfo", field: "data", dependsOn: ["data"], file: "src/entities/record/model/useRecordInfo.ts", confidence: "low" },
    ];
    const view = buildHookFlowView(hookGraph, withDeps, hook);

    expect(view.edges.some((e) =>
      e.from === "hook-flow:hook:record-info:dep:selector:record-info" &&
      e.to === "hook-flow:hook:record-info:return:data" &&
      e.label === "feeds"
    )).toBe(true);
  });
});

describe("data flow views", () => {
  it("groups createSelector inputs and uses semantic UI effect nodes", () => {
    const graph = createDirectCompositionGraph();
    const selector = graph.nodes.find((entry) => entry.id === "selector:sync")!;
    const view = buildSelectorFlowView(graph, selectorFlowFacts(), selector);

    expect(view.nodes.find((entry) => entry.nodeType === "input-selectors"))?.toMatchObject({
      label: "Input selectors (4)",
      summaryBadges: [
        "selectFeatureStatus",
        "selectFeatureId",
        "selectIsFeatureLoading",
        "selectViewerInfo",
      ],
    });
    expect(view.nodes.filter((entry) => entry.nodeType === "bound-value" && entry.label === "shouldSyncPreferencesButtonShown")).toHaveLength(1);
    expect(view.nodes.find((entry) => entry.nodeType === "ui-effect"))?.toMatchObject({
      label: "Controls render: SyncPreferences",
    });
    expect(view.nodes.some((entry) => entry.label === "condition")).toBe(false);
  });

  it("groups component values by role with destinations as nodes (overview)", () => {
    const graph = createHookConsumerGraph();
    const component = graph.nodes.find((entry) => entry.id === "feature:delete-record")!;
    const view = buildComponentValueFlowView(graph, hookFlowFacts(), component);

    const isModalOpen = view.nodes.find((entry) => entry.label === "isModalOpen");
    expect(isModalOpen?.nodeType).toBe("bound-value");
    expect(isModalOpen?.subtitle).toBe("← useDeleteRecord");
    // No sourceNode on value cards (keeps docs summaries off every value).
    expect(isModalOpen?.sourceNode).toBeUndefined();

    // Destinations are nodes linked from the value, not text badges.
    const dest = view.nodes.find((entry) => entry.label === "Passed to DeleteRecordModal.open");
    expect(dest?.nodeType).toBe("ui-effect");
    expect(view.edges.some((edge) => edge.from === isModalOpen?.id && edge.to === dest?.id)).toBe(true);

    expect(view.nodes.some((entry) => entry.kind === "group-card" && entry.label === "Handlers")).toBe(true);
  });

  it("expands a value's trace in place when its id is selected", () => {
    const graph = createDirectCompositionGraph();
    const component = graph.nodes.find((entry) => entry.id === "component:record-info-page#RecordInfoPage")!;
    const overview = buildComponentValueFlowView(graph, selectorFlowFacts(), component);
    const valueNode = overview.nodes.find((entry) => entry.nodeType === "bound-value");
    expect(valueNode).toBeDefined();

    const expanded = buildComponentValueFlowView(graph, selectorFlowFacts(), component, valueNode!.id);
    // No role group cards in the expanded trace view; the value sits at origin x=0.
    expect(expanded.nodes.some((entry) => entry.kind === "group-card")).toBe(false);
    expect(expanded.nodes.find((entry) => entry.id === valueNode!.id)?.position.x).toBe(0);
  });

  it("names the concrete children and actions in the component overview", () => {
    const graph = createDirectCompositionGraph();
    const widget = graph.nodes.find((entry) => entry.id === "widget:record-info")!;
    const summary = buildComponentSemanticSummary(graph, [], widget);

    expect(summary.overviewLines).toContainEqual({ kind: "rendersChildren", names: ["EditDisplayOptions", "ProfileForm"] });
    expect(summary.overviewLines).toContainEqual({ kind: "dispatchesActions", names: ["record.update"] });
  });

  it("groups component hook values by human summary categories", () => {
    const graph = createHookConsumerGraph();
    const component = graph.nodes.find((entry) => entry.id === "feature:delete-record")!;
    const summary = buildComponentSemanticSummary(graph, detailedHookFlowFacts(), component);

    expect(summary.overviewLines).toContainEqual({ kind: "usesHooks", names: ["useDeleteRecord"] });
    expect(summary.overviewLines).toContainEqual({ kind: "passesHandlers", names: ["Button.onClick"] });
    expect(summary.sections.find((section) => section.titleKey === "hookState")?.rows.map((row) => row.label)).toContain("isModalOpen");
    expect(summary.sections.find((section) => section.titleKey === "hookTexts")?.rows.map((row) => row.label)).toContain("buttonText");
    expect(summary.sections.find((section) => section.titleKey === "hookAvailability")?.rows.map((row) => row.label)).toContain("isButtonDisabled");
    expect(summary.sections.find((section) => section.titleKey === "hookHandlers")?.rows).toContainEqual(expect.objectContaining({
      label: "handleOpenModal",
      detail: "Button.onClick",
    }));
  });
});

function defaultState(): GraphViewState {
  return {
    mode: "pages-overview",
    pageFocusTab: "structure",
    pagesView: "cards",
    expandedNodeIds: new Set(),
    visibleEdgeTypes: new Set(DEFAULT_VISIBLE_EDGE_TYPES),
    visibleLayers: new Set(["app", "pages", "widgets", "features", "entities", "shared", "unknown"]),
    showHooks: true,
    showRedux: true,
    showFiles: false,
    showImports: false,
    showUnknown: false,
    showEnrichmentEdges: true,
  };
}

function createGraph(): ProjectMapGraph {
  return {
    schemaVersion: "1.1.0",
    project: {
      name: "fixture",
      root: "/fixture",
      sourceRoot: "src",
    },
    nodes: [
      node("page:home", "page", "home", "pages", undefined, "src/pages/home/ui/HomePage.tsx"),
      node("component:home#HomePage", "component", "HomePage", "pages", undefined, "src/pages/home/ui/HomePage.tsx"),
      node("file:home", "file", "HomePage.tsx", "pages"),
      node("widget:profile", "widget", "profile", "widgets"),
      node("feature:user", "feature", "user", "features"),
      node("entity:user", "entity", "user", "entities"),
      node("shared:ui", "shared", "ui", "shared"),
      node("hook:useProfile", "hook", "useProfile", "features"),
      node("selector:selectUser", "selector", "selectUser", "entities"),
      node("component:unknown:Button", "component", "Button", undefined, { unresolved: true }),
    ],
    edges: [
      edge("component:home#HomePage", "widget:profile", "renders"),
      edge("page:home", "widget:profile", "dependsOn"),
      edge("widget:profile", "feature:user", "dependsOn"),
      edge("feature:user", "entity:user", "dependsOn"),
      edge("entity:user", "shared:ui", "dependsOn"),
      edge("feature:user", "hook:useProfile", "usesHook"),
      edge("hook:useProfile", "selector:selectUser", "usesSelector"),
      edge("page:home", "file:home", "contains"),
      edge("widget:profile", "component:unknown:Button", "renders"),
    ],
    stats: {
      nodesCount: 9,
      edgesCount: 8,
    },
  };
}

function createDirectCompositionGraph(): ProjectMapGraph {
  return {
    schemaVersion: "1.1.0",
    project: {
      name: "record",
      root: "/record",
      sourceRoot: "src",
    },
    nodes: [
      node("page:record-info-page", "page", "record-info-page", "pages", undefined, "src/pages/examples/record-info-page/ui/RecordInfoPage.tsx"),
      node("component:record-info-page#RecordInfoPage", "component", "RecordInfoPage", "pages", undefined, "src/pages/examples/record-info-page/ui/RecordInfoPage.tsx"),
      node("widget:record-info", "widget", "RecordInfo", "widgets"),
      node("feature:sync-preferences", "feature", "SyncPreferences", "features"),
      node("feature:delete-record", "feature", "DeleteRecord", "features"),
      node("shared:redux", "shared", "redux", "shared"),
      node("entity:record", "entity", "Record", "entities"),
      node("entity:contract", "entity", "Contract", "entities"),
      node("selector:delete", "selector", "selectPrimaryActionVisible", "features"),
      node("selector:sync", "selector", "selectFeatureSyncVisible", "features"),
      node("component:edit-display-options", "component", "EditDisplayOptions", "widgets"),
      node("component:details-form", "component", "ProfileForm", "widgets"),
      node("hook:record-info", "hook", "useRecordInfo", "widgets"),
      node("selector:record-info", "selector", "selectFeatureData", "widgets"),
      node("action:record.update", "action", "record.update", "widgets"),
      node("component:unknown:Fragment", "component", "Fragment", undefined, { unresolved: true }),
      node("component:unknown:Gap", "component", "Gap", undefined, { unresolved: true }),
      node("component:unknown:Space", "component", "Space", undefined, { unresolved: true }),
    ],
    edges: [
      edge("component:record-info-page#RecordInfoPage", "widget:record-info", "renders"),
      edge("component:record-info-page#RecordInfoPage", "feature:sync-preferences", "renders"),
      edge(
        "component:record-info-page#RecordInfoPage",
        "feature:delete-record",
        "renders",
        "{shouldDeleteButtonShown && <DeleteRecord />}",
        22
      ),
      edge("component:record-info-page#RecordInfoPage", "component:unknown:Fragment", "renders"),
      edge("component:record-info-page#RecordInfoPage", "component:unknown:Gap", "renders"),
      edge("component:record-info-page#RecordInfoPage", "component:unknown:Space", "renders"),
      edge(
        "component:record-info-page#RecordInfoPage",
        "selector:delete",
        "usesSelector",
        "useAppSelector(selectPrimaryActionVisible)",
        18
      ),
      edge("component:record-info-page#RecordInfoPage", "selector:sync", "usesSelector"),
      edge("widget:record-info", "component:edit-display-options", "renders"),
      edge("widget:record-info", "component:details-form", "renders"),
      edge("widget:record-info", "hook:record-info", "usesHook"),
      edge("widget:record-info", "selector:record-info", "usesSelector"),
      edge("widget:record-info", "action:record.update", "dispatchesAction"),
      edge("page:record-info-page", "shared:redux", "dependsOn"),
      edge("shared:redux", "entity:record", "dependsOn"),
      edge("shared:redux", "entity:contract", "dependsOn"),
      edge("shared:redux", "widget:record-info", "dependsOn"),
    ],
    stats: {
      nodesCount: 13,
      edgesCount: 12,
    },
  };
}

function createNestedPagesGraph(): ProjectMapGraph {
  return {
    schemaVersion: "1.1.0",
    project: {
      name: "nested-pages",
      root: "/nested-pages",
      sourceRoot: "src",
    },
    nodes: [
      node("page:activity-log-page", "page", "activity-log-page", "pages", undefined, "src/pages/examples/activity-log-page/ui/ActivityLogPage.tsx"),
      node("page:archive-page", "page", "archive-page", "pages", undefined, "src/pages/examples/archive-page/ui/ArchivePage.tsx"),
      node("page:user", "page", "user", "pages", undefined, "src/pages/user/ui/UserPage.tsx"),
    ],
    edges: [],
    stats: {
      nodesCount: 3,
      edgesCount: 0,
    },
  };
}

function createNestedInspectionGraph(): ProjectMapGraph {
  return {
    schemaVersion: "1.1.0",
    project: {
      name: "checkout",
      root: "/checkout",
      sourceRoot: "src",
    },
    nodes: [
      node("page:checkout", "page", "checkout", "pages", undefined, "src/pages/checkout/ui/CheckoutPage.tsx"),
      node("component:checkout-page#CheckoutPage", "component", "CheckoutPage", "pages", undefined, "src/pages/checkout/ui/CheckoutPage.tsx"),
      node("feature:checkout", "feature", "CheckoutFeature", "features"),
      node("component:feature-panel", "component", "FeaturePanel", "features"),
      node("hook:use-feature-panel", "hook", "useFeaturePanel", "features"),
      node("component:panel-child", "component", "PanelChild", "features"),
    ],
    edges: [
      edge("component:checkout-page#CheckoutPage", "feature:checkout", "renders"),
      edge("feature:checkout", "component:feature-panel", "renders"),
      edge("component:feature-panel", "hook:use-feature-panel", "usesHook"),
      edge("component:feature-panel", "component:panel-child", "renders"),
    ],
    stats: {
      nodesCount: 6,
      edgesCount: 4,
    },
  };
}

function createHookConsumerGraph(): ProjectMapGraph {
  return {
    schemaVersion: "1.1.0",
    project: {
      name: "record",
      root: "/record",
      sourceRoot: "src",
    },
    nodes: [
      node("feature:delete-record", "component", "DeleteRecord", "features", undefined, "src/features/delete-record/ui/DeleteRecord.tsx"),
      node("hook:useDeleteRecord", "hook", "useDeleteRecord", "features", undefined, "src/features/delete-record/model/useDeleteRecord.ts"),
    ],
    edges: [],
    stats: {
      nodesCount: 2,
      edgesCount: 0,
    },
  };
}

function selectorFlowFacts(): ProjectFact[] {
  return [
    {
      type: "selectorStateRead",
      selectorName: "selectFeatureSyncVisible",
      file: "src/selectors.ts",
      derivedFromSelectors: ["selectFeatureStatus", "selectFeatureId", "selectIsFeatureLoading", "selectViewerInfo"],
      confidence: "medium",
    },
    {
      type: "selectorBinding",
      owner: "RecordInfoPage",
      ownerNodeId: "component:record-info-page#RecordInfoPage",
      selectorName: "selectFeatureSyncVisible",
      localName: "shouldSyncPreferencesButtonShown",
      file: "src/pages/examples/record-info-page/ui/RecordInfoPage.tsx",
      confidence: "high",
    },
    {
      type: "selectorBinding",
      owner: "RecordInfoPage",
      ownerNodeId: "component:record-info-page#RecordInfoPage",
      selectorName: "selectFeatureSyncVisible",
      localName: "shouldSyncPreferencesButtonShown",
      file: "src/pages/examples/record-info-page/ui/RecordInfoPage.tsx",
      confidence: "high",
    },
    {
      type: "localVariableUsage",
      owner: "RecordInfoPage",
      ownerNodeId: "component:record-info-page#RecordInfoPage",
      variableName: "shouldSyncPreferencesButtonShown",
      usageKind: "conditionalRender",
      targetName: "SyncPreferences",
      file: "src/pages/examples/record-info-page/ui/RecordInfoPage.tsx",
      confidence: "high",
    },
  ];
}

function hookFlowFacts(): ProjectFact[] {
  return [
    {
      type: "hookBinding",
      owner: "DeleteRecord",
      ownerNodeId: "feature:delete-record",
      hookName: "useDeleteRecord",
      arguments: [],
      boundTo: {
        kind: "objectDestructure",
        fields: [
          { sourceName: "isModalOpen", localName: "isModalOpen" },
          { sourceName: "handleOpenModal", localName: "handleOpenModal" },
        ],
      },
      file: "src/features/delete-record/ui/DeleteRecord.tsx",
      confidence: "high",
    },
    {
      type: "hookReturnUsage",
      owner: "DeleteRecord",
      ownerNodeId: "feature:delete-record",
      hookName: "useDeleteRecord",
      localName: "isModalOpen",
      sourceField: "isModalOpen",
      usageKind: "prop",
      targetName: "DeleteRecordModal",
      propName: "open",
      file: "src/features/delete-record/ui/DeleteRecord.tsx",
      confidence: "high",
    },
    {
      type: "hookReturnUsage",
      owner: "DeleteRecord",
      ownerNodeId: "feature:delete-record",
      hookName: "useDeleteRecord",
      localName: "handleOpenModal",
      sourceField: "handleOpenModal",
      usageKind: "eventHandler",
      targetName: "Button",
      propName: "onClick",
      file: "src/features/delete-record/ui/DeleteRecord.tsx",
      confidence: "high",
    },
  ];
}

function detailedHookFlowFacts(): ProjectFact[] {
  return [
    {
      type: "hookBinding",
      owner: "DeleteRecord",
      ownerNodeId: "feature:delete-record",
      hookName: "useDeleteRecord",
      arguments: [],
      boundTo: {
        kind: "objectDestructure",
        fields: [
          { sourceName: "isModalOpen", localName: "isModalOpen" },
          { sourceName: "buttonText", localName: "buttonText" },
          { sourceName: "isButtonDisabled", localName: "isButtonDisabled" },
          { sourceName: "handleOpenModal", localName: "handleOpenModal" },
        ],
      },
      file: "src/features/delete-record/ui/DeleteRecord.tsx",
      confidence: "high",
    },
    {
      type: "hookReturnUsage",
      owner: "DeleteRecord",
      ownerNodeId: "feature:delete-record",
      hookName: "useDeleteRecord",
      localName: "isModalOpen",
      sourceField: "isModalOpen",
      usageKind: "prop",
      targetName: "DeleteRecordModal",
      propName: "open",
      file: "src/features/delete-record/ui/DeleteRecord.tsx",
      confidence: "high",
    },
    {
      type: "hookReturnUsage",
      owner: "DeleteRecord",
      ownerNodeId: "feature:delete-record",
      hookName: "useDeleteRecord",
      localName: "buttonText",
      sourceField: "buttonText",
      usageKind: "prop",
      targetName: "Button",
      propName: "children",
      file: "src/features/delete-record/ui/DeleteRecord.tsx",
      confidence: "high",
    },
    {
      type: "hookReturnUsage",
      owner: "DeleteRecord",
      ownerNodeId: "feature:delete-record",
      hookName: "useDeleteRecord",
      localName: "isButtonDisabled",
      sourceField: "isButtonDisabled",
      usageKind: "prop",
      targetName: "Button",
      propName: "disabled",
      file: "src/features/delete-record/ui/DeleteRecord.tsx",
      confidence: "high",
    },
    {
      type: "hookReturnUsage",
      owner: "DeleteRecord",
      ownerNodeId: "feature:delete-record",
      hookName: "useDeleteRecord",
      localName: "handleOpenModal",
      sourceField: "handleOpenModal",
      usageKind: "eventHandler",
      targetName: "Button",
      propName: "onClick",
      file: "src/features/delete-record/ui/DeleteRecord.tsx",
      confidence: "high",
    },
  ];
}

function node(
  id: string,
  type: ProjectMapNode["type"],
  name: string,
  layer?: string,
  meta?: Record<string, unknown>,
  file?: string
): ProjectMapNode {
  return {
    id,
    type,
    name,
    ...(file ? { file } : {}),
    ...(layer ? { fsd: { layer } } : {}),
    ...(meta ? { meta } : {}),
  };
}

function edge(from: string, to: string, type: EdgeType, code?: string, line = 1): ProjectMapEdge {
  return {
    id: `edge:${from}:${type}:${to}`,
    from,
    to,
    type,
    confidence: "high",
    evidence: code ? [{
      file: "src/pages/examples/record-info-page/ui/RecordInfoPage.tsx",
      line,
      column: 1,
      code,
    }] : [],
  };
}
