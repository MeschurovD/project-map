import type { ProjectMapGraph, ProjectMapNode } from "../graph/types.js";
import type { ProjectFact } from "../scanner/facts.js";
import {
  FLOW_SCHEMA_VERSION,
  type FlowBuildMetadata,
  type FlowCoverage,
  type FlowCompleteness,
  type FlowEdge,
  type FlowEvidence,
  type FlowIndex,
  type FlowNode,
  type FlowNodeKind,
  type FlowRelation,
  type ValueFlow,
} from "./types.js";
import { resolveValueFlowTargets } from "./resolveValueFlowTargets.js";
import { buildComponentStructures } from "./buildComponentStructures.js";

type SelectorStateReadFact = Extract<ProjectFact, { type: "selectorStateRead" }>;
type SelectorBindingFact = Extract<ProjectFact, { type: "selectorBinding" }>;
type HookReturnDependencyFact = Extract<ProjectFact, { type: "hookReturnDependency" }>;
type HookBindingFact = Extract<ProjectFact, { type: "hookBinding" }>;
type HookReturnSpreadFact = Extract<ProjectFact, { type: "hookReturnSpread" }>;
type HookDeclarationShapeFact = Extract<ProjectFact, { type: "hookDeclarationShape" }>;
type HookReturnUsageFact = Extract<ProjectFact, { type: "hookReturnUsage" }>;
type LocalVariableUsageFact = Extract<ProjectFact, { type: "localVariableUsage" }>;
type ReduxThunkFact = Extract<ProjectFact, { type: "reduxThunk" }>;
type SliceWriteFact = Extract<ProjectFact, { type: "sliceWrite" }>;
type EvidencedFlowFact =
  | SelectorStateReadFact
  | SelectorBindingFact
  | HookBindingFact
  | HookReturnDependencyFact
  | HookReturnSpreadFact
  | HookReturnUsageFact
  | LocalVariableUsageFact
  | ReduxThunkFact
  | SliceWriteFact;

export type BuildFlowIndexInput = {
  graph: ProjectMapGraph;
  facts: ProjectFact[];
  metadata: FlowBuildMetadata;
};

type BuildState = {
  graph: ProjectMapGraph;
  nodes: Map<string, FlowNode>;
  edges: Map<string, FlowEdge>;
  subjectNodeIds: Set<string>;
  /** Selector names declared per file, used to resolve composition bases. */
  selectorNamesByFile: Map<string, Set<string>>;
  /** Declaration files per selector name, used for unambiguous cross-file composition. */
  selectorFilesByName: Map<string, Set<string>>;
};

/**
 * Normalize value-flow facts into a UI-independent, source-to-consumer graph.
 *
 * Normalization grows milestone by milestone without changing the global
 * node/edge/flow contract. It currently covers selector reads/bindings and
 * hook-return paths through component props and inline selectors. Async/API
 * sources are added by later milestones.
 */
export function buildFlowIndex(input: BuildFlowIndexInput): FlowIndex {
  const facts = resolveValueFlowTargets(input.facts, input.graph);
  const selectorNamesByFile = new Map<string, Set<string>>();
  const selectorFilesByName = new Map<string, Set<string>>();
  for (const fact of facts) {
    if (fact.type !== "selectorStateRead") continue;
    const names = selectorNamesByFile.get(fact.file) ?? new Set<string>();
    names.add(fact.selectorName);
    selectorNamesByFile.set(fact.file, names);
    const files = selectorFilesByName.get(fact.selectorName) ?? new Set<string>();
    files.add(fact.file);
    selectorFilesByName.set(fact.selectorName, files);
  }

  const state: BuildState = {
    graph: input.graph,
    nodes: new Map(),
    edges: new Map(),
    subjectNodeIds: new Set(),
    selectorNamesByFile,
    selectorFilesByName,
  };

  for (const fact of facts) {
    if (fact.type === "selectorStateRead") addSelectorStateRead(state, fact);
  }

  for (const fact of facts) {
    if (fact.type === "selectorBinding") addSelectorBinding(state, fact);
  }

  for (const fact of facts) {
    if (fact.type === "localVariableUsage") addLocalVariableUsage(state, fact);
  }

  for (const fact of facts) {
    if (fact.type === "hookReturnDependency") addHookReturnDependency(state, fact);
  }

  for (const fact of facts) {
    if (fact.type === "hookReturnUsage") addHookReturnUsage(state, fact);
  }

  addHookReturnSpreads(state, facts);
  addExternalHookBoundaries(state, facts);

  addHookReturnSourceGaps(state);

  for (const fact of facts) {
    if (fact.type === "reduxThunk") addThunkApiSources(state, fact);
  }

  for (const fact of facts) {
    if (fact.type === "sliceWrite") addSliceWrite(state, fact, facts);
  }

  const nodes = [...state.nodes.values()].sort(byId);
  const edges = [...state.edges.values()].sort(byId);
  const flows = [...state.subjectNodeIds]
    .sort()
    .map((subjectNodeId) => buildValueFlow(subjectNodeId, nodes, edges));

  return {
    schemaVersion: FLOW_SCHEMA_VERSION,
    ...input.metadata,
    nodes,
    edges,
    flows,
    componentStructures: buildComponentStructures(input.graph, facts),
    stats: {
      flowsCount: flows.length,
      completeFlowsCount: flows.filter((flow) => flow.completeness === "complete").length,
      gapsCount: nodes.filter((node) => node.kind === "gap").length,
      originResolvedFlowsCount: flows.filter((flow) =>
        flow.coverage.origin === "proven" || flow.coverage.origin === "boundary"
      ).length,
      originGapFlowsCount: flows.filter((flow) => flow.coverage.origin === "gap").length,
      originUnknownFlowsCount: flows.filter((flow) => flow.coverage.origin === "unknown").length,
      continuationResolvedFlowsCount: flows.filter((flow) =>
        flow.coverage.continuation === "proven"
      ).length,
    },
  };
}

