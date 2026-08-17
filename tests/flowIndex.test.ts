import { describe, expect, it } from "vitest";
import { buildCoverageTransitionMatrix } from "../src/flow/coverage.js";
import { buildFlowIndex } from "../src/flow/buildFlowIndex.js";
import type { ProjectMapGraph } from "../src/graph/types.js";
import type { ProjectFact } from "../src/scanner/facts.js";

const graph: ProjectMapGraph = {
  schemaVersion: "1.1.0",
  project: { name: "flow-fixture", root: "/flow-fixture", sourceRoot: "src" },
  nodes: [
    { id: "selector:src/model/selectors#selectUser", type: "selector", name: "selectUser", file: "src/model/selectors.ts" },
    { id: "slice-model:user", type: "slice-model", name: "user", file: "src/model/slice.ts" },
    { id: "hook:src/model/useUser#useUser", type: "hook", name: "useUser", file: "src/model/useUser.ts" },
    { id: "hook:src/model/useProfile#useProfile", type: "hook", name: "useProfile", file: "src/model/useProfile.ts" },
    { id: "component:src/widgets/UserWidget#UserWidget", type: "component", name: "UserWidget", file: "src/widgets/UserWidget.tsx" },
    { id: "component:src/entities/UserCard#UserCard", type: "component", name: "UserCard", file: "src/entities/UserCard.tsx" },
    { id: "thunk:src/model/thunks#fetchUser", type: "thunk", name: "fetchUser", file: "src/model/thunks.ts" },
  ],
  edges: [{
    id: "edge:user-widget-renders-user-card",
    from: "component:src/widgets/UserWidget#UserWidget",
    to: "component:src/entities/UserCard#UserCard",
    type: "renders",
    confidence: "high",
    evidence: [],
  }],
  stats: { nodesCount: 7, edgesCount: 1 },
};

const metadata = {
  runId: "test-run",
  generatedAt: "2026-07-12T00:00:00.000Z",
  sourceFingerprint: "fixture-fingerprint",
};

