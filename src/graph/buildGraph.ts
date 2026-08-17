import path from "node:path";
import type { ResolvedProjectMapConfig } from "../config/types.js";
import type {
  ComponentFact,
  DispatchCallFact,
  Evidence,
  FsdClassificationFact,
  HookCallFact,
  HookFact,
  ImportFact,
  InlineSelectorUsageFact,
  ProjectFact,
  ReduxActionFact,
  ReduxThunkFact,
  ResolvedImportFact,
  RtkQueryHookCallFact,
  SelectorUsageFact,
  SliceWriteFact,
} from "../scanner/facts.js";
import { ownerNodeId as sharedOwnerNodeId, type OwnerKind } from "../utils/ownerNodeId.js";
import { stripExtension } from "../utils/path.js";
import type { Confidence, EdgeType, NodeType, ProjectMapEdge, ProjectMapGraph, ProjectMapNode } from "./types.js";

type GraphIndexes = {
  nodes: Map<string, ProjectMapNode>;
  edges: Map<string, ProjectMapEdge>;
};

export function buildGraph(facts: ProjectFact[], config: ResolvedProjectMapConfig): ProjectMapGraph {
  const indexes: GraphIndexes = {
    nodes: new Map(),
    edges: new Map(),
  };
  const fsdByFile = new Map<string, FsdClassificationFact>();
  const componentsByName = new Map<string, ComponentFact[]>();
  const hooksByName = new Map<string, HookFact[]>();
  const actionsByName = new Map<string, ReduxActionFact[]>();
  const thunksByName = new Map<string, ReduxThunkFact[]>();
  const importFacts: ImportFact[] = [];
  const importTargetFiles = new Map<string, string>();
  const exportsByFile = new Map<string, Set<string>>();

  addNode(indexes, {
    id: "project:root",
    type: "project",
    name: path.basename(config.projectRoot),
    meta: { root: config.projectRoot },
  });

  for (const fact of facts) {
    if (fact.type === "fsdClassification") fsdByFile.set(fact.file, fact);
    if (fact.type === "component") pushMap(componentsByName, fact.name, fact);
    if (fact.type === "hook") pushMap(hooksByName, fact.name, fact);
    if (fact.type === "reduxAction") pushMap(actionsByName, fact.name, fact);
    if (fact.type === "reduxThunk") pushMap(thunksByName, fact.name, fact);
    if (fact.type === "import") importFacts.push(fact);
    if (fact.type === "resolvedImport" && fact.targetFile) {
      importTargetFiles.set(importKey(fact.sourceFile, fact.target), fact.targetFile);
    }
    if (fact.type === "export") exportsByFile.set(fact.sourceFile, new Set(fact.exportedNames));
  }
  const importedFileByName = buildImportedFileByName(importFacts, importTargetFiles);

  // Where a name used in sourceFile is defined: through its import when
  // resolvable, in sourceFile itself when exported locally, otherwise unknown.
  const resolveDefiningFile = (sourceFile: string, name: string): string | undefined => {
    const imported = importedFileByName.get(sourceFile)?.get(name);
    if (imported) return imported;
    return exportsByFile.get(sourceFile)?.has(name) ? sourceFile : undefined;
  };

  // Owner ids must match the ids the value-flow analyzers stamp into facts;
  // facts for the owner's file confirm the kind, the shared name heuristic is
  // the fallback. Module-level usages attach to the file node.
  const resolveOwnerId = (owner: string, file: string): string => {
    const kind: OwnerKind | undefined = componentsByName.get(owner)?.some((fact) => fact.file === file)
      ? "component"
      : hooksByName.get(owner)?.some((fact) => fact.file === file)
        ? "hook"
        : undefined;
    return sharedOwnerNodeId(owner, file, kind) ?? fileNodeId(file);
  };
  const pageInternalSegments = buildPageInternalSegments(config);
  const pageEntryFileByModuleId = collectPageEntryFiles(
    Array.from(componentsByName.values()).flat(),
    fsdByFile,
    pageInternalSegments
  );

  for (const fact of facts) {
    switch (fact.type) {
      case "file":
        addNode(indexes, {
          id: fileNodeId(fact.file),
          type: "file",
          name: path.basename(fact.file),
          file: fact.file,
          fsd: fsdByFile.get(fact.file),
          meta: { extension: fact.extension },
        });
        break;

      case "fsdClassification":
        if (fact.layer === "pages" && !pageEntryFileByModuleId.has(fsdModuleNodeId(fact, pageInternalSegments))) {
          break;
        }

        addFsdNodes(
          indexes,
          fact,
          pageInternalSegments,
          pageEntryFileByModuleId
        );
        addEdge(indexes, {
          from: "project:root",
          to: fsdModuleNodeId(fact, pageInternalSegments),
          type: "contains",
          confidence: "high",
          evidence: [],
        });
        addEdge(indexes, {
          from: fsdModuleNodeId(fact, pageInternalSegments),
          to: fileNodeId(fact.file),
          type: "contains",
          confidence: "high",
          evidence: [],
        });
        break;

      case "resolvedImport":
        addResolvedImport(indexes, fact, fsdByFile, pageInternalSegments);
        break;

      case "component":
        addComponent(indexes, fact, fsdByFile.get(fact.file));
        break;

      case "hook":
        addHook(indexes, fact, fsdByFile.get(fact.file));
        break;

      case "jsxUsage":
        addResolvedNameEdge(indexes, {
          from: componentNodeIdByName(fact.ownerComponent, fact.sourceFile),
          toCandidates: componentsByName.get(fact.componentName) ?? [],
          toId: componentNodeId,
          fallbackName: fact.componentName,
          fallbackType: "component",
          edgeType: "renders",
          evidence: factEvidence(fact.sourceFile, fact.location.line, fact.location.column, fact.code),
        });
        break;

      case "hookCall":
        addResolvedNameEdge(indexes, {
          from: resolveOwnerId(fact.owner, fact.sourceFile),
          toCandidates: hooksByName.get(fact.hookName) ?? [],
          toId: hookNodeId,
          fallbackName: fact.hookName,
          fallbackType: "hook",
          edgeType: "usesHook",
          evidence: factEvidence(fact.sourceFile, fact.location.line, fact.location.column, fact.code),
        });
        break;

      case "selectorUsage":
        addSelectorUsage(indexes, fact, {
          from: resolveOwnerId(fact.owner, fact.sourceFile),
          definingFile: resolveDefiningFile(fact.sourceFile, fact.selectorName),
          fsdByFile,
        });
        break;

      case "inlineSelectorUsage":
        addInlineSelectorUsage(indexes, fact, resolveOwnerId(fact.owner, fact.sourceFile));
        break;

      case "dispatchCall":
        addDispatchCall(indexes, fact, actionsByName, thunksByName, resolveOwnerId(fact.owner, fact.sourceFile));
        break;

      case "rtkQueryHookCall":
        addApiCall(indexes, fact, fsdByFile.get(fact.sourceFile), resolveOwnerId(fact.owner, fact.sourceFile));
        break;

      case "reduxSlice":
        addNode(indexes, {
          id: sliceModelNodeId(fact.name),
          type: "slice-model",
          name: fact.name,
          file: fact.file,
          fsd: fsdByFile.get(fact.file),
          meta: { variableName: fact.variableName },
        });
        addDefinedIn(indexes, sliceModelNodeId(fact.name), fact.file, factEvidence(fact.file, fact.location.line, fact.location.column));
        break;

      case "reduxAction":
        addNode(indexes, {
          id: sliceModelNodeId(fact.sliceName),
          type: "slice-model",
          name: fact.sliceName,
          file: fact.file,
          fsd: fsdByFile.get(fact.file),
        });
        addNode(indexes, {
          id: actionNodeId(`${fact.sliceName}.${fact.name}`),
          type: "action",
          name: `${fact.sliceName}.${fact.name}`,
          file: fact.file,
          fsd: fsdByFile.get(fact.file),
          meta: { sliceName: fact.sliceName, ...(fact.writes ? { writes: fact.writes } : {}) },
        });
        addEdge(indexes, {
          from: actionNodeId(`${fact.sliceName}.${fact.name}`),
          to: sliceModelNodeId(fact.sliceName),
          type: "writesSlice",
          confidence: "high",
          evidence: [factEvidence(fact.file, fact.location.line, fact.location.column)],
        });
        addDefinedIn(indexes, actionNodeId(`${fact.sliceName}.${fact.name}`), fact.file, factEvidence(fact.file, fact.location.line, fact.location.column));
        break;

      case "reduxThunk":
        addNode(indexes, {
          id: thunkNodeId(fact),
          type: "thunk",
          name: fact.name,
          file: fact.file,
          fsd: fsdByFile.get(fact.file),
          ...(fact.typePrefix ? { meta: { typePrefix: fact.typePrefix } } : {}),
        });
        addDefinedIn(indexes, thunkNodeId(fact), fact.file, factEvidence(fact.file, fact.location.line, fact.location.column));
        break;

      case "sliceWrite":
        addSliceWrite(indexes, fact, thunksByName, actionsByName);
        break;
    }
  }

  const nodes = Array.from(indexes.nodes.values()).sort((left, right) => left.id.localeCompare(right.id));
  const edges = Array.from(indexes.edges.values()).sort((left, right) => left.id.localeCompare(right.id));

  return {
    schemaVersion: "1.1.0",
    project: {
      name: path.basename(config.projectRoot),
      root: config.projectRoot,
      sourceRoot: config.sourceRoot,
    },
    nodes,
    edges,
    stats: {
      nodesCount: nodes.length,
      edgesCount: edges.length,
    },
  };
}