function addSelectorStateRead(state: BuildState, fact: SelectorStateReadFact): void {
  const selector = selectorNode(state.graph, fact.selectorName, fact.file, fact.confidence, evidenceOf(fact));
  addNode(state, selector);

  if (fact.derivedFromSelectors && fact.derivedFromSelectors.length > 0) {
    const sameFile = state.selectorNamesByFile.get(fact.file) ?? new Set<string>();
    let resolvedAny = false;
    let sawCrossFile = false;

    for (const inputName of fact.derivedFromSelectors) {
      if (sameFile.has(inputName)) {
        const input = selectorNode(state.graph, inputName, fact.file, fact.confidence, evidenceOf(fact));
        addNode(state, input);
        addEdge(state, input.id, selector.id, "derives", fact.confidence, evidenceOf(fact));
        resolvedAny = true;
      } else {
        const files = [...(state.selectorFilesByName.get(inputName) ?? [])];
        if (files.length === 1) {
          const input = selectorNode(state.graph, inputName, files[0], fact.confidence, evidenceOf(fact));
          addNode(state, input);
          addEdge(state, input.id, selector.id, "derives", fact.confidence, evidenceOf(fact));
          resolvedAny = true;
        } else {
          sawCrossFile = true;
        }
      }
    }

    // A composition whose base lives in another file cannot be resolved without
    // an import graph. Record it as a distinct, measurable gap rather than
    // guessing a state path.
    if (!resolvedAny && sawCrossFile) {
      addSelectorSourceGap(state, selector, evidenceOf(fact), "selector-composed-cross-file");
    }
    return;
  }

  if (fact.statePath) {
    const source = stateFieldNode(
      state.graph,
      fact.statePath,
      fact.confidence,
      evidenceOf(fact)
    );
    if (source) {
      addNode(state, source);
      addEdge(state, source.id, selector.id, "selects", fact.confidence, evidenceOf(fact));
      return;
    }

    addSelectorSourceGap(state, selector, evidenceOf(fact), "unsupported-state-read");
    return;
  }

  if (fact.constant) {
    // A constant selector (`() => false`) starts locally by construction. It is
    // a legitimate boundary, not a failed state read.
    const boundary: FlowNode = {
      id: `boundary:${selector.ownerNodeId ?? encodeIdPart(fact.file)}#constant:${encodeIdPart(fact.selectorName)}`,
      kind: "boundary",
      name: `${fact.selectorName} constant`,
      ownerNodeId: selector.ownerNodeId,
      path: fact.selectorName,
      confidence: fact.confidence,
      evidence: evidenceOf(fact),
    };
    addNode(state, boundary);
    addEdge(state, boundary.id, selector.id, "derives", fact.confidence, evidenceOf(fact));
    return;
  }

  // A placeholder for a selector whose body could not be parsed (emitted when
  // it is the base of a same-file composition): an honest generic gap.
  addSelectorSourceGap(state, selector, evidenceOf(fact), "selector-source-not-recorded");
}

function addSelectorBinding(state: BuildState, fact: SelectorBindingFact): void {
  const selector = selectorNodeForBinding(state.graph, fact);
  addNode(state, selector);

  if (fact.statePath) {
    const source = stateFieldNode(
      state.graph,
      fact.statePath,
      fact.confidence,
      evidenceOf(fact)
    );
    if (source) {
      addNode(state, source);
      addEdge(state, source.id, selector.id, "selects", fact.confidence, evidenceOf(fact));
    }
  }

  if (!hasIncomingEdge(state.edges, selector.id)) {
    addSelectorSourceGap(state, selector, evidenceOf(fact), "selector-source-not-recorded");
  }

  const valueKind: FlowNodeKind = fact.ownerNodeId?.startsWith("hook:")
    ? "hook-input"
    : "component-value";
  const ownerIdentity = fact.ownerNodeId ?? `owner:${encodeIdPart(fact.file)}#${encodeIdPart(fact.owner)}`;
  const value: FlowNode = {
    id: `${valueKind}:${ownerIdentity}#${encodeIdPart(fact.localName)}`,
    kind: valueKind,
    name: fact.localName,
    ownerNodeId: fact.ownerNodeId,
    path: fact.localName,
    valueSemantics: fact.valueType ? {
      type: fact.valueType,
      transformation: {
        kind: "direct",
        inputPaths: [fact.localName],
        expression: fact.localName,
        code: fact.code ?? fact.localName,
        file: fact.file,
        line: fact.location?.line,
        endLine: fact.location?.line && fact.code
          ? fact.location.line + fact.code.split("\n").length - 1
          : fact.location?.line,
        expressionLine: fact.location?.line,
      },
    } : undefined,
    confidence: fact.confidence,
    evidence: evidenceOf(fact),
  };

  addNode(state, value);
  addEdge(state, selector.id, value.id, "binds", fact.confidence, evidenceOf(fact));
  state.subjectNodeIds.add(value.id);
}

