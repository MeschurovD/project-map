import { describe, expect, it } from "vitest";
import { buildFlowGraph, collectFocusPath } from "../src/ui/src/flow/flowAdapters.js";
import type { ViewGraph } from "../src/ui/graph-view/viewTypes.js";

const view: ViewGraph = {
  nodes: [
    { id: "a", kind: "semantic-card", label: "A", position: { x: 0, y: 0 } },
    { id: "b", kind: "semantic-card", label: "B", position: { x: 100, y: 0 } },
    { id: "c", kind: "semantic-card", label: "C", position: { x: 200, y: 0 } },
  ],
  edges: [
    { id: "a-b", from: "a", to: "b", type: "view", label: "renders" },
    { id: "b-c", from: "b", to: "c", type: "view", label: "uses" },
  ],
};

describe("buildFlowGraph", () => {
  it("renders edge labels only for edges touching the selected node", () => {
    expect(buildFlowGraph(view).edges.map((edge) => edge.label)).toEqual([undefined, undefined]);

    const selected = buildFlowGraph(view, { selectedNodeId: "b" });
    expect(selected.edges.find((edge) => edge.id === "a-b")?.label).toBe("renders");
    expect(selected.edges.find((edge) => edge.id === "b-c")?.label).toBe("uses");
  });

  it("does not bake hover dimming into node/edge styles (handled imperatively)", () => {
    const result = buildFlowGraph(view, { selectedNodeId: "a" });
    expect(result.nodes.every((node) => node.style?.opacity === undefined)).toBe(true);
    expect(result.edges.every((edge) => edge.style?.opacity === undefined)).toBe(true);
  });

  it("maps every view node and edge through unchanged", () => {
    const result = buildFlowGraph(view);
    expect(result.nodes.map((node) => node.id)).toEqual(["a", "b", "c"]);
    expect(result.edges.map((edge) => edge.id)).toEqual(["a-b", "b-c"]);
  });
});

describe("collectFocusPath", () => {
  // page -> widget -> mid -> leaf (a downward composition chain)
  const chain: ViewGraph = {
    nodes: ["page", "widget", "mid", "leaf", "other"].map((id) => ({
      id, kind: "semantic-card" as const, label: id, position: { x: 0, y: 0 },
    })),
    edges: [
      { id: "p-w", from: "page", to: "widget", type: "view" },
      { id: "w-m", from: "widget", to: "mid", type: "view" },
      { id: "m-l", from: "mid", to: "leaf", type: "view" },
      { id: "p-o", from: "page", to: "other", type: "view" },
    ],
  };

  it("lights the whole lineage up to the root and down to the leaves", () => {
    const { nodes, edges } = collectFocusPath(chain, "mid");
    // ancestors page, widget; self mid; descendant leaf — but not the unrelated "other".
    expect([...nodes].sort()).toEqual(["leaf", "mid", "page", "widget"]);
    expect([...edges].sort()).toEqual(["m-l", "p-w", "w-m"]);
  });

  it("from a leaf, walks all the way up to the page", () => {
    expect([...collectFocusPath(chain, "leaf").nodes].sort()).toEqual(["leaf", "mid", "page", "widget"]);
  });
});