function addFsdNodes(
  indexes: GraphIndexes,
  fsd: FsdClassificationFact,
  internalSegments: ReadonlySet<string>,
  pageEntryFileByModuleId: ReadonlyMap<string, string>
) {
  const moduleFsd = fsdModuleFsd(fsd, internalSegments);
  const moduleId = fsdModuleNodeId(fsd, internalSegments);
  addNode(indexes, {
    id: moduleId,
    type: fsdNodeType(fsd.layer),
    name: moduleFsd.slice ?? moduleFsd.segment ?? moduleFsd.layer,
    ...(fsd.layer === "pages"
      ? { file: pageEntryFileByModuleId.get(moduleId) }
      : {}),
    fsd: moduleFsd,
  });
}

function addResolvedImport(
  indexes: GraphIndexes,
  fact: ResolvedImportFact,
  fsdByFile: Map<string, FsdClassificationFact>,
  internalSegments: ReadonlySet<string>
) {
  const from = fileNodeId(fact.sourceFile);
  const to = fact.external
    ? externalNodeId(fact.packageName ?? fact.target)
    : fact.targetFile
      ? fileNodeId(fact.targetFile)
      : unknownNodeId(fact.target);

  if (fact.external) {
    addNode(indexes, {
      id: to,
      type: "external-package",
      name: fact.packageName ?? fact.target,
    });
  }

  addEdge(indexes, {
    from,
    to,
    type: "imports",
    confidence: fact.resolved ? "high" : "low",
    evidence: [factEvidence(fact.sourceFile, fact.location.line, fact.location.column, `import "${fact.target}"`)],
  });

  const sourceFsd = fsdByFile.get(fact.sourceFile);
  const targetFsd = fact.targetFile ? fsdByFile.get(fact.targetFile) : undefined;
  if (sourceFsd && targetFsd && fsdModuleNodeId(sourceFsd, internalSegments) !== fsdModuleNodeId(targetFsd, internalSegments)) {
    addEdge(indexes, {
      from: fsdModuleNodeId(sourceFsd, internalSegments),
      to: fsdModuleNodeId(targetFsd, internalSegments),
      type: "dependsOn",
      confidence: "medium",
      evidence: [factEvidence(fact.sourceFile, fact.location.line, fact.location.column, `import "${fact.target}"`)],
    });
  }
}