function addHookReturnDependency(state: BuildState, fact: HookReturnDependencyFact): void {
  const hookReturn = {
    ...hookReturnNode(state.graph, fact.hookName, fact.field, fact.file, fact.confidence, evidenceOf(fact)),
    valueSemantics: fact.valueSemantics,
  };
  addNode(state, hookReturn);

  const resolvedLocals = new Set<string>();
  for (const dependency of fact.dependsOn) {
    const input = [...state.nodes.values()].find((node) =>
      node.kind === "hook-input" &&
      node.name === dependency &&
      node.ownerNodeId === hookReturn.ownerNodeId
    );
    if (input) {
      addEdge(state, input.id, hookReturn.id, "derives", fact.confidence, evidenceOf(fact));
      resolvedLocals.add(dependency);
    }
  }

  for (const source of fact.hookSources ?? []) {
    if (resolvedLocals.has(source.localName)) continue;
    const nestedReturn = hookReturnNode(
      state.graph,
      source.hookName,
      source.field,
      undefined,
      fact.confidence,
      evidenceOf(fact)
    );
    addNode(state, nestedReturn);
    addEdge(state, nestedReturn.id, hookReturn.id, "derives", fact.confidence, evidenceOf(fact));
    resolvedLocals.add(source.localName);
  }

  for (const source of fact.boundarySources ?? []) {
    if (resolvedLocals.has(source.name)) continue;
    const boundary: FlowNode = {
      id: `boundary:${hookReturn.ownerNodeId ?? encodeIdPart(fact.hookName)}#${source.kind}:${encodeIdPart(source.name)}`,
      kind: "boundary",
      name: source.name,
      ownerNodeId: hookReturn.ownerNodeId,
      path: source.name,
      confidence: fact.confidence,
      evidence: boundaryEvidence(fact, source),
    };
    addNode(state, boundary);
    addEdge(state, boundary.id, hookReturn.id, "derives", fact.confidence, boundary.evidence);
  }
}

function addLocalVariableUsage(state: BuildState, fact: LocalVariableUsageFact): void {
  const value = [...state.nodes.values()].find((node) =>
    (node.kind === "component-value" || node.kind === "hook-input") &&
    node.ownerNodeId === fact.ownerNodeId &&
    (node.name === fact.variableName || node.path === fact.variableName)
  );
  if (!value) return;

  const evidence = evidenceOf(fact);
  if (
    fact.usageKind === "conditionalRender" ||
    fact.usageKind === "ternaryCondition" ||
    fact.usageKind === "renderedExpression"
  ) {
    const effectPath = [fact.variableName, fact.propertyPath].filter(Boolean).join(".");
    const targetLabel = fact.targetName ? ` → ${fact.targetName}` : "";
    const effect: FlowNode = {
      id: `ui-effect:${value.ownerNodeId ?? encodeIdPart(fact.file)}#${encodeIdPart(
        `${fact.usageKind}:${effectPath}:${fact.targetName ?? ""}`
      )}`,
      kind: "ui-effect",
      name: `${usageEffectLabel(fact.usageKind)} ${effectPath}${targetLabel}`,
      ownerNodeId: value.ownerNodeId,
      path: effectPath,
      uiEffect: {
        kind: fact.usageKind === "renderedExpression" ? "rendered-value" : "conditional-render",
        targetName: fact.targetName,
      },
      confidence: fact.confidence,
      evidence,
    };
    addNode(state, effect);
    addEdge(state, value.id, effect.id, "controls", fact.confidence, evidence);
    return;
  }

  if ((fact.usageKind === "prop" || fact.usageKind === "eventHandler") && fact.targetName && fact.propName) {
    const targetIdentity = fact.targetNodeId ?? `component:unresolved:${encodeIdPart(fact.targetName)}`;
    const occurrenceIdentity = fact.targetOccurrenceId ?? targetIdentity;
    const propPath = `${fact.targetName}.${fact.propName}`;
    const prop: FlowNode = {
      id: `prop:${occurrenceIdentity}#${encodeIdPart(fact.propName)}`,
      kind: "prop",
      name: propPath,
      ownerNodeId: fact.targetNodeId,
      occurrenceId: fact.targetOccurrenceId,
      path: propPath,
      confidence: fact.confidence,
      evidence,
    };
    addNode(state, prop);
    addEdge(state, value.id, prop.id, "passes", fact.confidence, evidence);
  }
}

