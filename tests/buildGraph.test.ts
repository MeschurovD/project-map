import { describe, expect, it } from "vitest";
import { buildGraph } from "../src/graph/buildGraph.js";
import { defaultConfig } from "../src/config/defaultConfig.js";
import type { ResolvedProjectMapConfig } from "../src/config/types.js";
import type { ProjectFact } from "../src/scanner/facts.js";

function config(segments: string[]): ResolvedProjectMapConfig {
  return {
    ...defaultConfig,
    fsd: { ...defaultConfig.fsd, segments },
    projectRoot: "/project",
    sourceRootAbs: "/project/src",
    outputDirAbs: "/project/.project-map",
    tsconfigPathAbs: null,
  };
}

const pageFile = "src/pages/home/blocks/Hero.tsx";
const facts: ProjectFact[] = [
  { type: "fsdClassification", file: pageFile, layer: "pages", slice: "home", segment: null },
  { type: "component", name: "Hero", file: pageFile, exported: true, declaration: "function", location: { line: 1, column: 1 } },
];

describe("buildGraph dispatch resolution", () => {
  const sliceFile = "src/entities/user/model/slice.ts";
  const hookFile = "src/features/user-profile/model/useUserProfile.ts";
  const dispatchFacts: ProjectFact[] = [
    { type: "reduxAction", name: "touch", sliceName: "user", file: sliceFile, location: { line: 10, column: 5 } },
    { type: "hook", name: "useUserProfile", file: hookFile, exported: true, location: { line: 1, column: 1 } },
    {
      type: "dispatchCall",
      sourceFile: hookFile,
      owner: "useUserProfile",
      actionName: "userActions.touch",
      location: { line: 12, column: 3 },
      code: "dispatch(userActions.touch())",
    },
  ];

  it("resolves a dispatched action to the slice-defined action node", () => {
    const graph = buildGraph(dispatchFacts, config(defaultConfig.fsd.segments));
    const edge = graph.edges.find((entry) => entry.type === "dispatchesAction");
    expect(edge?.to).toBe("action:user.touch");
    expect(edge?.confidence).toBe("high");
    expect(graph.nodes.some((node) => node.id === "action:user.touch")).toBe(true);
    expect(graph.nodes.some((node) => node.id === "action:userActions.touch")).toBe(false);
  });

  it("falls back to an unresolved action node when no slice defines the action", () => {
    const factsWithoutSlice = dispatchFacts.filter((fact) => fact.type !== "reduxAction");
    const graph = buildGraph(factsWithoutSlice, config(defaultConfig.fsd.segments));
    const edge = graph.edges.find((entry) => entry.type === "dispatchesAction");
    expect(edge?.to).toBe("action:unknown:touch");
    expect(edge?.confidence).toBe("low");
    const node = graph.nodes.find((entry) => entry.id === "action:unknown:touch");
    expect(node?.meta?.unresolved).toBe(true);
  });
});

describe("buildGraph selector resolution", () => {
  const selectorsFile = "src/entities/user/model/selectors.ts";
  const hookFile = "src/features/user-profile/model/useUserProfile.ts";
  const selectorFacts: ProjectFact[] = [
    { type: "fsdClassification", file: selectorsFile, layer: "entities", slice: "user", segment: "model" },
    {
      type: "import",
      sourceFile: hookFile,
      target: "@/entities/user/model/selectors",
      importedNames: ["selectCurrentUser"],
      isTypeOnly: false,
      location: { line: 1, column: 1 },
    },
    {
      type: "resolvedImport",
      sourceFile: hookFile,
      target: "@/entities/user/model/selectors",
      targetFile: selectorsFile,
      resolved: true,
      external: false,
      location: { line: 1, column: 1 },
    },
    { type: "hook", name: "useUserProfile", file: hookFile, exported: true, location: { line: 3, column: 1 } },
    {
      type: "selectorUsage",
      sourceFile: hookFile,
      owner: "useUserProfile",
      selectorHook: "useAppSelector",
      selectorName: "selectCurrentUser",
      location: { line: 5, column: 3 },
      code: "useAppSelector(selectCurrentUser)",
    },
  ];

  it("anchors an imported selector to its defining file", () => {
    const graph = buildGraph(selectorFacts, config(defaultConfig.fsd.segments));
    const expectedId = "selector:src/entities/user/model/selectors#selectCurrentUser";
    const node = graph.nodes.find((entry) => entry.id === expectedId);
    expect(node?.file).toBe(selectorsFile);
    expect(node?.fsd?.layer).toBe("entities");
    const edge = graph.edges.find((entry) => entry.type === "usesSelector");
    expect(edge?.to).toBe(expectedId);
    expect(edge?.confidence).toBe("high");
    expect(graph.nodes.some((entry) => entry.id === "selector:selectCurrentUser")).toBe(false);
  });

  it("keeps the name-keyed node for selectors with unknown definition", () => {
    const factsWithoutImports = selectorFacts.filter(
      (fact) => fact.type !== "import" && fact.type !== "resolvedImport"
    );
    const graph = buildGraph(factsWithoutImports, config(defaultConfig.fsd.segments));
    const edge = graph.edges.find((entry) => entry.type === "usesSelector");
    expect(edge?.to).toBe("selector:selectCurrentUser");
    expect(edge?.confidence).toBe("medium");
    expect(graph.nodes.find((entry) => entry.id === "selector:selectCurrentUser")?.meta?.unresolved).toBe(true);
  });

  it("resolves a locally exported selector to the source file", () => {
    const localFacts: ProjectFact[] = [
      { type: "export", sourceFile: hookFile, exportedNames: ["selectLocal", "useUserProfile"] },
      { type: "hook", name: "useUserProfile", file: hookFile, exported: true, location: { line: 3, column: 1 } },
      {
        type: "selectorUsage",
        sourceFile: hookFile,
        owner: "useUserProfile",
        selectorHook: "useAppSelector",
        selectorName: "selectLocal",
        location: { line: 5, column: 3 },
        code: "useAppSelector(selectLocal)",
      },
    ];
    const graph = buildGraph(localFacts, config(defaultConfig.fsd.segments));
    const edge = graph.edges.find((entry) => entry.type === "usesSelector");
    expect(edge?.to).toBe("selector:src/features/user-profile/model/useUserProfile#selectLocal");
  });
});