function addComponent(indexes: GraphIndexes, fact: ComponentFact, fsd: FsdClassificationFact | undefined) {
  const id = componentNodeId(fact);
  addNode(indexes, {
    id,
    type: "component",
    name: fact.name,
    file: fact.file,
    fsd,
    meta: {
      exported: fact.exported,
      declaration: fact.declaration,
    },
  });
  addDefinedIn(indexes, id, fact.file, factEvidence(fact.file, fact.location.line, fact.location.column));
}

function addHook(indexes: GraphIndexes, fact: HookFact, fsd: FsdClassificationFact | undefined) {
  const id = hookNodeId(fact);
  addNode(indexes, {
    id,
    type: "hook",
    name: fact.name,
    file: fact.file,
    fsd,
    meta: { exported: fact.exported },
  });
  addDefinedIn(indexes, id, fact.file, factEvidence(fact.file, fact.location.line, fact.location.column));
}

function addSelectorUsage(
  indexes: GraphIndexes,
  fact: SelectorUsageFact,
  args: {
    from: string;
    definingFile: string | undefined;
    fsdByFile: Map<string, FsdClassificationFact>;
  }
) {
  const evidence = factEvidence(fact.sourceFile, fact.location.line, fact.location.column, fact.code);

  if (args.definingFile) {
    const selectorId = `selector:${stripExtension(args.definingFile)}#${fact.selectorName}`;
    addNode(indexes, {
      id: selectorId,
      type: "selector",
      name: fact.selectorName,
      file: args.definingFile,
      fsd: args.fsdByFile.get(args.definingFile),
    });
    addEdge(indexes, {
      from: args.from,
      to: selectorId,
      type: "usesSelector",
      confidence: "high",
      evidence: [evidence],
    });
    return;
  }

  // Definition not found through imports/exports: fall back to the global
  // name-keyed node, which may merge same-named selectors from different files.
  const selectorId = selectorNodeId(fact.selectorName);
  addNode(indexes, {
    id: selectorId,
    type: "selector",
    name: fact.selectorName,
    fsd: args.fsdByFile.get(fact.sourceFile),
    meta: { unresolved: true },
  });
  addEdge(indexes, {
    from: args.from,
    to: selectorId,
    type: "usesSelector",
    confidence: "medium",
    evidence: [evidence],
  });
}