function usageEffectLabel(kind: LocalVariableUsageFact["usageKind"]): string {
  if (kind === "conditionalRender" || kind === "ternaryCondition") return "controls render:";
  return "renders value:";
}

function addHookReturnUsage(state: BuildState, fact: HookReturnUsageFact): void {
  if (!fact.sourceField) return;

  const evidence = evidenceOf(fact);
  const hookReturn = hookReturnNode(
    state.graph,
    fact.hookName,
    fact.sourceField,
    undefined,
    fact.confidence,
    evidence
  );
  addNode(state, hookReturn);
  const canonicalHookReturn = state.nodes.get(hookReturn.id) ?? hookReturn;
  if (fact.externalModule && !hasIncomingEdge(state.edges, hookReturn.id)) {
    const boundary: FlowNode = {
      id: `boundary:external-hook:${encodeIdPart(fact.externalModule)}#${encodeIdPart(`${fact.hookName}.${fact.sourceField}`)}`,
      kind: "boundary",
      name: `${fact.hookName}.${fact.sourceField}`,
      ownerNodeId: hookReturn.ownerNodeId,
      path: fact.sourceField,
      confidence: fact.confidence,
      evidence,
    };
    addNode(state, boundary);
    addEdge(state, boundary.id, hookReturn.id, "derives", fact.confidence, evidence);
  }
  if (!hasIncomingEdge(state.edges, hookReturn.id)) {
    const parentReturn = nearestParentHookReturn(state, fact, evidence);
    if (parentReturn) {
      addEdge(state, parentReturn.id, hookReturn.id, "derives", fact.confidence, evidence);
    }
  }

  const componentPath = fact.localName === fact.sourceField
    ? fact.localName
    : `${fact.localName}.${fact.sourceField}`;
  const ownerIdentity = fact.ownerNodeId ?? `owner:${encodeIdPart(fact.file)}#${encodeIdPart(fact.owner)}`;
  const componentValue: FlowNode = {
    id: `component-value:${ownerIdentity}#${encodeIdPart(componentPath)}`,
    kind: "component-value",
    name: componentPath,
    ownerNodeId: fact.ownerNodeId,
    path: componentPath,
    valueSemantics: canonicalHookReturn.valueSemantics,
    confidence: fact.confidence,
    evidence,
  };
  addNode(state, componentValue);
  addEdge(state, hookReturn.id, componentValue.id, "returns", fact.confidence, evidence);
  state.subjectNodeIds.add(componentValue.id);

  if (fact.usageKind === "conditionalRender") {
    const targetLabel = fact.targetName ? ` → ${fact.targetName}` : "";
    const effect: FlowNode = {
      id: `ui-effect:${componentValue.ownerNodeId ?? encodeIdPart(fact.file)}#${encodeIdPart(
        `${fact.usageKind}:${componentPath}:${fact.targetName ?? ""}`
      )}`,
      kind: "ui-effect",
      name: `${usageEffectLabel(fact.usageKind)} ${componentPath}${targetLabel}`,
      ownerNodeId: componentValue.ownerNodeId,
      path: componentPath,
      uiEffect: {
        kind: "conditional-render",
        targetName: fact.targetName,
      },
      confidence: fact.confidence,
      evidence,
    };
    addNode(state, effect);
    addEdge(state, componentValue.id, effect.id, "controls", fact.confidence, evidence);
    return;
  }

  if (!fact.targetName || !fact.propName) return;
  const targetIdentity = fact.targetNodeId ?? `component:unresolved:${encodeIdPart(fact.targetName)}`;
  const occurrenceIdentity = fact.targetOccurrenceId ?? targetIdentity;
  const propPath = `${fact.targetName}.${fact.propName}`;
  const prop: FlowNode = {
    id: `prop:${occurrenceIdentity}#${encodeIdPart(fact.propName)}`,
    kind: "prop",
    name: propPath,
    ownerNodeId: fact.targetNodeId,
    occurrenceId: fact.targetOccurrenceId,
    path: propPath,
    confidence: fact.confidence,
    evidence,
  };
  addNode(state, prop);
  addEdge(state, componentValue.id, prop.id, "passes", fact.confidence, evidence);
}

function nearestParentHookReturn(
  state: BuildState,
  fact: HookReturnUsageFact,
  evidence: FlowEvidence[]
): FlowNode | undefined {
  const segments = fact.sourceField?.split(".") ?? [];
  for (let length = segments.length - 1; length > 0; length -= 1) {
    const candidate = hookReturnNode(
      state.graph,
      fact.hookName,
      segments.slice(0, length).join("."),
      undefined,
      fact.confidence,
      evidence
    );
    const existing = state.nodes.get(candidate.id);
    if (existing?.kind === "hook-return") return existing;
  }
  return undefined;
}