describe("buildFlowIndex", () => {
  it("normalizes selector reads and bindings in source-to-consumer direction", () => {
    const facts: ProjectFact[] = [
      {
        type: "selectorStateRead",
        selectorName: "selectUser",
        file: "src/model/selectors.ts",
        statePath: "state.user.current",
        location: { file: "src/model/selectors.ts", line: 2, column: 1 },
        code: "state.user.current",
        confidence: "high",
      },
      {
        type: "selectorBinding",
        owner: "useUser",
        ownerNodeId: "hook:src/model/useUser#useUser",
        selectorName: "selectUser",
        localName: "user",
        file: "src/model/useUser.ts",
        location: { file: "src/model/useUser.ts", line: 4, column: 3 },
        code: "const user = useAppSelector(selectUser)",
        confidence: "high",
      },
    ];

    const index = buildFlowIndex({ graph, facts, metadata });
    const state = index.nodes.find((node) => node.kind === "state-field");
    const selector = index.nodes.find((node) => node.kind === "selector-result");
    const value = index.nodes.find((node) => node.kind === "hook-input");

    expect(index).toMatchObject({
      schemaVersion: "1.4.0",
      runId: "test-run",
      stats: { flowsCount: 1, completeFlowsCount: 0, gapsCount: 0 },
    });
    expect(state).toMatchObject({
      id: "state-field:slice-model:user#current",
      name: "state.user.current",
      ownerNodeId: "slice-model:user",
    });
    expect(selector).toMatchObject({
      id: "selector-result:selector:src/model/selectors#selectUser",
      ownerNodeId: "selector:src/model/selectors#selectUser",
    });
    expect(value).toMatchObject({
      id: "hook-input:hook:src/model/useUser#useUser#user",
      name: "user",
      ownerNodeId: "hook:src/model/useUser#useUser",
    });
    expect(index.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: state?.id, to: selector?.id, relation: "selects" }),
      expect.objectContaining({ from: selector?.id, to: value?.id, relation: "binds" }),
    ]));
    expect(index.flows[0]).toMatchObject({
      subjectNodeId: value?.id,
      completeness: "source-only",
      coverage: {
        origin: "proven",
        continuation: "terminal-at-unit",
        reasonCodes: [],
      },
      scopeNodeIds: [
        "hook:src/model/useUser#useUser",
        "selector:src/model/selectors#selectUser",
        "slice-model:user",
      ],
    });
  });

  it("binds a barrel-imported selector to its resolved declaration", () => {
    const barrelGraph: ProjectMapGraph = {
      ...graph,
      nodes: [
        ...graph.nodes,
        { id: "selector:src/model/index#selectUser", type: "selector", name: "selectUser", file: "src/model/index.ts" },
      ],
      edges: [
        ...graph.edges,
        {
          id: "edge:barrel-selector",
          from: "hook:src/model/useUser#useUser",
          to: "selector:src/model/index#selectUser",
          type: "usesSelector",
          confidence: "high",
          evidence: [],
        },
      ],
    };
    const facts: ProjectFact[] = [
      {
        type: "selectorStateRead",
        selectorName: "selectUser",
        file: "src/model/selectors.ts",
        statePath: "state.user.current",
        confidence: "high",
      },
      {
        type: "selectorBinding",
        owner: "useUser",
        ownerNodeId: "hook:src/model/useUser#useUser",
        selectorName: "selectUser",
        selectorFile: "src/model/selectors.ts",
        localName: "user",
        file: "src/model/useUser.ts",
        confidence: "high",
      },
    ];

    const index = buildFlowIndex({ graph: barrelGraph, facts, metadata });

    expect(index.nodes).toContainEqual(expect.objectContaining({
      id: "selector-result:selector:src/model/selectors#selectUser",
    }));
    expect(index.nodes.some((node) => node.kind === "gap")).toBe(false);
    expect(index.flows[0]?.coverage.origin).toBe("proven");
  });

  it("resolves an unambiguous cross-file selector composition", () => {
    const compositionGraph: ProjectMapGraph = {
      ...graph,
      nodes: [
        ...graph.nodes,
        { id: "selector:src/model/derived#selectReady", type: "selector", name: "selectReady", file: "src/model/derived.ts" },
      ],
    };
    const facts: ProjectFact[] = [
      {
        type: "selectorStateRead",
        selectorName: "selectUser",
        file: "src/model/selectors.ts",
        statePath: "state.user.current",
        confidence: "high",
      },
      {
        type: "selectorStateRead",
        selectorName: "selectReady",
        file: "src/model/derived.ts",
        derivedFromSelectors: ["selectUser"],
        confidence: "medium",
      },
      {
        type: "selectorBinding",
        owner: "useUser",
        ownerNodeId: "hook:src/model/useUser#useUser",
        selectorName: "selectReady",
        selectorFile: "src/model/derived.ts",
        localName: "ready",
        file: "src/model/useUser.ts",
        confidence: "high",
      },
    ];

    const index = buildFlowIndex({ graph: compositionGraph, facts, metadata });

    expect(index.nodes.some((node) => node.kind === "gap")).toBe(false);
    expect(index.edges).toContainEqual(expect.objectContaining({
      from: "selector-result:selector:src/model/selectors#selectUser",
      to: "selector-result:selector:src/model/derived#selectReady",
      relation: "derives",
    }));
    expect(index.flows[0]?.coverage.origin).toBe("proven");
  });

  it("creates a first-class gap when a selector binding has no recorded source", () => {
    const facts: ProjectFact[] = [{
      type: "selectorBinding",
      owner: "UserCard",
      ownerNodeId: "component:src/ui/UserCard#UserCard",
      selectorName: "selectMissing",
      localName: "missing",
      file: "src/ui/UserCard.tsx",
      location: { file: "src/ui/UserCard.tsx", line: 3, column: 3 },
      code: "const missing = useAppSelector(selectMissing)",
      confidence: "medium",
    }];

    const index = buildFlowIndex({ graph, facts, metadata });
    const gap = index.nodes.find((node) => node.kind === "gap");
    const flow = index.flows[0];

    expect(gap).toMatchObject({
      gap: { reasonCode: "selector-source-not-recorded" },
      confidence: "unknown",
    });
    expect(flow?.completeness).toBe("partial");
    expect(flow?.coverage).toMatchObject({
      origin: "gap",
      continuation: "terminal-at-unit",
      reasonCodes: ["selector-source-not-recorded"],
    });
    expect(flow?.nodeIds).toContain(gap?.id);
    expect(index.stats.gapsCount).toBe(1);
  });

  it("treats a constant selector as a local boundary instead of a gap", () => {
    const facts: ProjectFact[] = [
      {
        type: "selectorStateRead",
        selectorName: "selectUser",
        file: "src/model/selectors.ts",
        constant: true,
        confidence: "high",
      },
      {
        type: "selectorBinding",
        owner: "useUser",
        ownerNodeId: "hook:src/model/useUser#useUser",
        selectorName: "selectUser",
        selectorFile: "src/model/selectors.ts",
        localName: "user",
        file: "src/model/useUser.ts",
        confidence: "high",
      },
    ];

    const index = buildFlowIndex({ graph, facts, metadata });

    expect(index.nodes).toContainEqual(expect.objectContaining({ kind: "boundary" }));
    expect(index.nodes.some((node) => node.kind === "gap")).toBe(false);
    expect(index.flows[0]?.coverage.origin).toBe("boundary");
  });

  it("normalizes an inline selector state path without a source gap", () => {
    const facts: ProjectFact[] = [{
      type: "selectorBinding",
      owner: "useUser",
      ownerNodeId: "hook:src/model/useUser#useUser",
      selectorName: "inlineSelector:state.user.status",
      statePath: "state.user.status",
      localName: "status",
      file: "src/model/useUser.ts",
      location: { file: "src/model/useUser.ts", line: 5, column: 3 },
      code: "const status = useAppSelector((state) => state.user.status)",
      confidence: "medium",
    }];

    const index = buildFlowIndex({ graph, facts, metadata });
    const state = index.nodes.find((node) => node.kind === "state-field");
    const selector = index.nodes.find((node) => node.kind === "selector-result");
    const value = index.nodes.find((node) => node.kind === "hook-input");

    expect(state).toMatchObject({
      id: "state-field:slice-model:user#status",
      path: "state.user.status",
    });
    expect(selector).toMatchObject({ name: "inlineSelector:state.user.status" });
    expect(value).toMatchObject({ name: "status", path: "status" });
    expect(index.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: state?.id, to: selector?.id, relation: "selects" }),
      expect.objectContaining({ from: selector?.id, to: value?.id, relation: "binds" }),
    ]));
    expect(index.nodes.some((node) => node.kind === "gap")).toBe(false);
    expect(index.flows[0]).toMatchObject({ completeness: "source-only" });
    expect(index.flows[0]?.coverage).toMatchObject({
      origin: "proven",
      continuation: "terminal-at-unit",
    });
  });

  it("accounts for every legacy flow in the origin transition matrix", () => {
    const facts: ProjectFact[] = [
      {
        type: "selectorStateRead",
        selectorName: "selectUser",
        file: "src/model/selectors.ts",
        statePath: "state.user.current",
        confidence: "high",
      },
      {
        type: "selectorBinding",
        owner: "useUser",
        ownerNodeId: "hook:src/model/useUser#useUser",
        selectorName: "selectUser",
        localName: "user",
        file: "src/model/useUser.ts",
        confidence: "high",
      },
      {
        type: "selectorBinding",
        owner: "UserWidget",
        ownerNodeId: "component:src/widgets/UserWidget#UserWidget",
        selectorName: "selectMissing",
        localName: "missing",
        file: "src/widgets/UserWidget.tsx",
        confidence: "medium",
      },
    ];

    const index = buildFlowIndex({ graph, facts, metadata });
    const matrix = buildCoverageTransitionMatrix(index.flows);
    const accounted = Object.values(matrix)
      .flatMap((origins) => Object.values(origins))
      .reduce((sum, count) => sum + count, 0);

    expect(accounted).toBe(index.flows.length);
    expect(matrix["source-only"].proven).toBe(1);
    expect(matrix.partial.gap).toBe(1);
  });

  it("normalizes thunk API and slice writes in source-to-consumer direction", () => {
    const facts: ProjectFact[] = [
      {
        type: "selectorStateRead",
        selectorName: "selectUser",
        file: "src/model/selectors.ts",
        statePath: "state.user.current",
        confidence: "high",
      },
      {
        type: "selectorBinding",
        owner: "useUser",
        ownerNodeId: "hook:src/model/useUser#useUser",
        selectorName: "selectUser",
        localName: "user",
        file: "src/model/useUser.ts",
        confidence: "high",
      },
      {
        type: "reduxThunk",
        name: "fetchUser",
        typePrefix: "user/fetchUser",
        apiCalls: [{
          method: "GET",
          url: "/api/users/${userId}",
          code: "fetch(`/api/users/${userId}`)",
          line: 4,
        }],
        file: "src/model/thunks.ts",
        location: { line: 3, column: 1 },
      },
      {
        type: "sliceWrite",
        sliceName: "user",
        writerName: "fetchUser",
        writerState: "fulfilled",
        writes: [{
          statePath: "current",
          valueOrigin: "payload",
          location: { line: 10, column: 5 },
          code: "state.current = action.payload",
        }],
        file: "src/model/slice.ts",
        location: { line: 10, column: 5 },
        code: "addCase(fetchUser.fulfilled, …)",
      },
    ];

    const index = buildFlowIndex({ graph, facts, metadata });
    const api = index.nodes.find((node) => node.kind === "api");
    const operation = index.nodes.find((node) => node.kind === "async-operation");
    const state = index.nodes.find((node) => node.kind === "state-field");
    const flow = index.flows.find((entry) =>
      entry.nodeIds.includes(api?.id ?? "") && entry.nodeIds.includes(operation?.id ?? "")
    );

    expect(api).toMatchObject({
      id: "api:http:GET:%2Fapi%2Fusers%2F%7BuserId%7D",
      name: "GET /api/users/${userId}",
      path: "/api/users/${userId}",
      confidence: "medium",
    });
    expect(operation).toMatchObject({
      name: "fetchUser.fulfilled",
      ownerNodeId: "thunk:src/model/thunks#fetchUser",
      path: "user/fetchUser.fulfilled",
    });
    expect(index.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: api?.id, to: operation?.id, relation: "produces" }),
      expect.objectContaining({
        from: operation?.id,
        to: state?.id,
        relation: "writes",
        confidence: "high",
        stateWrite: expect.objectContaining({
          statePath: "state.user.current",
          lifecycle: "fulfilled",
          valueOrigin: "payload",
        }),
      }),
    ]));
    expect(flow).toBeDefined();
    expect(api?.evidence[0]).toMatchObject({ file: "src/model/thunks.ts", line: 4 });
  });

  it("deduplicates shared selector and state nodes across several values", () => {
    const facts: ProjectFact[] = [
      {
        type: "selectorStateRead",
        selectorName: "selectUser",
        file: "src/model/selectors.ts",
        statePath: "state.user.current",
        confidence: "high",
      },
      ...["primaryUser", "secondaryUser"].map((localName): ProjectFact => ({
        type: "selectorBinding",
        owner: "useUser",
        ownerNodeId: "hook:src/model/useUser#useUser",
        selectorName: "selectUser",
        localName,
        file: "src/model/useUser.ts",
        confidence: "high",
      })),
    ];

    const index = buildFlowIndex({ graph, facts, metadata });

    expect(index.flows).toHaveLength(2);
    expect(index.nodes.filter((node) => node.kind === "selector-result")).toHaveLength(1);
    expect(index.nodes.filter((node) => node.kind === "state-field")).toHaveLength(1);
    expect(index.edges.filter((edge) => edge.relation === "selects")).toHaveLength(1);
  });

  it("normalizes a hook return property through a component value to a prop", () => {
    const facts: ProjectFact[] = [
      {
        type: "selectorStateRead",
        selectorName: "selectUser",
        file: "src/model/selectors.ts",
        statePath: "state.user.current",
        confidence: "high",
      },
      {
        type: "selectorBinding",
        owner: "useUser",
        ownerNodeId: "hook:src/model/useUser#useUser",
        selectorName: "selectUser",
        localName: "user",
        file: "src/model/useUser.ts",
        confidence: "high",
      },
      {
        type: "hookReturnDependency",
        hookName: "useUser",
        field: "name",
        dependsOn: ["user"],
        file: "src/model/useUser.ts",
        confidence: "low",
      },
      {
        type: "hookReturnUsage",
        owner: "UserWidget",
        ownerNodeId: "component:src/widgets/UserWidget#UserWidget",
        hookName: "useUser",
        localName: "profile",
        sourceField: "name",
        usageKind: "prop",
        targetName: "UserCard",
        targetNodeId: "component:unknown:UserCard",
        propName: "name",
        file: "src/widgets/UserWidget.tsx",
        confidence: "high",
      },
    ];

    const index = buildFlowIndex({ graph, facts, metadata });
    const returned = index.nodes.find((node) => node.kind === "hook-return");
    const value = index.nodes.find((node) => node.kind === "component-value");
    const prop = index.nodes.find((node) => node.kind === "prop");
    const flow = index.flows.find((entry) => entry.subjectNodeId === value?.id);

    expect(returned).toMatchObject({
      name: "useUser.name",
      path: "name",
      ownerNodeId: "hook:src/model/useUser#useUser",
    });
    expect(value).toMatchObject({ name: "profile.name", path: "profile.name" });
    expect(prop).toMatchObject({
      name: "UserCard.name",
      path: "UserCard.name",
      ownerNodeId: "component:src/entities/UserCard#UserCard",
    });
    expect(index.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: expect.stringContaining("#user"), to: returned?.id, relation: "derives" }),
      expect.objectContaining({ from: returned?.id, to: value?.id, relation: "returns" }),
      expect.objectContaining({ from: value?.id, to: prop?.id, relation: "passes" }),
    ]));
    expect(flow).toMatchObject({ completeness: "complete" });
    expect(flow?.nodeIds).toEqual(expect.arrayContaining([returned?.id, prop?.id]));
  });

  it("materializes an early hook-return guard as a UI effect", () => {
    const facts: ProjectFact[] = [
      {
        type: "hookReturnDependency",
        hookName: "useUser",
        field: "shouldShowUser",
        dependsOn: [],
        boundarySources: [{ name: "true", kind: "literal" }],
        valueSemantics: {
          type: "boolean",
          transformation: { kind: "constant", inputPaths: [], expression: "true" },
        },
        file: "src/model/useUser.ts",
        confidence: "high",
      },
      {
        type: "hookReturnUsage",
        owner: "UserWidget",
        ownerNodeId: "component:src/widgets/UserWidget#UserWidget",
        hookName: "useUser",
        localName: "shouldShowUser",
        sourceField: "shouldShowUser",
        usageKind: "conditionalRender",
        file: "src/widgets/UserWidget.tsx",
        code: "if (!shouldShowUser) return null",
        confidence: "high",
      },
    ];

    const index = buildFlowIndex({ graph, facts, metadata });
    const returned = index.nodes.find((node) =>
      node.kind === "hook-return" && node.path === "shouldShowUser"
    );
    const value = index.nodes.find((node) =>
      node.kind === "component-value" && node.path === "shouldShowUser"
    );
    const effect = index.nodes.find((node) =>
      node.kind === "ui-effect" && node.path === "shouldShowUser"
    );

    expect(effect).toMatchObject({
      name: "controls render: shouldShowUser",
      ownerNodeId: "component:src/widgets/UserWidget#UserWidget",
      uiEffect: { kind: "conditional-render" },
    });
    expect(value?.valueSemantics).toMatchObject({
      type: "boolean",
      transformation: { kind: "constant" },
    });
    expect(index.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: returned?.id, to: value?.id, relation: "returns" }),
      expect.objectContaining({ from: value?.id, to: effect?.id, relation: "controls" }),
    ]));
  });

  it("connects a destructured nested-hook return to an outer hook value", () => {
    const facts: ProjectFact[] = [
      {
        type: "selectorStateRead",
        selectorName: "selectUser",
        file: "src/model/selectors.ts",
        statePath: "state.user.current",
        confidence: "high",
      },
      {
        type: "selectorBinding",
        owner: "useUser",
        ownerNodeId: "hook:src/model/useUser#useUser",
        selectorName: "selectUser",
        localName: "user",
        file: "src/model/useUser.ts",
        confidence: "high",
      },
      {
        type: "hookReturnDependency",
        hookName: "useUser",
        field: "name",
        dependsOn: ["user"],
        file: "src/model/useUser.ts",
        confidence: "high",
      },
      {
        type: "hookReturnDependency",
        hookName: "useProfile",
        field: "name",
        dependsOn: ["nestedName"],
        hookSources: [{
          localName: "nestedName",
          hookName: "useUser",
          field: "name",
        }],
        file: "src/model/useProfile.ts",
        confidence: "high",
      },
      {
        type: "hookReturnUsage",
        owner: "UserWidget",
        ownerNodeId: "component:src/widgets/UserWidget#UserWidget",
        hookName: "useProfile",
        localName: "profile",
        sourceField: "name",
        usageKind: "renderedExpression",
        file: "src/widgets/UserWidget.tsx",
        confidence: "high",
      },
    ];

    const index = buildFlowIndex({ graph, facts, metadata });
    const outer = index.nodes.find((node) =>
      node.kind === "hook-return" && node.name === "useProfile.name"
    );
    const inner = index.nodes.find((node) =>
      node.kind === "hook-return" && node.name === "useUser.name"
    );
    const value = index.nodes.find((node) =>
      node.kind === "component-value" && node.name === "profile.name"
    );
    const flow = index.flows.find((entry) => entry.subjectNodeId === value?.id);

    expect(index.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: inner?.id, to: outer?.id, relation: "derives" }),
      expect.objectContaining({ from: outer?.id, to: value?.id, relation: "returns" }),
    ]));
    expect(flow?.coverage).toMatchObject({
      origin: "proven",
      continuation: "terminal-at-unit",
      reasonCodes: [],
    });
  });

  it("uses an external hook return as an explicit boundary origin", () => {
    const index = buildFlowIndex({
      graph,
      metadata,
      facts: [{
        type: "hookReturnUsage",
        owner: "RecordPage",
        ownerNodeId: "component:src/pages/RecordPage#RecordPage",
        hookName: "useParams",
        externalModule: "react-router-dom",
        localName: "recordId",
        sourceField: "recordId",
        usageKind: "prop",
        targetName: "RecordPanel",
        propName: "recordId",
        file: "src/pages/RecordPage.tsx",
        location: { line: 5, column: 9 },
        confidence: "high",
      }],
    });

    expect(index.nodes).toContainEqual(expect.objectContaining({
      kind: "boundary",
      name: "useParams.recordId",
    }));
    expect(index.flows[0]?.coverage.origin).toBe("boundary");
    expect(index.flows[0]?.completeness).toBe("complete");
  });

  it("uses an external destructured hook field as a nested hook boundary", () => {
    const facts: ProjectFact[] = [
      {
        type: "hookBinding",
        owner: "useProfile",
        ownerNodeId: "hook:src/model/useProfile#useProfile",
        hookName: "useForm",
        externalModule: "react-hook-form",
        arguments: [],
        boundTo: {
          kind: "objectDestructure",
          fields: [{ sourceName: "control", localName: "control" }],
        },
        file: "src/model/useProfile.ts",
        confidence: "high",
      },
      {
        type: "hookReturnDependency",
        hookName: "useProfile",
        field: "control",
        dependsOn: ["control"],
        hookSources: [{ localName: "control", hookName: "useForm", field: "control" }],
        file: "src/model/useProfile.ts",
        confidence: "high",
      },
      {
        type: "hookReturnUsage",
        owner: "UserWidget",
        ownerNodeId: "component:src/widgets/UserWidget#UserWidget",
        hookName: "useProfile",
        localName: "control",
        sourceField: "control",
        usageKind: "prop",
        targetName: "UserCard",
        propName: "control",
        file: "src/widgets/UserWidget.tsx",
        confidence: "high",
      },
    ];

    const index = buildFlowIndex({ graph, facts, metadata });

    expect(index.nodes).toContainEqual(expect.objectContaining({
      kind: "boundary",
      name: "useForm.control",
    }));
    expect(index.nodes.some((node) => node.kind === "gap")).toBe(false);
    expect(index.flows[0]?.coverage.origin).toBe("boundary");
  });

  it("connects fields forwarded through a custom-hook return spread", () => {
    const facts: ProjectFact[] = [
      {
        type: "hookDeclarationShape",
        hookName: "useUser",
        file: "src/model/useUser.ts",
        params: [],
        returnShape: { kind: "object", fields: ["name"] },
        confidence: "medium",
      },
      {
        type: "hookReturnDependency",
        hookName: "useUser",
        field: "name",
        dependsOn: ["name"],
        boundarySources: [{ name: "name", kind: "parameter" }],
        file: "src/model/useUser.ts",
        confidence: "high",
      },
      {
        type: "hookReturnSpread",
        hookName: "useProfile",
        sourceLocalName: "user",
        sourceHookName: "useUser",
        file: "src/model/useProfile.ts",
        confidence: "medium",
      },
      {
        type: "hookReturnUsage",
        owner: "UserWidget",
        ownerNodeId: "component:src/widgets/UserWidget#UserWidget",
        hookName: "useProfile",
        localName: "name",
        sourceField: "name",
        usageKind: "prop",
        targetName: "UserCard",
        targetNodeId: "component:src/entities/UserCard#UserCard",
        propName: "name",
        file: "src/widgets/UserWidget.tsx",
        confidence: "high",
      },
    ];

    const index = buildFlowIndex({ graph, facts, metadata });
    const inner = index.nodes.find((node) => node.kind === "hook-return" && node.name === "useUser.name");
    const outer = index.nodes.find((node) => node.kind === "hook-return" && node.name === "useProfile.name");

    expect(index.edges).toContainEqual(expect.objectContaining({
      from: inner?.id,
      to: outer?.id,
      relation: "derives",
    }));
    expect(index.nodes.some((node) => node.kind === "gap")).toBe(false);
    expect(index.flows[0]?.coverage.origin).toBe("boundary");
  });

  it("turns an unsupported hook return origin into an explicit gap", () => {
    const facts: ProjectFact[] = [{
      type: "hookReturnUsage",
      owner: "UserWidget",
      ownerNodeId: "component:src/widgets/UserWidget#UserWidget",
      hookName: "useProfile",
      localName: "profile",
      sourceField: "name",
      usageKind: "renderedExpression",
      file: "src/widgets/UserWidget.tsx",
      confidence: "high",
    }];

    const index = buildFlowIndex({ graph, facts, metadata });
    const flow = index.flows[0];

    expect(flow?.coverage).toMatchObject({
      origin: "gap",
      continuation: "terminal-at-unit",
      reasonCodes: ["hook-return-source-not-recorded"],
    });
    expect(index.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "gap",
        gap: expect.objectContaining({ reasonCode: "hook-return-source-not-recorded" }),
      }),
    ]));
  });

  it("materializes a legitimate hook boundary without inventing a canonical source", () => {
    const facts: ProjectFact[] = [
      {
        type: "hookReturnDependency",
        hookName: "useProfile",
        field: "onClose",
        dependsOn: ["onClose"],
        boundarySources: [{
          name: "onClose",
          kind: "local-callback",
          location: { file: "src/model/useProfile.ts", line: 5, column: 3 },
          code: "const onClose = () => setOpen(false)",
        }],
        file: "src/model/useProfile.ts",
        confidence: "high",
      },
      {
        type: "hookReturnUsage",
        owner: "UserWidget",
        ownerNodeId: "component:src/widgets/UserWidget#UserWidget",
        hookName: "useProfile",
        localName: "onClose",
        sourceField: "onClose",
        usageKind: "eventHandler",
        targetName: "UserCard",
        targetNodeId: "component:src/entities/UserCard#UserCard",
        propName: "onClose",
        file: "src/widgets/UserWidget.tsx",
        confidence: "high",
      },
    ];

    const index = buildFlowIndex({ graph, facts, metadata });
    const boundary = index.nodes.find((node) => node.kind === "boundary");
    const flow = index.flows.find((entry) => entry.nodeIds.includes(boundary?.id ?? ""));

    expect(boundary).toMatchObject({
      name: "onClose",
      ownerNodeId: "hook:src/model/useProfile#useProfile",
      evidence: [expect.objectContaining({ file: "src/model/useProfile.ts", line: 5 })],
    });
    expect(flow?.coverage).toMatchObject({ origin: "boundary", continuation: "proven", reasonCodes: [] });
    expect(flow?.completeness).toBe("complete");
    expect(index.nodes.some((node) => node.kind === "gap")).toBe(false);
  });

  it("derives a used nested return path from its proven parent field", () => {
    const facts: ProjectFact[] = [
      {
        type: "hookReturnDependency",
        hookName: "useProfile",
        field: "defaults",
        dependsOn: ["record"],
        boundarySources: [{ name: "record", kind: "parameter" }],
        file: "src/model/useProfile.ts",
        confidence: "high",
      },
      {
        type: "hookReturnUsage",
        owner: "UserWidget",
        ownerNodeId: "component:src/widgets/UserWidget#UserWidget",
        hookName: "useProfile",
        localName: "defaults",
        sourceField: "defaults.phone",
        usageKind: "prop",
        targetName: "UserCard",
        targetNodeId: "component:src/entities/UserCard#UserCard",
        propName: "phone",
        file: "src/widgets/UserWidget.tsx",
        confidence: "high",
      },
    ];

    const index = buildFlowIndex({ graph, facts, metadata });
    const parent = index.nodes.find((node) => node.kind === "hook-return" && node.path === "defaults");
    const nested = index.nodes.find((node) => node.kind === "hook-return" && node.path === "defaults.phone");
    const flow = index.flows.find((entry) => entry.nodeIds.includes(nested?.id ?? ""));

    expect(index.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: parent?.id, to: nested?.id, relation: "derives" }),
    ]));
    expect(flow?.coverage.origin).toBe("boundary");
    expect(index.nodes.some((node) => node.kind === "gap")).toBe(false);
  });

  it("normalizes a direct conditional render as a first-class UI consumer", () => {
    const facts: ProjectFact[] = [
      {
        type: "selectorStateRead",
        selectorName: "selectUser",
        file: "src/model/selectors.ts",
        statePath: "state.user.current",
        confidence: "high",
      },
      {
        type: "selectorBinding",
        owner: "UserWidget",
        ownerNodeId: "component:src/widgets/UserWidget#UserWidget",
        selectorName: "selectUser",
        localName: "user",
        file: "src/widgets/UserWidget.tsx",
        confidence: "high",
      },
      {
        type: "localVariableUsage",
        owner: "UserWidget",
        ownerNodeId: "component:src/widgets/UserWidget#UserWidget",
        variableName: "user",
        propertyPath: "isVisible",
        usageKind: "conditionalRender",
        targetName: "UserCard",
        targetNodeId: "component:src/entities/UserCard#UserCard",
        file: "src/widgets/UserWidget.tsx",
        confidence: "high",
      },
    ];

    const index = buildFlowIndex({ graph, facts, metadata });
    const effect = index.nodes.find((node) => node.kind === "ui-effect");
    const flow = index.flows[0];

    expect(effect).toMatchObject({
      name: "controls render: user.isVisible → UserCard",
      ownerNodeId: "component:src/widgets/UserWidget#UserWidget",
      uiEffect: { kind: "conditional-render", targetName: "UserCard" },
    });
    expect(flow?.coverage).toMatchObject({ origin: "proven", continuation: "proven" });
    expect(index.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ to: effect?.id, relation: "controls" }),
    ]));
  });
});
