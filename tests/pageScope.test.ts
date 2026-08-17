import { describe, expect, it } from "vitest";
import { buildFlowIndex } from "../src/flow/buildFlowIndex.js";
import { buildPageScope } from "../src/flow/buildPageScope.js";
import type { ProjectMapGraph } from "../src/graph/types.js";
import type { ProjectFact } from "../src/scanner/facts.js";

const graph: ProjectMapGraph = {
  schemaVersion: "1.1.0",
  project: { name: "scope-fixture", root: "/scope-fixture", sourceRoot: "src" },
  nodes: [
    node("page:user", "page", "user", "pages", "user"),
    node("file:src/pages/user/UserPage.tsx", "file", "UserPage.tsx", "pages", "user", "src/pages/user/UserPage.tsx"),
    node("component:user-page#UserPage", "component", "UserPage", "pages", "user", "src/pages/user/UserPage.tsx", { exported: true }),
    node("widget:user-profile", "widget", "user-profile", "widgets", "user-profile"),
    node("component:user-profile#UserProfileWidget", "component", "UserProfileWidget", "widgets", "user-profile"),
    node("feature:user-profile", "feature", "user-profile", "features", "user-profile"),
    node("hook:use-user-profile#useUserProfile", "hook", "useUserProfile", "features", "user-profile"),
    node("entity:user", "entity", "user", "entities", "user"),
    node("selector:select-user", "selector", "selectUser", "entities", "user"),
    node("slice-model:user", "slice-model", "user", "entities", "user"),
    node("thunk:fetch-user", "thunk", "fetchUser", "entities", "user"),
    node("api:get-user", "api", "GET /users/:id", "entities", "user"),
    node("component:other#Other", "component", "Other", "features", "other"),
  ],
  edges: [
    edge("page:user", "file:src/pages/user/UserPage.tsx", "contains"),
    edge("component:user-page#UserPage", "file:src/pages/user/UserPage.tsx", "definedIn"),
    edge("component:user-page#UserPage", "component:user-profile#UserProfileWidget", "renders"),
    edge("component:user-profile#UserProfileWidget", "hook:use-user-profile#useUserProfile", "usesHook"),
    edge("hook:use-user-profile#useUserProfile", "selector:select-user", "usesSelector"),
    edge("hook:use-user-profile#useUserProfile", "thunk:fetch-user", "dispatchesAction"),
    edge("hook:use-user-profile#useUserProfile", "api:get-user", "callsApi"),
    edge("thunk:fetch-user", "slice-model:user", "writesSlice"),
    edge("page:user", "widget:user-profile", "dependsOn"),
    edge("widget:user-profile", "feature:user-profile", "dependsOn"),
    edge("feature:user-profile", "entity:user", "dependsOn"),
  ],
  stats: { nodesCount: 13, edgesCount: 11 },
};

const facts: ProjectFact[] = [
  {
    type: "selectorStateRead",
    selectorName: "selectUser",
    file: "src/entities/user/selectors.ts",
    statePath: "state.user.current",
    confidence: "high",
  },
  {
    type: "selectorBinding",
    owner: "useUserProfile",
    ownerNodeId: "hook:use-user-profile#useUserProfile",
    selectorName: "selectUser",
    localName: "user",
    file: "src/features/user-profile/useUserProfile.ts",
    confidence: "high",
  },
  {
    type: "selectorBinding",
    owner: "Other",
    ownerNodeId: "component:other#Other",
    selectorName: "selectUser",
    localName: "otherUser",
    file: "src/features/other/Other.tsx",
    confidence: "high",
  },
];

const flowIndex = buildFlowIndex({
  graph,
  facts,
  metadata: {
    runId: "scope-test",
    generatedAt: "2026-07-12T00:00:00.000Z",
    sourceFingerprint: "scope-fixture",
  },
});

describe("buildPageScope", () => {
  it("resolves the page component and collects nested topology plus owned flows", () => {
    const scope = buildPageScope({ graph, flowIndex, pageId: "page:user" });

    expect(scope).toMatchObject({
      pageId: "page:user",
      primaryComponentId: "component:user-page#UserPage",
      entryComponentIds: ["component:user-page#UserPage"],
      warnings: [],
    });
    expect(scope?.topologyNodeIds).toEqual(expect.arrayContaining([
      "page:user",
      "file:src/pages/user/UserPage.tsx",
      "component:user-page#UserPage",
      "component:user-profile#UserProfileWidget",
      "hook:use-user-profile#useUserProfile",
      "selector:select-user",
      "thunk:fetch-user",
      "slice-model:user",
      "api:get-user",
      "widget:user-profile",
      "feature:user-profile",
      "entity:user",
    ]));
    expect(scope?.topologyNodeIds).not.toContain("component:other#Other");

    const userFlow = flowIndex.flows.find((flow) =>
      flowIndex.nodes.find((node) => node.id === flow.subjectNodeId)?.name === "user"
    );
    const otherFlow = flowIndex.flows.find((flow) =>
      flowIndex.nodes.find((node) => node.id === flow.subjectNodeId)?.name === "otherUser"
    );
    expect(scope?.flowIds).toContain(userFlow?.id);
    expect(scope?.flowIds).not.toContain(otherFlow?.id);
    expect(scope?.flowNodeIds.some((id) => flowIndex.nodes.find((node) => node.id === id)?.path === "state.user.current")).toBe(true);
  });

  it("returns an honest warning when a page component cannot be resolved", () => {
    const orphanGraph: ProjectMapGraph = {
      ...graph,
      nodes: graph.nodes.filter((node) => node.id === "page:user"),
      edges: [],
      stats: { nodesCount: 1, edgesCount: 0 },
    };
    const scope = buildPageScope({ graph: orphanGraph, flowIndex, pageId: "page:user" });

    expect(scope).toMatchObject({
      entryComponentIds: [],
      warnings: [{ code: "page-component-not-found" }],
      stats: { flowsCount: 0 },
    });
  });

  it("returns null for an unknown page id", () => {
    expect(buildPageScope({ graph, flowIndex, pageId: "page:missing" })).toBeNull();
  });
});

function node(
  id: string,
  type: ProjectMapGraph["nodes"][number]["type"],
  name: string,
  layer?: string,
  slice?: string,
  file?: string,
  meta?: Record<string, unknown>
): ProjectMapGraph["nodes"][number] {
  return { id, type, name, file, fsd: { layer, slice }, meta };
}

function edge(
  from: string,
  to: string,
  type: ProjectMapGraph["edges"][number]["type"]
): ProjectMapGraph["edges"][number] {
  return {
    id: `edge:${from}:${type}:${to}`,
    from,
    to,
    type,
    confidence: "high",
    evidence: [],
  };
}