function addHookReturnSpreads(state: BuildState, facts: ProjectFact[]): void {
  const shapes = facts.filter((fact): fact is HookDeclarationShapeFact => fact.type === "hookDeclarationShape");
  const spreads = facts.filter((fact): fact is HookReturnSpreadFact => fact.type === "hookReturnSpread");

  for (const spread of spreads) {
    const parentOwner = resolveNamedGraphNode(state.graph, "hook", spread.hookName, spread.file);
    if (!parentOwner) continue;
    const sourceShapes = shapes.filter((shape) => shape.hookName === spread.sourceHookName);
    if (sourceShapes.length !== 1) continue;
    const sourceFields = new Set(sourceShapes[0].returnShape?.fields ?? []);

    const parentReturns = [...state.nodes.values()].filter((node) =>
      node.kind === "hook-return" && node.ownerNodeId === parentOwner.id
    );
    for (const parentReturn of parentReturns) {
      const field = parentReturn.path?.split(".")[0];
      if (!field || !sourceFields.has(field)) continue;
      const evidence = evidenceOf(spread);
      const sourceReturn = hookReturnNode(
        state.graph,
        spread.sourceHookName,
        parentReturn.path ?? field,
        sourceShapes[0].file,
        spread.confidence,
        evidence
      );
      addNode(state, sourceReturn);
      addEdge(state, sourceReturn.id, parentReturn.id, "derives", spread.confidence, evidence);
    }
  }
}

function addExternalHookBoundaries(state: BuildState, facts: ProjectFact[]): void {
  const bindings = facts.filter((fact): fact is HookBindingFact =>
    fact.type === "hookBinding" && Boolean(fact.externalModule)
  );

  for (const binding of bindings) {
    const fields = binding.boundTo.kind === "identifier"
      ? ["$return"]
      : binding.boundTo.kind === "objectDestructure"
        ? binding.boundTo.fields.map((field) => field.sourceName)
        : binding.boundTo.kind === "arrayDestructure"
          ? binding.boundTo.items.map((item) => String(item.index))
          : [];
    for (const field of fields) {
      const returned = hookReturnNode(
        state.graph,
        binding.hookName,
        field,
        undefined,
        binding.confidence,
        evidenceOf(binding)
      );
      const existing = state.nodes.get(returned.id);
      if (!existing || hasIncomingEdge(state.edges, existing.id)) continue;
      const boundary: FlowNode = {
        id: `boundary:external-hook:${encodeIdPart(binding.externalModule!)}#${encodeIdPart(`${binding.hookName}.${field}`)}`,
        kind: "boundary",
        name: `${binding.hookName}.${field}`,
        ownerNodeId: existing.ownerNodeId,
        path: field,
        confidence: binding.confidence,
        evidence: evidenceOf(binding),
      };
      addNode(state, boundary);
      addEdge(state, boundary.id, existing.id, "derives", binding.confidence, boundary.evidence);
    }
  }
}

function hookReturnNode(
  graph: ProjectMapGraph,
  hookName: string,
  fieldPath: string,
  sourceFile: string | undefined,
  confidence: FlowNode["confidence"],
  evidence: FlowEvidence[]
): FlowNode {
  const owner = resolveNamedGraphNode(graph, "hook", hookName, sourceFile);
  const ownerIdentity = owner?.id ?? `hook:unresolved:${encodeIdPart(sourceFile ?? "unknown")}#${encodeIdPart(hookName)}`;
  return {
    id: `hook-return:${ownerIdentity}#${encodeIdPart(fieldPath)}`,
    kind: "hook-return",
    name: `${hookName}.${fieldPath}`,
    ownerNodeId: owner?.id,
    path: fieldPath,
    confidence,
    evidence,
  };
}

function addThunkApiSources(state: BuildState, fact: ReduxThunkFact): void {
  if (!fact.apiCalls || fact.apiCalls.length === 0) return;

  const operation = asyncOperationNode(state.graph, fact, "fulfilled", "medium", evidenceOf(fact));
  addNode(state, operation);

  for (const call of fact.apiCalls) {
    const evidence: FlowEvidence[] = [{
      file: fact.file,
      line: call.line,
      code: call.code,
      codeStartLine: call.codeStartLine,
    }];
    const serviceCall = call.kind === "service";
    const api: FlowNode = {
      id: serviceCall
        ? `api:service:${encodeIdPart(call.url)}`
        : `api:http:${encodeIdPart(call.method.toUpperCase())}:${encodeIdPart(normalizeEndpointId(call.url))}`,
      kind: "api",
      name: serviceCall ? call.url : `${call.method.toUpperCase()} ${call.url}`,
      path: call.url,
      confidence: "medium",
      evidence,
    };
    addNode(state, api);
    addEdge(state, api.id, operation.id, "produces", "medium", evidence);
  }
}

