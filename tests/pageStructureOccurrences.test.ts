import { describe, expect, it } from "vitest";
import { createFlowQueries } from "../src/flow/queries.js";
import type { FlowIndex } from "../src/flow/types.js";
import type { ProjectMapGraph } from "../src/graph/types.js";
import {
  buildPageStructure,
  type PageStructureItem,
} from "../src/ui/graph-view/buildPageStructure.js";
import { projectPageStructure } from "../src/ui/graph-view/projectPageStructure.js";

const ids = {
  page: "page:example",
  file: "file:src/pages/example/ExamplePage.tsx",
  root: "component:src/pages/example/ExamplePage#ExamplePage",
  card: "component:src/shared/ui/InfoCard#InfoCard",
  action: "component:src/features/edit/EditAction#EditAction",
  fragment: "jsx:example#fragment",
  cardFirst: "jsx:example#card-first",
  cardSecond: "jsx:example#card-second",
  actionSlot: "jsx:example#action-slot",
  rootHook: "hook:src/pages/example/usePageState#usePageState",
  cardHook: "hook:src/shared/ui/useCardState#useCardState",
};

describe("occurrence-aware page structure", () => {
  it("keeps repeated callsites and nests JSX passed through a prop slot", () => {
    const queries = createFlowQueries({ graph, flowIndex });
    const structure = buildPageStructure(graph, queries, ids.page);
    const root = structure?.root;
    const returnGroup = root?.children.find((item) => item.name === "Return");
    const fragment = returnGroup?.children[0];
    const cards = fragment?.children.filter((item) => item.name === "InfoCard") ?? [];

    expect(root?.children.map((item) => item.name)).toEqual(["Return"]);
    expect(fragment).toMatchObject({ kind: "fragment", name: "Fragment" });
    expect(cards.map((item) => item.id)).toEqual([ids.cardFirst, ids.cardSecond]);
    expect(cards.map((item) => item.valuesCount)).toEqual([1, 1]);
    expect(cards.map((item) => item.metricsKind)).toEqual(["inputs", "inputs"]);

    const slot = cards[1]?.children.find((item) => item.kind === "slot");
    expect(slot).toMatchObject({ name: "addon" });
    expect(flatten(slot).map((item) => item.name)).toContain("EditAction");
  });

  it("keeps one top-level Logic section and flattens nested hook groups", () => {
    const graphWithHooks: ProjectMapGraph = {
      ...graph,
      nodes: [
        ...graph.nodes,
        graphNode(ids.rootHook, "hook", "usePageState", "pages", "example"),
        graphNode(ids.cardHook, "hook", "useCardState", "shared", "ui"),
      ],
      edges: [
        ...graph.edges,
        graphEdge("root-hook", ids.root, ids.rootHook, "usesHook"),
        graphEdge("card-hook", ids.card, ids.cardHook, "usesHook"),
      ],
      stats: { nodesCount: 7, edgesCount: 6 },
    };
    const queries = createFlowQueries({ graph: graphWithHooks, flowIndex });
    const root = buildPageStructure(graphWithHooks, queries, ids.page)?.root;
    const allItems = flatten(root ?? undefined);
    const firstCard = allItems.find((item) => item.id === ids.cardFirst);

    expect(root?.children.map((item) => item.name)).toEqual(["Logic", "Return"]);
    expect(allItems.filter((item) => item.kind === "section" && item.name === "Logic"))
      .toHaveLength(1);
    expect(firstCard?.children.map((item) => item.name)).toContain("useCardState");
  });

  it("projects semantic and logic-data modes without losing occurrences or prop slots", () => {
    const graphWithHooks: ProjectMapGraph = {
      ...graph,
      nodes: [
        ...graph.nodes,
        graphNode(ids.rootHook, "hook", "usePageState", "pages", "example"),
        graphNode(ids.cardHook, "hook", "useCardState", "shared", "ui"),
      ],
      edges: [
        ...graph.edges,
        graphEdge("root-hook", ids.root, ids.rootHook, "usesHook"),
        graphEdge("card-hook", ids.card, ids.cardHook, "usesHook"),
      ],
      stats: { nodesCount: 7, edgesCount: 6 },
    };
    const queries = createFlowQueries({ graph: graphWithHooks, flowIndex });
    const exact = buildPageStructure(graphWithHooks, queries, ids.page)!;
    const semantic = projectPageStructure(exact, "semantic");
    const semanticCards = semantic.root?.children.filter((item) => item.name === "InfoCard") ?? [];
    const semanticAction = semanticCards[1]?.children.find((item) => item.name === "EditAction");

    expect(semantic.root?.children.map((item) => item.name)).toEqual(["InfoCard", "InfoCard"]);
    expect(semantic.root?.logicUnits).toEqual([
      expect.objectContaining({ unitId: ids.rootHook, name: "usePageState" }),
    ]);
    expect(semanticCards.map((item) => [item.occurrenceIndex, item.occurrenceCount])).toEqual([
      [1, 2],
      [2, 2],
    ]);
    expect(semanticCards[0]?.logicUnits).toEqual([
      expect.objectContaining({ unitId: ids.cardHook, name: "useCardState" }),
    ]);
    expect(semanticAction).toMatchObject({ relationLabel: "addon" });
    expect(flatten(semantic.root ?? undefined).some((item) =>
      item.kind === "section" || item.kind === "fragment" || item.kind === "slot"
    )).toBe(false);

    const logicData = projectPageStructure(exact, "logic-data");
    expect(logicData.root?.children.map((item) => item.name)).toEqual([
      "usePageState",
      "InfoCard",
      "InfoCard",
    ]);
    expect(flatten(logicData.root ?? undefined).map((item) => item.name)).toContain("useCardState");
    expect(projectPageStructure(exact, "exact")).toBe(exact);
  });
});

