import { describe, expect, it } from "vitest";
import { buildValueImpact, buildValueTrace, buildValueTraceGraph } from "../src/ui/data-flow/buildValueTrace.js";
import type { ProjectFact } from "../src/scanner/facts.js";
import type { ProjectMapNode } from "../src/graph/types.js";

const facts: ProjectFact[] = [
  {
    type: "selectorBinding",
    owner: "DeleteRecord",
    ownerNodeId: "component:delete-record",
    selectorName: "selectCanDelete",
    localName: "canDelete",
    file: "src/features/delete-record/ui/DeleteRecord.tsx",
    location: { line: 10, column: 1 },
    code: "const canDelete = useAppSelector(selectCanDelete)",
    confidence: "high",
  },
  {
    type: "selectorStateRead",
    selectorName: "selectCanDelete",
    file: "src/features/delete-record/model/selectors.ts",
    statePath: "state.record.permissions",
    location: { line: 5, column: 1 },
    code: "(state) => state.record.permissions.canDelete",
    confidence: "high",
  },
  {
    type: "sliceWrite",
    sliceName: "record",
    writerName: "fetchRecord",
    writerState: "fulfilled",
    file: "src/entities/record/model/slice.ts",
    location: { line: 3, column: 1 },
    code: "builder.addCase(fetchRecord.fulfilled, (s, a) => { s.permissions = a.payload })",
  },
  {
    type: "reduxThunk",
    name: "fetchRecord",
    typePrefix: "record/fetchRecord",
    apiCalls: [{ method: "GET", url: "/records/:id", code: "api.get(`/records/${id}`)", line: 9 }],
    file: "src/entities/record/model/thunks.ts",
    location: { line: 8, column: 1 },
  },
  {
    type: "selectorStateRead",
    selectorName: "selectFeatureAction",
    file: "src/features/delete-record/model/selectors.ts",
    derivedFromSelectors: ["selectCanDelete", "selectLoading"],
    location: { line: 9, column: 1 },
    confidence: "medium",
  },
];

const component: ProjectMapNode = { id: "component:delete-record", type: "component", name: "DeleteRecord" };