function addSliceWrite(state: BuildState, fact: SliceWriteFact, facts: ProjectFact[]): void {
  const candidates = facts.filter((entry): entry is ReduxThunkFact =>
    entry.type === "reduxThunk" && entry.name === fact.writerName
  );
  const thunk = candidates.length === 1 ? candidates[0] : undefined;
  if (!thunk) return;

  const lifecycle = fact.writerState ?? "dispatch";
  const operation = asyncOperationNode(state.graph, thunk, lifecycle, "high", evidenceOf(fact));
  addNode(state, operation);

  const sliceOwner = resolveNamedGraphNode(state.graph, "slice-model", fact.sliceName);
  const sliceOwnerId = sliceOwner?.id ?? `slice-model:${encodeIdPart(fact.sliceName)}`;
  const stateFields = [...state.nodes.values()].filter((node) =>
    node.kind === "state-field" &&
    (Boolean(sliceOwner && node.ownerNodeId === sliceOwner.id) || node.id.startsWith(`state-field:${sliceOwnerId}#`))
  );

  for (const write of fact.writes ?? []) {
    const expectedPath = `state.${fact.sliceName}.${write.statePath}`;
    const field = stateFields.find((candidate) => candidate.path === expectedPath);
    if (!field) continue;
    const evidence: FlowEvidence[] = [{
      file: fact.file,
      line: write.location.line,
      column: write.location.column,
      code: write.code,
    }];
    addEdge(
      state,
      operation.id,
      field.id,
      "writes",
      write.valueOrigin === "unknown" ? "low" : "high",
      evidence,
      {
        statePath: expectedPath,
        lifecycle,
        valueOrigin: write.valueOrigin,
        ...(write.payloadPath ? { payloadPath: write.payloadPath } : {}),
      }
    );
  }
}

function asyncOperationNode(
  graph: ProjectMapGraph,
  fact: ReduxThunkFact,
  lifecycle: string,
  confidence: FlowNode["confidence"],
  evidence: FlowEvidence[]
): FlowNode {
  const owner = resolveNamedGraphNode(graph, "thunk", fact.name, fact.file);
  const ownerIdentity = owner?.id ?? `thunk:unresolved:${encodeIdPart(fact.file)}#${encodeIdPart(fact.name)}`;
  return {
    id: `async-operation:${ownerIdentity}#${encodeIdPart(lifecycle)}`,
    kind: "async-operation",
    name: `${fact.name}.${lifecycle}`,
    ownerNodeId: owner?.id,
    path: fact.typePrefix ? `${fact.typePrefix}.${lifecycle}` : lifecycle,
    confidence,
    evidence,
  };
}

function normalizeEndpointId(url: string): string {
  return url.trim().replace(/\$\{([^}]+)\}/g, "{$1}");
}

function selectorNode(
  graph: ProjectMapGraph,
  selectorName: string,
  sourceFile: string,
  confidence: FlowNode["confidence"],
  evidence: FlowEvidence[]
): FlowNode {
  const owner = resolveNamedGraphNode(graph, "selector", selectorName, sourceFile);
  const ownerIdentity = owner?.id ?? `selector:unresolved:${encodeIdPart(sourceFile)}#${encodeIdPart(selectorName)}`;

  return {
    id: `selector-result:${ownerIdentity}`,
    kind: "selector-result",
    name: selectorName,
    ownerNodeId: owner?.id,
    confidence,
    evidence,
  };
}

/**
 * Resolve the selector node for a binding. Name+file resolution fails for
 * cross-file bindings when several graph nodes share the selector name (e.g.
 * a barrel re-export next to the defining file); the graph's `usesSelector`
 * edge from the binding owner already resolved the import, so prefer it —
 * it is topology evidence, not a name guess.
 */
function selectorNodeForBinding(graph: ProjectMapGraph, fact: SelectorBindingFact): FlowNode {
  const evidence = evidenceOf(fact);
  if (fact.selectorFile) {
    const defined = resolveNamedGraphNode(graph, "selector", fact.selectorName, fact.selectorFile);
    if (defined) {
      return {
        id: `selector-result:${defined.id}`,
        kind: "selector-result",
        name: fact.selectorName,
        ownerNodeId: defined.id,
        confidence: fact.confidence,
        evidence,
      };
    }
  }
  const byFile = resolveNamedGraphNode(graph, "selector", fact.selectorName, fact.file);
  if (byFile || !fact.ownerNodeId) {
    return selectorNode(graph, fact.selectorName, fact.file, fact.confidence, evidence);
  }

  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const used = graph.edges.flatMap((edge) => {
    if (edge.type !== "usesSelector" || edge.from !== fact.ownerNodeId) return [];
    const target = nodesById.get(edge.to);
    return target?.type === "selector" && target.name === fact.selectorName ? [target] : [];
  });
  const owner = used.length === 1 ? used[0] : undefined;
  if (!owner) return selectorNode(graph, fact.selectorName, fact.file, fact.confidence, evidence);

  return {
    id: `selector-result:${owner.id}`,
    kind: "selector-result",
    name: fact.selectorName,
    ownerNodeId: owner.id,
    confidence: fact.confidence,
    evidence,
  };
}