const graph: ProjectMapGraph = {
  schemaVersion: "1.1.0",
  project: { name: "fixture", root: "/fixture", sourceRoot: "src" },
  nodes: [
    graphNode(ids.page, "page", "example", "pages", "example"),
    graphNode(ids.file, "file", "ExamplePage.tsx", "pages", "example", "src/pages/example/ExamplePage.tsx"),
    graphNode(ids.root, "component", "ExamplePage", "pages", "example", "src/pages/example/ExamplePage.tsx"),
    graphNode(ids.card, "component", "InfoCard", "shared", "ui", "src/shared/ui/InfoCard.tsx"),
    graphNode(ids.action, "component", "EditAction", "features", "edit", "src/features/edit/EditAction.tsx"),
  ],
  edges: [
    graphEdge("page-file", ids.page, ids.file, "contains"),
    graphEdge("root-file", ids.root, ids.file, "definedIn"),
    graphEdge("root-card", ids.root, ids.card, "renders"),
    graphEdge("root-action", ids.root, ids.action, "renders"),
  ],
  stats: { nodesCount: 5, edgesCount: 4 },
};

const flowIndex: FlowIndex = {
  schemaVersion: "1.4.0",
  runId: "structure-test",
  generatedAt: "2026-07-29T00:00:00.000Z",
  sourceFingerprint: "fixture",
  nodes: [
    flowNode("value:first", "first", ids.root),
    flowNode("prop:first", "InfoCard.value", ids.card, ids.cardFirst),
    flowNode("value:second", "second", ids.root),
    flowNode("prop:second", "InfoCard.value", ids.card, ids.cardSecond),
  ],
  edges: [
    flowEdge("first", "value:first", "prop:first"),
    flowEdge("second", "value:second", "prop:second"),
  ],
  flows: [
    valueFlow("first", "value:first", "prop:first"),
    valueFlow("second", "value:second", "prop:second"),
  ],
  componentStructures: [{
    componentNodeId: ids.root,
    componentName: "ExamplePage",
    file: "src/pages/example/ExamplePage.tsx",
    occurrences: [
      occurrence(ids.fragment, "fragment", "Fragment", undefined, undefined, 3),
      occurrence(ids.cardFirst, "component", "InfoCard", ids.fragment, ids.card, 4),
      occurrence(ids.cardSecond, "component", "InfoCard", ids.fragment, ids.card, 5),
      {
        ...occurrence(ids.actionSlot, "component", "EditAction", ids.cardSecond, ids.action, 6),
        slotName: "addon",
      },
    ],
  }],
  stats: {
    flowsCount: 2,
    completeFlowsCount: 0,
    gapsCount: 0,
    originResolvedFlowsCount: 0,
    originGapFlowsCount: 0,
    originUnknownFlowsCount: 2,
    continuationResolvedFlowsCount: 2,
  },
};

function graphNode(
  id: string,
  type: ProjectMapGraph["nodes"][number]["type"],
  name: string,
  layer: string,
  slice: string,
  file?: string
): ProjectMapGraph["nodes"][number] {
  return { id, type, name, file, fsd: { layer, slice } };
}

function graphEdge(
  id: string,
  from: string,
  to: string,
  type: ProjectMapGraph["edges"][number]["type"]
): ProjectMapGraph["edges"][number] {
  return { id, from, to, type, confidence: "high", evidence: [] };
}

function flowNode(id: string, name: string, ownerNodeId: string, occurrenceId?: string) {
  return {
    id,
    kind: id.startsWith("prop") ? "prop" as const : "component-value" as const,
    name,
    ownerNodeId,
    occurrenceId,
    confidence: "high" as const,
    evidence: [],
  };
}

function flowEdge(id: string, from: string, to: string) {
  return {
    id,
    from,
    to,
    relation: "passes" as const,
    confidence: "high" as const,
    evidence: [],
  };
}

function valueFlow(id: string, subjectNodeId: string, propNodeId: string) {
  return {
    id: `flow:${id}`,
    scopeNodeIds: [ids.root, ids.card],
    subjectNodeId,
    nodeIds: [subjectNodeId, propNodeId],
    edgeIds: [id],
    completeness: "consumer-only" as const,
    coverage: {
      origin: "unknown" as const,
      continuation: "proven" as const,
      reasonCodes: [],
    },
  };
}

function occurrence(
  id: string,
  kind: "component" | "fragment",
  name: string,
  parentId: string | undefined,
  targetNodeId: string | undefined,
  line: number
) {
  return {
    id,
    kind,
    name,
    parentId,
    targetNodeId,
    returnIndex: 0,
    evidence: { file: "src/pages/example/ExamplePage.tsx", line, column: 1 },
  };
}

function flatten(root: PageStructureItem | undefined): PageStructureItem[] {
  if (!root) return [];
  return [root, ...root.children.flatMap((child) => flatten(child))];
}