describe("buildValueTrace", () => {
  it("traces a bound value up through selector, state path, slice write and thunk", () => {
    const roots = buildValueTrace(facts, component);
    expect(roots).toHaveLength(1);

    const value = roots[0]!;
    expect(value).toMatchObject({ kind: "value", title: "canDelete" });

    const selector = value.children[0]!;
    expect(selector).toMatchObject({ kind: "selector", title: "selectCanDelete", relation: "from selector" });
    expect(selector.evidence?.code).toContain("useAppSelector(selectCanDelete)");

    const state = selector.children[0]!;
    expect(state).toMatchObject({ kind: "state", title: "state.record.permissions", relation: "reads" });

    const thunk = state.children[0]!;
    expect(thunk).toMatchObject({ kind: "thunk", title: "fetchRecord", relation: "written by" });
    expect(thunk.detail).toContain("fulfilled");
    expect(thunk.detail).toContain("record/fetchRecord");

    // The thunk's payload-creator HTTP call closes the chain at the endpoint.
    expect(thunk.children[0]).toMatchObject({ kind: "api", title: "GET /records/:id", relation: "calls api" });
    expect(thunk.children[0]!.evidence?.code).toContain("api.get");
  });

  it("stops honestly at a thunk with no detectable API call", () => {
    const noApi = facts.map((fact) =>
      fact.type === "reduxThunk" ? { ...fact, apiCalls: undefined } : fact
    );
    const [value] = buildValueTrace(noApi, component);
    const thunk = value!.children[0]!.children[0]!.children[0]!;
    expect(thunk.children[0]).toMatchObject({ kind: "unresolved" });
    expect(thunk.children[0]!.title).toContain("API");
  });

  it("expands a derived selector into its input selectors", () => {
    const selectorNode: ProjectMapNode = { id: "selector:feature-action", type: "selector", name: "selectFeatureAction" };
    const [root] = buildValueTrace(facts, selectorNode);

    expect(root).toMatchObject({ kind: "selector", title: "selectFeatureAction" });
    expect(root!.children.map((child) => ({ kind: child.kind, title: child.title, relation: child.relation }))).toEqual([
      { kind: "selector", title: "selectCanDelete", relation: "derived from" },
      { kind: "selector", title: "selectLoading", relation: "derived from" },
    ]);
    // selectCanDelete resolves on to its state path; selectLoading has no read -> unresolved.
    expect(root!.children[0]!.children[0]).toMatchObject({ kind: "state", title: "state.record.permissions" });
    expect(root!.children[1]!.children[0]).toMatchObject({ kind: "unresolved" });
  });

  it("enters a hook and traces the selectors it reads internally", () => {
    const hookFacts: ProjectFact[] = [
      {
        type: "hookReturnUsage",
        owner: "DeleteRecord",
        ownerNodeId: "component:delete-record",
        hookName: "useRecordActions",
        localName: "showButton",
        sourceField: "showButton",
        usageKind: "conditionalRender",
        file: "src/features/delete-record/ui/DeleteRecord.tsx",
        location: { line: 12, column: 1 },
        code: "const { showButton } = useRecordActions()",
        confidence: "high",
      },
      {
        type: "selectorBinding",
        owner: "useRecordActions",
        ownerNodeId: "hook:use-record-actions",
        selectorName: "selectCanDelete",
        localName: "canDelete",
        file: "src/features/delete-record/model/useRecordActions.ts",
        location: { line: 3, column: 1 },
        code: "const canDelete = useAppSelector(selectCanDelete)",
        confidence: "high",
      },
      {
        type: "selectorBinding",
        owner: "useRecordActions",
        ownerNodeId: "hook:use-record-actions",
        selectorName: "selectFeatureLoading",
        localName: "isLoading",
        file: "src/features/delete-record/model/useRecordActions.ts",
        location: { line: 4, column: 1 },
        code: "const isLoading = useAppSelector(selectFeatureLoading)",
        confidence: "high",
      },
      {
        type: "selectorStateRead",
        selectorName: "selectCanDelete",
        file: "src/entities/record/model/selectors.ts",
        statePath: "state.record.permissions",
        location: { line: 5, column: 1 },
        confidence: "high",
      },
    ];

    const [value] = buildValueTrace(hookFacts, component);
    const hook = value!.children[0]!;
    expect(hook).toMatchObject({ kind: "hook", title: "useRecordActions", relation: "from hook" });

    const childSummary = hook.children.map((child) => ({ kind: child.kind, title: child.title, relation: child.relation }));
    expect(childSummary).toEqual([
      { kind: "selector", title: "selectCanDelete", relation: "reads in hook" },
      { kind: "selector", title: "selectFeatureLoading", relation: "reads in hook" },
      { kind: "unresolved", title: "exact derivation inside hook not captured", relation: undefined },
    ]);
    // The internal selector still resolves on down to its state path.
    expect(hook.children[0]!.children[0]).toMatchObject({ kind: "state", title: "state.record.permissions" });
  });

  it("returns no roots for a component with no value-flow facts", () => {
    expect(buildValueTrace([], component)).toEqual([]);
  });
});