function stateFieldNode(
  graph: ProjectMapGraph,
  statePath: string,
  confidence: FlowNode["confidence"],
  evidence: FlowEvidence[]
): FlowNode | null {
  const parts = statePath.split(".").map((part) => part.trim()).filter(Boolean);
  if (parts[0] !== "state" || !parts[1]) return null;

  const sliceName = parts[1];
  const fieldPath = parts.slice(2).join(".") || "*";
  const owner = resolveNamedGraphNode(graph, "slice-model", sliceName);
  const ownerIdentity = owner?.id ?? `slice-model:${encodeIdPart(sliceName)}`;

  return {
    id: `state-field:${ownerIdentity}#${encodeIdPart(fieldPath)}`,
    kind: "state-field",
    name: statePath,
    ownerNodeId: owner?.id,
    path: statePath,
    confidence,
    evidence,
  };
}

function addSelectorSourceGap(
  state: BuildState,
  selector: FlowNode,
  evidence: FlowEvidence[],
  reasonCode: string
): void {
  const gap: FlowNode = {
    id: `gap:${reasonCode}:${selector.id}`,
    kind: "gap",
    name: `Source not resolved for ${selector.name}`,
    ownerNodeId: selector.ownerNodeId,
    gap: {
      reasonCode,
      message: `No normalized source is available for selector ${selector.name}`,
    },
    confidence: "unknown",
    evidence,
  };
  addNode(state, gap);
  addEdge(state, gap.id, selector.id, "produces", "unknown", evidence);
}

function addHookReturnSourceGaps(state: BuildState): void {
  const unresolvedReturns = [...state.nodes.values()].filter((node) =>
    node.kind === "hook-return" &&
    !hasIncomingEdge(state.edges, node.id) &&
    hasOutgoingEdge(state.edges, node.id)
  );

  for (const returned of unresolvedReturns) {
    const gap: FlowNode = {
      id: `gap:hook-return-source-not-recorded:${returned.id}`,
      kind: "gap",
      name: `Source not resolved for ${returned.name}`,
      ownerNodeId: returned.ownerNodeId,
      gap: {
        reasonCode: "hook-return-source-not-recorded",
        message: `No normalized source is available for hook return ${returned.name}`,
      },
      confidence: "unknown",
      evidence: returned.evidence,
    };
    addNode(state, gap);
    addEdge(state, gap.id, returned.id, "produces", "unknown", returned.evidence);
  }
}

function buildValueFlow(subjectNodeId: string, nodes: FlowNode[], edges: FlowEdge[]): ValueFlow {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, FlowEdge[]>();
  const outgoing = new Map<string, FlowEdge[]>();
  for (const edge of edges) {
    const current = incoming.get(edge.to) ?? [];
    current.push(edge);
    incoming.set(edge.to, current);
    const next = outgoing.get(edge.from) ?? [];
    next.push(edge);
    outgoing.set(edge.from, next);
  }

  const nodeIds = new Set<string>([subjectNodeId]);
  const upstreamNodeIds = new Set<string>([subjectNodeId]);
  const downstreamNodeIds = new Set<string>([subjectNodeId]);
  const edgeIds = new Set<string>();
  const queue = [subjectNodeId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of incoming.get(current) ?? []) {
      edgeIds.add(edge.id);
      if (nodeIds.has(edge.from)) continue;
      nodeIds.add(edge.from);
      upstreamNodeIds.add(edge.from);
      queue.push(edge.from);
    }
  }

  const downstreamQueue = [subjectNodeId];
  const downstreamVisited = new Set<string>();
  while (downstreamQueue.length > 0) {
    const current = downstreamQueue.shift()!;
    if (downstreamVisited.has(current)) continue;
    downstreamVisited.add(current);
    for (const edge of outgoing.get(current) ?? []) {
      edgeIds.add(edge.id);
      nodeIds.add(edge.to);
      downstreamNodeIds.add(edge.to);
      if (!downstreamVisited.has(edge.to)) downstreamQueue.push(edge.to);
    }
  }

  const flowNodes = [...nodeIds].flatMap((id) => nodeById.get(id) ?? []);
  const upstreamNodes = [...upstreamNodeIds].flatMap((id) => nodeById.get(id) ?? []);
  const downstreamNodes = [...downstreamNodeIds].flatMap((id) => nodeById.get(id) ?? []);
  const scopeNodeIds = [...new Set(flowNodes.flatMap((node) => node.ownerNodeId ?? []))].sort();

  return {
    id: `flow:${subjectNodeId}`,
    scopeNodeIds,
    subjectNodeId,
    nodeIds: [...nodeIds].sort(),
    edgeIds: [...edgeIds].sort(),
    completeness: completenessOf(flowNodes),
    coverage: coverageOf(upstreamNodes, downstreamNodes),
  };
}

