import { describe, expect, it } from "vitest";
import type { EdgeType, NodeType, ProjectMapEdge, ProjectMapGraph, ProjectMapNode } from "../src/graph/types.js";
import { buildImpactView, collectImpactSubgraph, summarizeImpactSubgraph } from "../src/ui/graph-view/buildImpactView.js";

function node(id: string, type: NodeType, name: string, layer?: string, slice?: string): ProjectMapNode {
  return {
    id,
    type,
    name,
    ...(layer ? { fsd: { layer, slice: slice ?? null, segment: null } } : {}),
  };
}

function edge(from: string, to: string, type: EdgeType): ProjectMapEdge {
  return { id: `edge:${from}:${type}:${to}`, from, to, type, confidence: "high", evidence: [] };
}

// selector <- hook <- widget component <- page component (slice home)
//          <- feature component (direct)
const graph: ProjectMapGraph = {
  schemaVersion: "1.1.0",
  project: { name: "test", root: "/", sourceRoot: "src" },
  nodes: [
    node("selector:src/entities/user/model/selectors#selectUser", "selector", "selectUser", "entities", "user"),
    node("hook:src/features/profile/model/useProfile#useProfile", "hook", "useProfile", "features", "profile"),
    node("component:src/widgets/profile/ui/ProfileWidget#ProfileWidget", "component", "ProfileWidget", "widgets", "profile"),
    node("component:src/pages/home/ui/HomePage#HomePage", "component", "HomePage", "pages", "home"),
    node("component:src/features/login/ui/LoginForm#LoginForm", "component", "LoginForm", "features", "login"),
    node("page:home", "page", "home", "pages", "home"),
    node("page:other", "page", "other", "pages", "other"),
  ],
  edges: [
    edge("hook:src/features/profile/model/useProfile#useProfile", "selector:src/entities/user/model/selectors#selectUser", "usesSelector"),
    edge("component:src/widgets/profile/ui/ProfileWidget#ProfileWidget", "hook:src/features/profile/model/useProfile#useProfile", "usesHook"),
    edge("component:src/pages/home/ui/HomePage#HomePage", "component:src/widgets/profile/ui/ProfileWidget#ProfileWidget", "renders"),
    edge("component:src/features/login/ui/LoginForm#LoginForm", "selector:src/entities/user/model/selectors#selectUser", "usesSelector"),
  ],
  stats: { nodesCount: 7, edgesCount: 4 },
};

const targetId = "selector:src/entities/user/model/selectors#selectUser";

describe("collectImpactSubgraph", () => {
  it("walks incoming semantic edges up to pages with depths", () => {
    const impact = collectImpactSubgraph(graph, targetId);
    const depths = new Map(impact?.affected.map((entry) => [entry.node.name, entry.depth]));

    expect(depths.get("useProfile")).toBe(1);
    expect(depths.get("LoginForm")).toBe(1);
    expect(depths.get("ProfileWidget")).toBe(2);
    expect(depths.get("HomePage")).toBe(3);
    expect(impact?.edges).toHaveLength(4);
  });

  it("resolves affected page-layer components to page module nodes", () => {
    const impact = collectImpactSubgraph(graph, targetId);
    expect(impact?.pages.map((page) => page.id)).toEqual(["page:home"]);
  });

  it("returns null for an unknown target", () => {
    expect(collectImpactSubgraph(graph, "selector:missing")).toBeNull();
  });
});

describe("summarizeImpactSubgraph", () => {
  it("groups the blast radius into affected pages and node kinds", () => {
    const impact = collectImpactSubgraph(graph, targetId)!;
    const summary = summarizeImpactSubgraph(impact);

    expect(summary.pages.map((page) => page.id)).toEqual(["page:home"]);
    expect(summary.groups.map((group) => group.kind)).toEqual(["component", "hook"]);
    expect(summary.groups.find((group) => group.kind === "component")?.nodes.map((node) => node.name)).toEqual([
      "LoginForm",
      "ProfileWidget",
    ]);
    expect(summary.groups.find((group) => group.kind === "hook")?.nodes.map((node) => node.name)).toEqual(["useProfile"]);
  });
});

describe("buildImpactView", () => {
  it("places the target in the first column and pages in the last", () => {
    const view = buildImpactView(graph, targetId);
    const byId = new Map(view.nodes.map((entry) => [entry.id, entry]));

    expect(byId.get(targetId)?.position.x).toBe(0);
    expect(byId.get(targetId)?.badgeLabel).toBe("target");
    expect(byId.get("hook:src/features/profile/model/useProfile#useProfile")?.position.x).toBe(360);
    expect(byId.get("component:src/pages/home/ui/HomePage#HomePage")?.position.x).toBe(3 * 360);
    expect(byId.get("page:home")?.position.x).toBe(4 * 360);
    expect(byId.has("page:other")).toBe(false);
  });

  it("keeps original edges and links page components to their page module", () => {
    const view = buildImpactView(graph, targetId);
    const sourceEdges = view.edges.filter((entry) => entry.sourceEdge);
    expect(sourceEdges).toHaveLength(4);
    expect(view.edges.some(
      (entry) => entry.type === "view" && entry.from === "component:src/pages/home/ui/HomePage#HomePage" && entry.to === "page:home"
    )).toBe(true);
  });
});