describe("buildValueTraceGraph", () => {
  it("builds a deduplicated graph from value to API with depth columns", () => {
    const { nodes, edges } = buildValueTraceGraph(facts, component, "canDelete");
    const byKey = new Map(nodes.map((node) => [node.key, node]));

    expect(byKey.get("value:canDelete")?.depth).toBe(0);
    expect(byKey.get("selector:selectCanDelete")?.depth).toBe(1);
    expect(byKey.get("state:state.record.permissions")?.depth).toBe(2);
    expect(byKey.get("thunk:fetchRecord")?.depth).toBe(3);
    expect(byKey.get("api:GET /records/:id")?.depth).toBe(4);

    expect(edges).toContainEqual({ from: "selector:selectCanDelete", to: "value:canDelete", label: "from selector" });
    expect(edges).toContainEqual({ from: "api:GET /records/:id", to: "thunk:fetchRecord", label: "calls api" });
  });

  it("deduplicates shared state/thunk reached via several selectors", () => {
    const shared: ProjectFact[] = [
      ...facts,
      { type: "selectorBinding", owner: "DeleteRecord", ownerNodeId: "component:delete-record", selectorName: "selectLoading", localName: "isLoading", file: "f", location: { line: 1, column: 1 }, confidence: "high" },
      { type: "selectorStateRead", selectorName: "selectLoading", file: "f", statePath: "state.record.loading", location: { line: 2, column: 1 }, confidence: "high" },
    ];
    // Both selectCanDelete and selectLoading sit in slice "record" → one fetchRecord thunk node, not two.
    const graph = buildValueTraceGraph(shared, component, "canDelete");
    expect(graph.nodes.filter((node) => node.key === "thunk:fetchRecord")).toHaveLength(1);
  });

  it("for a hook value, follows only the selectors the field depends on", () => {
    const hookFacts: ProjectFact[] = [
      { type: "hookReturnUsage", owner: "DeleteRecord", ownerNodeId: "component:delete-record", hookName: "useRecord", localName: "ready", sourceField: "ready", usageKind: "prop", file: "f", location: { line: 1, column: 1 }, confidence: "high" },
      { type: "selectorBinding", owner: "useRecord", selectorName: "selectCanDelete", localName: "canDelete", file: "f", location: { line: 2, column: 1 }, confidence: "high" },
      { type: "selectorBinding", owner: "useRecord", selectorName: "selectUnrelated", localName: "other", file: "f", location: { line: 3, column: 1 }, confidence: "high" },
      { type: "hookReturnDependency", hookName: "useRecord", field: "ready", dependsOn: ["ready", "canDelete"], file: "f", confidence: "low" },
    ];
    const graph = buildValueTraceGraph(hookFacts, component, "ready");
    const selectorKeys = graph.nodes.filter((node) => node.kind === "selector").map((node) => node.key);

    // Only the dependency's selector, not every selector the hook reads.
    expect(selectorKeys).toContain("selector:selectCanDelete");
    expect(selectorKeys).not.toContain("selector:selectUnrelated");
  });
});

describe("buildValueImpact", () => {
  const impactFacts: ProjectFact[] = [
    {
      type: "selectorBinding",
      owner: "DeleteRecord",
      ownerNodeId: "component:delete-record",
      selectorName: "selectCanDelete",
      localName: "canDelete",
      file: "src/features/delete-record/ui/DeleteRecord.tsx",
      location: { line: 10, column: 1 },
      code: "const canDelete = useAppSelector(selectCanDelete)",
      confidence: "high",
    },
    {
      type: "localVariableUsage",
      owner: "DeleteRecord",
      ownerNodeId: "component:delete-record",
      variableName: "canDelete",
      usageKind: "conditionalRender",
      targetName: "DeleteButton",
      file: "src/features/delete-record/ui/DeleteRecord.tsx",
      location: { line: 14, column: 1 },
      code: "{canDelete && <DeleteButton />}",
      confidence: "high",
    },
    {
      type: "selectorStateRead",
      selectorName: "selectFeatureAction",
      file: "src/features/delete-record/model/selectors.ts",
      derivedFromSelectors: ["selectCanDelete", "selectLoading"],
      location: { line: 9, column: 1 },
      confidence: "medium",
    },
  ];
  const selectorNode: ProjectMapNode = { id: "selector:can-delete", type: "selector", name: "selectCanDelete" };

  it("traces a selector down to where its value is used and to derived selectors", () => {
    const [root] = buildValueImpact(impactFacts, selectorNode);
    expect(root).toMatchObject({ kind: "selector", title: "selectCanDelete" });

    const value = root!.children.find((child) => child.kind === "value");
    expect(value).toMatchObject({ title: "canDelete", relation: "bound as", detail: "DeleteRecord" });
    expect(value!.children[0]).toMatchObject({ kind: "ui-effect", title: "DeleteButton", relation: "conditionalRender" });

    const feeds = root!.children.find((child) => child.relation === "feeds");
    expect(feeds).toMatchObject({ kind: "selector", title: "selectFeatureAction" });
  });

  it("returns no impact roots for a non-selector node", () => {
    expect(buildValueImpact(impactFacts, component)).toEqual([]);
  });
});