describe("buildGraph thunks", () => {
  const thunksFile = "src/entities/user/model/thunks.ts";
  const sliceFile = "src/entities/user/model/slice.ts";
  const hookFile = "src/features/user-profile/model/useUserProfile.ts";
  const thunkFacts: ProjectFact[] = [
    { type: "reduxThunk", name: "fetchUser", typePrefix: "user/fetchUser", file: thunksFile, location: { line: 3, column: 1 } },
    {
      type: "sliceWrite",
      sliceName: "user",
      writerName: "fetchUser",
      writerState: "fulfilled",
      file: sliceFile,
      location: { line: 12, column: 5 },
      code: "builder.addCase(fetchUser.fulfilled, (state) => state)",
    },
    { type: "hook", name: "useUserProfile", file: hookFile, exported: true, location: { line: 1, column: 1 } },
    {
      type: "dispatchCall",
      sourceFile: hookFile,
      owner: "useUserProfile",
      actionName: "fetchUser",
      location: { line: 9, column: 3 },
      code: "dispatch(fetchUser(\"1\"))",
    },
  ];

  it("connects the thunk to the slice it writes", () => {
    const graph = buildGraph(thunkFacts, config(defaultConfig.fsd.segments));
    const edge = graph.edges.find((entry) => entry.type === "writesSlice");
    expect(edge?.from).toBe("thunk:src/entities/user/model/thunks#fetchUser");
    expect(edge?.to).toBe("slice-model:user");
    expect(edge?.confidence).toBe("high");
  });

  it("resolves dispatched thunks to the thunk node", () => {
    const graph = buildGraph(thunkFacts, config(defaultConfig.fsd.segments));
    const edge = graph.edges.find((entry) => entry.type === "dispatchesAction");
    expect(edge?.to).toBe("thunk:src/entities/user/model/thunks#fetchUser");
    expect(edge?.confidence).toBe("high");
  });

  it("keeps unknown extraReducers writers visible as unresolved thunks", () => {
    const factsWithoutThunk = thunkFacts.filter((fact) => fact.type === "sliceWrite");
    const graph = buildGraph(factsWithoutThunk, config(defaultConfig.fsd.segments));
    const edge = graph.edges.find((entry) => entry.type === "writesSlice");
    expect(edge?.from).toBe("thunk:unknown:fetchUser");
    expect(edge?.confidence).toBe("low");
    expect(graph.nodes.find((entry) => entry.id === "thunk:unknown:fetchUser")?.meta?.unresolved).toBe(true);
  });
});

describe("buildGraph owner resolution", () => {
  it("attaches module-level usages to the file node", () => {
    const file = "src/shared/model/init.ts";
    const moduleFacts: ProjectFact[] = [
      { type: "file", file, extension: ".ts" },
      {
        type: "dispatchCall",
        sourceFile: file,
        owner: "<module>",
        actionName: "init",
        location: { line: 2, column: 1 },
        code: "dispatch(init())",
      },
    ];
    const graph = buildGraph(moduleFacts, config(defaultConfig.fsd.segments));
    const edge = graph.edges.find((entry) => entry.type === "dispatchesAction");
    expect(edge?.from).toBe(`file:${file}`);
  });

  it("classifies non-hook lowercase owners as components, matching analyzer fact ids", () => {
    const file = "src/widgets/record/ui/RecordCard.tsx";
    const helperFacts: ProjectFact[] = [
      {
        type: "selectorUsage",
        sourceFile: file,
        owner: "renderPrice",
        selectorHook: "useAppSelector",
        selectorName: "selectPrice",
        location: { line: 5, column: 3 },
        code: "useAppSelector(selectPrice)",
      },
    ];
    const graph = buildGraph(helperFacts, config(defaultConfig.fsd.segments));
    const edge = graph.edges.find((entry) => entry.type === "usesSelector");
    expect(edge?.from).toBe("component:src/widgets/record/ui/RecordCard#renderPrice");
  });
});

describe("buildGraph page-name inference", () => {
  it("treats a configured FSD segment as internal when inferring the page name", () => {
    const graph = buildGraph(facts, config([...defaultConfig.fsd.segments, "blocks"]));
    expect(graph.nodes.some((node) => node.id === "page:home")).toBe(true);
    expect(graph.nodes.some((node) => node.id === "page:blocks")).toBe(false);
    expect(graph.nodes.find((node) => node.id === "page:home")?.file).toBe(
      pageFile
    );
  });

  it("keeps an unconfigured segment as a path part", () => {
    const graph = buildGraph(facts, config(defaultConfig.fsd.segments));
    expect(graph.nodes.some((node) => node.id === "page:blocks")).toBe(true);
    expect(graph.nodes.some((node) => node.id === "page:home")).toBe(false);
  });
});