function addInlineSelectorUsage(indexes: GraphIndexes, fact: InlineSelectorUsageFact, from: string) {
  if (!fact.sliceName) return;
  const sliceId = sliceModelNodeId(fact.sliceName);
  addNode(indexes, {
    id: sliceId,
    type: "slice-model",
    name: fact.sliceName,
    meta: { statePath: fact.statePath },
  });
  addEdge(indexes, {
    from,
    to: sliceId,
    type: "readsSlice",
    confidence: "medium",
    evidence: [factEvidence(fact.sourceFile, fact.location.line, fact.location.column, fact.code)],
  });
}

function addDispatchCall(
  indexes: GraphIndexes,
  fact: DispatchCallFact,
  actionsByName: Map<string, ReduxActionFact[]>,
  thunksByName: Map<string, ReduxThunkFact[]>,
  from: string
) {
  // The dispatch expression text can be `setUser`, `userActions.setUser` or
  // `userSlice.actions.setUser`; defined actions are keyed by bare reducer name.
  const actionName = fact.actionName.split(".").pop() ?? fact.actionName;
  const evidence = factEvidence(fact.sourceFile, fact.location.line, fact.location.column, fact.code);
  const actionCandidates = actionsByName.get(actionName) ?? [];

  if (actionCandidates.length > 0) {
    addResolvedNameEdge(indexes, {
      from,
      toCandidates: actionCandidates,
      toId: (candidate) => actionNodeId(`${candidate.sliceName}.${candidate.name}`),
      fallbackName: actionName,
      fallbackType: "action",
      edgeType: "dispatchesAction",
      evidence,
    });
    return;
  }

  // Not a slice action: dispatched thunks resolve here, anything else falls
  // back to an explicit unresolved action node.
  addResolvedNameEdge(indexes, {
    from,
    toCandidates: thunksByName.get(actionName) ?? [],
    toId: thunkNodeId,
    fallbackName: actionName,
    fallbackType: "action",
    edgeType: "dispatchesAction",
    evidence,
  });
}

// extraReducers cases: the writer is usually a thunk (fetchUser.fulfilled),
// sometimes an action from another slice; unknown writers stay visible as
// explicit unresolved thunk nodes.
function addSliceWrite(
  indexes: GraphIndexes,
  fact: SliceWriteFact,
  thunksByName: Map<string, ReduxThunkFact[]>,
  actionsByName: Map<string, ReduxActionFact[]>
) {
  const sliceId = sliceModelNodeId(fact.sliceName);
  addNode(indexes, {
    id: sliceId,
    type: "slice-model",
    name: fact.sliceName,
  });

  const evidence = factEvidence(fact.file, fact.location.line, fact.location.column, fact.code);
  const thunkCandidates = thunksByName.get(fact.writerName) ?? [];
  const actionCandidates = thunkCandidates.length === 0 ? actionsByName.get(fact.writerName) ?? [] : [];
  const writers: Array<{ id: string }> = [
    ...thunkCandidates.map((candidate) => ({ id: thunkNodeId(candidate) })),
    ...actionCandidates.map((candidate) => ({ id: actionNodeId(`${candidate.sliceName}.${candidate.name}`) })),
  ];

  if (writers.length === 0) {
    const fallbackId = `thunk:unknown:${fact.writerName}`;
    addNode(indexes, {
      id: fallbackId,
      type: "thunk",
      name: fact.writerName,
      meta: { unresolved: true },
    });
    writers.push({ id: fallbackId });
  }

  const confidence: Confidence = writers.length === 1 && (thunkCandidates.length > 0 || actionCandidates.length > 0)
    ? "high"
    : writers.length > 1
      ? "medium"
      : "low";

  for (const writer of writers) {
    addEdge(indexes, {
      from: writer.id,
      to: sliceId,
      type: "writesSlice",
      confidence,
      evidence: [evidence],
    });
  }
}