function coverageOf(upstreamNodes: FlowNode[], downstreamNodes: FlowNode[]): FlowCoverage {
  const originGapCodes = upstreamNodes
    .filter((node) => node.kind === "gap")
    .flatMap((node) => node.gap?.reasonCode ?? []);
  const origin = originGapCodes.length > 0
    ? "gap"
    : upstreamNodes.some(isOriginNode)
      ? "proven"
      : upstreamNodes.some((node) => node.kind === "boundary")
        ? "boundary"
        : "unknown";

  const downstreamGapCodes = downstreamNodes
    .filter((node) => node.kind === "gap")
    .flatMap((node) => node.gap?.reasonCode ?? []);
  const continuation = downstreamGapCodes.length > 0
    ? "gap"
    : downstreamNodes.some((node) => node.kind === "prop" || node.kind === "ui-effect")
      ? "proven"
      : "terminal-at-unit";

  return {
    origin,
    continuation,
    reasonCodes: [...new Set([...originGapCodes, ...downstreamGapCodes])].sort(),
  };
}

function isOriginNode(node: FlowNode): boolean {
  return node.kind === "api" || node.kind === "async-operation" || node.kind === "state-field";
}

function completenessOf(nodes: FlowNode[]): FlowCompleteness {
  if (nodes.some((node) => node.kind === "gap")) return "partial";

  const hasSource = nodes.some((node) =>
    node.kind === "api" || node.kind === "async-operation" || node.kind === "state-field" || node.kind === "boundary"
  );
  const hasConsumer = nodes.some((node) => node.kind === "prop" || node.kind === "ui-effect");
  if (hasSource && hasConsumer) return "complete";
  if (hasSource) return "source-only";
  return "consumer-only";
}

function boundaryEvidence(
  fact: HookReturnDependencyFact,
  source: NonNullable<HookReturnDependencyFact["boundarySources"]>[number]
): FlowEvidence[] {
  if (!source.location) return evidenceOf(fact);
  return [{
    file: source.location.file ?? fact.file,
    line: source.location.line,
    column: source.location.column,
    code: source.code,
  }];
}

function resolveNamedGraphNode(
  graph: ProjectMapGraph,
  type: ProjectMapNode["type"],
  name: string,
  sourceFile?: string
): ProjectMapNode | undefined {
  const candidates = graph.nodes.filter((node) => node.type === type && node.name === name);
  if (candidates.length === 1) return candidates[0];
  return sourceFile ? candidates.find((node) => node.file === sourceFile) : undefined;
}

function addNode(state: BuildState, node: FlowNode): void {
  const existing = state.nodes.get(node.id);
  if (!existing) {
    state.nodes.set(node.id, node);
    return;
  }

  existing.confidence = strongerConfidence(existing.confidence, node.confidence);
  existing.evidence = mergeEvidence(existing.evidence, node.evidence);
  existing.ownerNodeId ??= node.ownerNodeId;
  existing.occurrenceId ??= node.occurrenceId;
  existing.path ??= node.path;
  existing.valueSemantics ??= node.valueSemantics;
  existing.uiEffect ??= node.uiEffect;
  existing.gap ??= node.gap;
}

function addEdge(
  state: BuildState,
  from: string,
  to: string,
  relation: FlowRelation,
  confidence: FlowEdge["confidence"],
  evidence: FlowEvidence[],
  stateWrite?: FlowEdge["stateWrite"]
): void {
  const id = `flow-edge:${from}:${relation}:${to}`;
  const existing = state.edges.get(id);
  if (!existing) {
    state.edges.set(id, {
      id,
      from,
      to,
      relation,
      confidence,
      evidence,
      ...(stateWrite ? { stateWrite } : {}),
    });
    return;
  }

  existing.confidence = strongerConfidence(existing.confidence, confidence);
  existing.evidence = mergeEvidence(existing.evidence, evidence);
  existing.stateWrite ??= stateWrite;
}

function hasIncomingEdge(edges: Map<string, FlowEdge>, nodeId: string): boolean {
  return [...edges.values()].some((edge) => edge.to === nodeId);
}

function hasOutgoingEdge(edges: Map<string, FlowEdge>, nodeId: string): boolean {
  return [...edges.values()].some((edge) => edge.from === nodeId);
}

function evidenceOf(fact: EvidencedFlowFact): FlowEvidence[] {
  return [{
    file: fact.file,
    line: fact.location?.line,
    column: fact.location?.column,
    code: "code" in fact ? fact.code : undefined,
    codeStartLine: "codeStartLine" in fact ? fact.codeStartLine : undefined,
  }];
}

function mergeEvidence(left: FlowEvidence[], right: FlowEvidence[]): FlowEvidence[] {
  const merged = new Map<string, FlowEvidence>();
  for (const evidence of [...left, ...right]) {
    const key = `${evidence.file}\0${evidence.line ?? ""}\0${evidence.column ?? ""}\0${evidence.codeStartLine ?? ""}\0${evidence.code ?? ""}`;
    merged.set(key, evidence);
  }
  return [...merged.values()];
}

function strongerConfidence(
  left: FlowNode["confidence"],
  right: FlowNode["confidence"]
): FlowNode["confidence"] {
  const rank = { unknown: 0, low: 1, medium: 2, high: 3 } as const;
  return rank[right] > rank[left] ? right : left;
}

function encodeIdPart(value: string): string {
  return encodeURIComponent(value);
}

function byId<T extends { id: string }>(left: T, right: T): number {
  return left.id.localeCompare(right.id);
}