function addApiCall(
  indexes: GraphIndexes,
  fact: RtkQueryHookCallFact,
  fsd: FsdClassificationFact | undefined,
  from: string
) {
  const id = apiNodeId(fact.hookName);
  addNode(indexes, {
    id,
    type: "api",
    name: fact.hookName,
    fsd,
  });
  addEdge(indexes, {
    from,
    to: id,
    type: "callsApi",
    confidence: "medium",
    evidence: [factEvidence(fact.sourceFile, fact.location.line, fact.location.column, fact.code)],
  });
}

function addResolvedNameEdge<T extends { name: string }>(indexes: GraphIndexes, args: {
  from: string;
  toCandidates: T[];
  toId: (candidate: T) => string;
  fallbackName: string;
  fallbackType: NodeType;
  edgeType: EdgeType;
  evidence: Evidence;
}) {
  if (args.toCandidates.length === 0) {
    const fallbackId = `${args.fallbackType}:unknown:${args.fallbackName}`;
    addNode(indexes, {
      id: fallbackId,
      type: args.fallbackType,
      name: args.fallbackName,
      meta: { unresolved: true },
    });
    addEdge(indexes, {
      from: args.from,
      to: fallbackId,
      type: args.edgeType,
      confidence: "low",
      evidence: [args.evidence],
    });
    return;
  }

  const confidence: Confidence = args.toCandidates.length === 1 ? "high" : "medium";
  for (const candidate of args.toCandidates) {
    addEdge(indexes, {
      from: args.from,
      to: args.toId(candidate),
      type: args.edgeType,
      confidence,
      evidence: [args.evidence],
    });
  }
}

function addDefinedIn(indexes: GraphIndexes, from: string, file: string, evidence: Evidence) {
  addEdge(indexes, {
    from,
    to: fileNodeId(file),
    type: "definedIn",
    confidence: "high",
    evidence: [evidence],
  });
}

function addNode(indexes: GraphIndexes, node: ProjectMapNode) {
  if (indexes.nodes.has(node.id)) return;
  indexes.nodes.set(node.id, node);
}

function addEdge(indexes: GraphIndexes, edge: Omit<ProjectMapEdge, "id">) {
  const id = `edge:${edge.from}:${edge.type}:${edge.to}`;
  const existing = indexes.edges.get(id);
  if (existing) {
    existing.evidence.push(...edge.evidence);
    return;
  }

  indexes.edges.set(id, { id, ...edge });
}

function pushMap<TKey, TValue>(map: Map<TKey, TValue[]>, key: TKey, value: TValue) {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

function fsdNodeType(layer: string): NodeType {
  const singular: Record<string, NodeType> = {
    pages: "page",
    widgets: "widget",
    features: "feature",
    entities: "entity",
    shared: "shared",
  };

  return singular[layer] ?? "layer";
}

function fsdModuleNodeId(fsd: FsdClassificationFact, internalSegments: ReadonlySet<string>) {
  const type = fsdNodeType(fsd.layer);
  const moduleFsd = fsdModuleFsd(fsd, internalSegments);
  return `${type}:${moduleFsd.slice ?? moduleFsd.segment ?? moduleFsd.layer}`;
}

function fsdModuleFsd(fsd: FsdClassificationFact, internalSegments: ReadonlySet<string>): FsdClassificationFact {
  if (fsd.layer !== "pages") return fsd;

  const pageName = inferPageNameFromPath(fsd.file, internalSegments) ?? fsd.slice ?? fsd.segment ?? fsd.layer;
  return {
    ...fsd,
    slice: pageName,
  };
}

function inferPageNameFromPath(filePath: string, internalSegments: ReadonlySet<string>): string | null {
  const parts = filePath.split("/").filter(Boolean);
  const pagesIndex = parts.indexOf("pages");
  if (pagesIndex < 0) return null;

  const pathAfterPages = parts.slice(pagesIndex + 1);
  const directoryParts = pathAfterPages.slice(0, -1);
  const pageDirectories = directoryParts.filter((part) => !internalSegments.has(part));
  if (pageDirectories.length > 0) {
    return pageDirectories[pageDirectories.length - 1] ?? null;
  }

  const fileName = pathAfterPages[pathAfterPages.length - 1];
  if (!fileName) return null;

  return stripExtension(fileName);
}

// Directory names that live *inside* a page module and therefore must be
// skipped when inferring the page's own name from its path. Built from the
// configured FSD segments plus common internal folders that are not segments.
function buildPageInternalSegments(config: ResolvedProjectMapConfig): ReadonlySet<string> {
  return new Set([...config.fsd.segments, ...EXTRA_PAGE_INTERNAL_DIRS]);
}

const EXTRA_PAGE_INTERNAL_DIRS = ["constants", "hooks", "services", "store"];

function collectPageEntryFiles(
  components: ComponentFact[],
  fsdByFile: Map<string, FsdClassificationFact>,
  internalSegments: ReadonlySet<string>
) {
  const candidatesByPageId = new Map<string, ComponentFact[]>();

  for (const component of components) {
    const fsd = fsdByFile.get(component.file);
    if (fsd?.layer === "pages") {
      pushMap(
        candidatesByPageId,
        fsdModuleNodeId(fsd, internalSegments),
        component
      );
    }
  }

  return new Map(
    [...candidatesByPageId].map(([pageId, candidates]) => [
      pageId,
      choosePageEntryComponent(pageId, candidates).file,
    ])
  );
}

function choosePageEntryComponent(
  pageId: string,
  candidates: ComponentFact[]
) {
  const pageName = pageId.slice("page:".length);
  const normalizedPageName = normalizePageEntryName(pageName);
  return [...candidates].sort((left, right) =>
    pageEntryScore(right, normalizedPageName) -
      pageEntryScore(left, normalizedPageName) ||
    left.file.localeCompare(right.file) ||
    left.name.localeCompare(right.name)
  )[0]!;
}

function pageEntryScore(component: ComponentFact, normalizedPageName: string) {
  let score = 0;
  const componentName = normalizePageEntryName(component.name);
  const fileName = normalizePageEntryName(path.basename(stripExtension(component.file)));
  if (componentName === normalizedPageName) score += 100;
  if (componentName === `${normalizedPageName}page`) score += 90;
  if (fileName === componentName) score += 20;
  if (component.name.endsWith("Page")) score += 10;
  if (component.exported) score += 5;
  return score;
}

function normalizePageEntryName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function fileNodeId(file: string) {
  return `file:${file}`;
}

function componentNodeId(fact: ComponentFact) {
  return componentNodeIdByName(fact.name, fact.file);
}

function componentNodeIdByName(name: string, file: string) {
  return `component:${stripExtension(file)}#${name}`;
}

function hookNodeId(fact: HookFact) {
  return `hook:${stripExtension(fact.file)}#${fact.name}`;
}

function selectorNodeId(name: string) {
  return `selector:${name}`;
}

function actionNodeId(name: string) {
  return `action:${name}`;
}

function thunkNodeId(fact: ReduxThunkFact) {
  return `thunk:${stripExtension(fact.file)}#${fact.name}`;
}

function sliceModelNodeId(name: string) {
  return `slice-model:${name}`;
}

function apiNodeId(name: string) {
  return `api:${name}`;
}

function externalNodeId(name: string) {
  return `external-package:${name}`;
}

function unknownNodeId(name: string) {
  return `unknown:${name}`;
}

function importKey(sourceFile: string, target: string) {
  return `${sourceFile}\n${target}`;
}

// sourceFile -> imported name -> the file that import resolves to.
function buildImportedFileByName(importFacts: ImportFact[], importTargetFiles: Map<string, string>) {
  const importedFileByName = new Map<string, Map<string, string>>();

  for (const fact of importFacts) {
    const targetFile = importTargetFiles.get(importKey(fact.sourceFile, fact.target));
    if (!targetFile) continue;

    const names = importedFileByName.get(fact.sourceFile) ?? new Map<string, string>();
    for (const name of fact.importedNames) names.set(name, targetFile);
    if (fact.defaultImportName) names.set(fact.defaultImportName, targetFile);
    importedFileByName.set(fact.sourceFile, names);
  }

  return importedFileByName;
}

function factEvidence(file: string, line: number, column: number, code?: string): Evidence {
  return {
    file,
    line,
    column,
    ...(code ? { code } : {}),
  };
}
