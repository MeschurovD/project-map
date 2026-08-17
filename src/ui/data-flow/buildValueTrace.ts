import type { ProjectMapNode } from "../../graph/types.js";
import type { ProjectFact, ReduxThunkFact, SliceWriteFact } from "../../scanner/facts.js";
import type {
  Confidence,
  HookReturnUsageFact,
  LocalVariableUsageFact,
  SelectorBindingFact,
  SelectorStateReadFact,
} from "../../analyzers/value-flow/types.js";
import type { HookReturnDependencyFact } from "../../analyzers/value-flow/types.js";
import {
  hookReturnDependencyFacts,
  hookReturnUsageFacts,
  localVariableUsageFacts,
  selectorBindingFacts,
  selectorStateReadFacts,
} from "./valueFlowTypes.js";

// "Where does this value come from?" — a tree of sources, walking up from a
// bound value through selectors, the state path it reads, the slice write that
// fills it, and the thunk behind that. Each step keeps its evidence. Where the
// facts run out (thunk → API, dynamic keys, …) the trace stops honestly with an
// "unresolved" node rather than inventing a link. Pure → unit-testable.

export type TraceEvidence = { file?: string; line?: number; code?: string };

export type TraceNodeKind = "value" | "selector" | "state" | "thunk" | "hook" | "api" | "ui-effect" | "unresolved";

export type TraceNode = {
  id: string;
  title: string;
  kind: TraceNodeKind;
  /** How this node connects to its parent, e.g. "from selector", "reads", "written by". */
  relation?: string;
  detail?: string;
  evidence?: TraceEvidence;
  confidence?: Confidence;
  children: TraceNode[];
};

const MAX_DEPTH = 12;

type TraceCtx = {
  selectorBindings: SelectorBindingFact[];
  hookUsages: HookReturnUsageFact[];
  localUsages: LocalVariableUsageFact[];
  stateReads: SelectorStateReadFact[];
  sliceWrites: SliceWriteFact[];
  thunks: ReduxThunkFact[];
  hookReturnDeps: HookReturnDependencyFact[];
  seq: { n: number };
};

/** Trace roots for an inspected node: a component's bound values, or a selector
 * traced from itself. Returns [] for node types with nothing to trace yet. */
export function buildValueTrace(facts: ProjectFact[], node: ProjectMapNode): TraceNode[] {
  const ctx = createCtx(facts);

  if (node.type === "selector") {
    return [traceSelector(ctx, node.name, undefined, undefined, undefined, new Set(), 0)];
  }

  if (node.type === "component") {
    const roots: TraceNode[] = [];
    const seen = new Set<string>();
    for (const binding of ctx.selectorBindings.filter((fact) => fact.ownerNodeId === node.id)) {
      if (seen.has(binding.localName)) continue;
      seen.add(binding.localName);
      roots.push(traceValue(ctx, node.id, binding.localName, new Set(), 0));
    }
    for (const usage of ctx.hookUsages.filter((fact) => fact.ownerNodeId === node.id)) {
      if (seen.has(usage.localName)) continue;
      seen.add(usage.localName);
      roots.push(traceValue(ctx, node.id, usage.localName, new Set(), 0));
    }
    return roots;
  }

  return [];
}

// Reverse trace ("what does this affect?"): the same tree downward. From a
// selector, follow who binds it and how that value is used (controls a render, a
// prop, a handler), plus selectors derived from it.
export function buildValueImpact(facts: ProjectFact[], node: ProjectMapNode): TraceNode[] {
  if (node.type !== "selector") return [];
  return [impactSelector(createCtx(facts), node.name, undefined, undefined, undefined, new Set(), 0)];
}

function impactSelector(
  ctx: TraceCtx,
  selectorName: string,
  relation: string | undefined,
  evidence: TraceEvidence | undefined,
  confidence: Confidence | undefined,
  visited: Set<string>,
  depth: number
): TraceNode {
  const node = makeNode(ctx, "selector", selectorName);
  node.relation = relation;
  node.evidence = evidence;
  node.confidence = confidence;

  const guard = guardChild(visited, depth, `impact-selector:${selectorName}`);
  if (guard) return { ...node, children: [guard] };
  const nextVisited = withVisited(visited, `impact-selector:${selectorName}`);

  for (const binding of ctx.selectorBindings.filter((fact) => fact.selectorName === selectorName)) {
    const value = makeNode(ctx, "value", binding.localName);
    value.relation = "bound as";
    value.detail = binding.owner;
    value.evidence = evidenceOf(binding);
    value.confidence = binding.confidence;

    const usages = ctx.localUsages.filter((fact) => fact.owner === binding.owner && fact.variableName === binding.localName);
    for (const usage of usages) {
      const effect = makeNode(ctx, "ui-effect", usage.targetName ?? usage.variableName);
      effect.relation = usage.usageKind;
      effect.detail = usage.propName;
      effect.evidence = evidenceOf(usage);
      effect.confidence = usage.confidence;
      value.children.push(effect);
    }
    if (usages.length === 0) value.children.push(unresolvedNode(ctx, "bound but no tracked usage"));
    node.children.push(value);
  }

  // Selectors derived from this one are downstream too.
  for (const read of ctx.stateReads) {
    if ((read.derivedFromSelectors ?? []).includes(selectorName)) {
      node.children.push(impactSelector(ctx, read.selectorName, "feeds", evidenceOf(read), read.confidence, nextVisited, depth + 1));
    }
  }

  if (node.children.length === 0) node.children.push(unresolvedNode(ctx, "no consumers found"));
  return node;
}

function traceValue(ctx: TraceCtx, ownerNodeId: string, localName: string, visited: Set<string>, depth: number): TraceNode {
  const node = makeNode(ctx, "value", localName);
  const guard = guardChild(visited, depth, `value:${ownerNodeId}:${localName}`);
  if (guard) return { ...node, children: [guard] };
  const nextVisited = withVisited(visited, `value:${ownerNodeId}:${localName}`);

  const binding = ctx.selectorBindings.find((fact) => fact.ownerNodeId === ownerNodeId && fact.localName === localName);
  if (binding) {
    node.children.push(traceSelector(ctx, binding.selectorName, "from selector", evidenceOf(binding), binding.confidence, nextVisited, depth + 1));
  }

  const usage = ctx.hookUsages.find((fact) => fact.ownerNodeId === ownerNodeId && fact.localName === localName);
  if (usage) {
    node.children.push(traceHook(ctx, usage.hookName, usage.sourceField ?? localName, evidenceOf(usage), usage.confidence, nextVisited, depth + 1));
  }

  if (node.children.length === 0) {
    node.children.push(unresolvedNode(ctx, "no producing selector or hook found"));
  }
  return node;
}

function traceSelector(
  ctx: TraceCtx,
  selectorName: string,
  relation: string | undefined,
  evidence: TraceEvidence | undefined,
  confidence: Confidence | undefined,
  visited: Set<string>,
  depth: number
): TraceNode {
  const node = makeNode(ctx, "selector", selectorName);
  node.relation = relation;
  node.evidence = evidence;
  node.confidence = confidence;

  const guard = guardChild(visited, depth, `selector:${selectorName}`);
  if (guard) return { ...node, children: [guard] };
  const nextVisited = withVisited(visited, `selector:${selectorName}`);

  const read = ctx.stateReads.find((fact) => fact.selectorName === selectorName);
  if (!read) {
    node.children.push(unresolvedNode(ctx, "no state read recorded for this selector"));
    return node;
  }
  node.evidence = node.evidence ?? evidenceOf(read);

  const derived = read.derivedFromSelectors ?? [];
  if (derived.length > 0) {
    for (const input of derived) {
      node.children.push(traceSelector(ctx, input, "derived from", evidenceOf(read), read.confidence, nextVisited, depth + 1));
    }
  } else if (read.statePath) {
    node.children.push(traceState(ctx, read.statePath, evidenceOf(read), read.confidence, nextVisited, depth + 1));
  } else {
    node.children.push(unresolvedNode(ctx, "selector has no recorded state source"));
  }
  return node;
}

// Enter a hook: a hook is itself an owner of value-flow facts. If a selector it
// reads is returned under the same name, that is the precise source; otherwise
// the field is computed from the hook's internal reads, so show them all and
// note that the exact expression isn't captured by the facts.
function traceHook(
  ctx: TraceCtx,
  hookName: string,
  sourceField: string,
  evidence: TraceEvidence | undefined,
  confidence: Confidence | undefined,
  visited: Set<string>,
  depth: number
): TraceNode {
  const node = makeNode(ctx, "hook", hookName);
  node.relation = "from hook";
  node.evidence = evidence;
  node.confidence = confidence;

  const guard = guardChild(visited, depth, `hook:${hookName}`);
  if (guard) return { ...node, children: [guard] };
  const nextVisited = withVisited(visited, `hook:${hookName}`);

  const internal = ctx.selectorBindings.filter((fact) => fact.owner === hookName);
  const precise = internal.find((fact) => fact.localName === sourceField);
  if (precise) {
    node.children.push(traceSelector(ctx, precise.selectorName, "from selector", evidenceOf(precise), precise.confidence, nextVisited, depth + 1));
    return node;
  }

  if (internal.length > 0) {
    const seen = new Set<string>();
    for (const binding of internal) {
      if (seen.has(binding.selectorName)) continue;
      seen.add(binding.selectorName);
      node.children.push(traceSelector(ctx, binding.selectorName, "reads in hook", evidenceOf(binding), binding.confidence, nextVisited, depth + 1));
    }
    node.children.push(unresolvedNode(ctx, "exact derivation inside hook not captured"));
    return node;
  }

  node.children.push(unresolvedNode(ctx, "hook internals not traced"));
  return node;
}

function traceState(ctx: TraceCtx, statePath: string, evidence: TraceEvidence | undefined, confidence: Confidence | undefined, visited: Set<string>, depth: number): TraceNode {
  const node = makeNode(ctx, "state", statePath);
  node.relation = "reads";
  node.evidence = evidence;
  node.confidence = confidence;

  const guard = guardChild(visited, depth, `state:${statePath}`);
  if (guard) return { ...node, children: [guard] };
  const nextVisited = withVisited(visited, `state:${statePath}`);

  const sliceName = statePath.split(".")[1];
  const writers = sliceName ? ctx.sliceWrites.filter((fact) => fact.sliceName === sliceName) : [];
  if (writers.length === 0) {
    node.children.push(unresolvedNode(ctx, "no slice writer found for this state path"));
    return node;
  }

  const seen = new Set<string>();
  for (const writer of writers) {
    if (seen.has(writer.writerName)) continue;
    seen.add(writer.writerName);
    node.children.push(traceThunk(ctx, writer, nextVisited, depth + 1));
  }
  return node;
}

function traceThunk(ctx: TraceCtx, writer: SliceWriteFact, visited: Set<string>, depth: number): TraceNode {
  const node = makeNode(ctx, "thunk", writer.writerName);
  node.relation = "written by";
  node.detail = writer.writerState ? `extraReducers · ${writer.writerState}` : "extraReducers";
  node.evidence = { file: writer.file, line: writer.location.line, code: writer.code };

  const guard = guardChild(visited, depth, `thunk:${writer.writerName}`);
  if (guard) return { ...node, children: [guard] };

  const thunk = ctx.thunks.find((fact) => fact.name === writer.writerName);
  if (thunk) {
    node.detail = thunk.typePrefix ? `${node.detail} · ${thunk.typePrefix}` : node.detail;
    if (thunk.apiCalls && thunk.apiCalls.length > 0) {
      for (const apiCall of thunk.apiCalls) {
        const apiNode = makeNode(ctx, "api", `${apiCall.method} ${apiCall.url}`.trim());
        apiNode.relation = "calls api";
        apiNode.evidence = { file: thunk.file, line: apiCall.line, code: apiCall.code };
        node.children.push(apiNode);
      }
    } else {
      // No URL-literal HTTP call found in the payload creator.
      node.children.push(unresolvedNode(ctx, "thunk → API call not traced"));
    }
  }
  return node;
}

function guardChild(visited: Set<string>, depth: number, key: string): TraceNode | null {
  if (depth >= MAX_DEPTH) return { id: `t-depth`, title: "trace depth limit reached", kind: "unresolved", children: [] };
  if (visited.has(key)) return { id: `t-cycle`, title: "cycle — already shown above", kind: "unresolved", children: [] };
  return null;
}

function withVisited(visited: Set<string>, key: string) {
  const next = new Set(visited);
  next.add(key);
  return next;
}

function makeNode(ctx: TraceCtx, kind: TraceNodeKind, title: string): TraceNode {
  ctx.seq.n += 1;
  return { id: `t${ctx.seq.n}`, title, kind, children: [] };
}

function unresolvedNode(ctx: TraceCtx, title: string): TraceNode {
  return makeNode(ctx, "unresolved", title);
}

function evidenceOf(fact: { location?: { line?: number }; file?: string; code?: string }): TraceEvidence | undefined {
  if (!fact.file && !fact.code && !fact.location) return undefined;
  return { file: fact.file, line: fact.location?.line, code: fact.code };
}

function createCtx(facts: ProjectFact[]): TraceCtx {
  return {
    selectorBindings: selectorBindingFacts(facts),
    hookUsages: hookReturnUsageFacts(facts),
    localUsages: localVariableUsageFacts(facts),
    stateReads: selectorStateReadFacts(facts),
    sliceWrites: facts.filter((fact): fact is SliceWriteFact => fact.type === "sliceWrite"),
    thunks: facts.filter((fact): fact is ReduxThunkFact => fact.type === "reduxThunk"),
    hookReturnDeps: hookReturnDependencyFacts(facts),
    seq: { n: 0 },
  };
}

// ── Deduplicated trace graph for one value ──────────────────────────────────
// Unlike buildValueTrace (a tree, which duplicates shared nodes and, for a hook
// value, fans out every selector the hook reads), this builds a graph: each
// selector/state/thunk/api appears once (keyed by identity), edges converge, and
// a hook value follows only the selectors its field actually depends on
// (hookReturnDependency). It's what the centre canvas renders.

export type TraceGraphNode = {
  key: string;
  kind: TraceNodeKind;
  title: string;
  relation?: string;
  detail?: string;
  evidence?: TraceEvidence;
  /** Distance from the value, for left-to-right column layout. */
  depth: number;
};

export type TraceGraphEdge = { from: string; to: string; label: string };

export function buildValueTraceGraph(
  facts: ProjectFact[],
  component: ProjectMapNode,
  localName: string
): { nodes: TraceGraphNode[]; edges: TraceGraphEdge[] } {
  const ctx = createCtx(facts);
  const nodes = new Map<string, TraceGraphNode>();
  const edges = new Map<string, TraceGraphEdge>();
  const expanded = new Set<string>();

  const ensure = (key: string, kind: TraceNodeKind, title: string, depth: number, extra?: Partial<TraceGraphNode>) => {
    const existing = nodes.get(key);
    if (existing) {
      existing.depth = Math.min(existing.depth, depth);
      return existing;
    }
    const node: TraceGraphNode = { key, kind, title, depth, ...extra };
    nodes.set(key, node);
    return node;
  };
  const link = (from: string, to: string, label: string) => {
    edges.set(`${from} ${to} ${label}`, { from, to, label });
  };

  const valueKey = `value:${localName}`;
  ensure(valueKey, "value", localName, 0);
  expandValue(ctx, component.id, localName, valueKey, 1, { ensure, link, expanded });

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

type GraphOps = {
  ensure: (key: string, kind: TraceNodeKind, title: string, depth: number, extra?: Partial<TraceGraphNode>) => TraceGraphNode;
  link: (from: string, to: string, label: string) => void;
  expanded: Set<string>;
};

function expandValue(ctx: TraceCtx, ownerNodeId: string, localName: string, valueKey: string, depth: number, ops: GraphOps): void {
  const binding = ctx.selectorBindings.find((fact) => fact.ownerNodeId === ownerNodeId && fact.localName === localName);
  if (binding) {
    expandSelector(ctx, binding.selectorName, depth, ops, evidenceOf(binding));
    ops.link(`selector:${binding.selectorName}`, valueKey, "from selector");
  }

  const usage = ctx.hookUsages.find((fact) => fact.ownerNodeId === ownerNodeId && fact.localName === localName);
  if (usage) {
    const hookKey = `hook:${usage.hookName}`;
    ops.ensure(hookKey, "hook", usage.hookName, depth, { evidence: evidenceOf(usage) });
    ops.link(hookKey, valueKey, "from hook");
    expandHookValue(ctx, usage.hookName, usage.sourceField ?? localName, hookKey, depth + 1, ops);
  }

  if (!binding && !usage) {
    const key = `unresolved:${valueKey}`;
    ops.ensure(key, "unresolved", "no producing selector or hook found", depth);
    ops.link(key, valueKey, "from");
  }
}

// Only the selectors a hook's field depends on (hookReturnDependency), not all.
function expandHookValue(ctx: TraceCtx, hookName: string, field: string, hookKey: string, depth: number, ops: GraphOps): void {
  const dependency = ctx.hookReturnDeps.find((fact) => fact.hookName === hookName && fact.field === field);
  const internal = ctx.selectorBindings.filter((fact) => fact.owner === hookName);
  const direct = internal.find((fact) => fact.localName === field);

  const relevant = direct
    ? [direct]
    : dependency
      ? internal.filter((fact) => dependency.dependsOn.includes(fact.localName))
      : [];

  if (relevant.length === 0) {
    const key = `unresolved:${hookKey}`;
    ops.ensure(key, "unresolved", "source inside the hook not determined", depth);
    ops.link(key, hookKey, "reads in hook");
    return;
  }

  const seen = new Set<string>();
  for (const binding of relevant) {
    if (seen.has(binding.selectorName)) continue;
    seen.add(binding.selectorName);
    expandSelector(ctx, binding.selectorName, depth, ops, evidenceOf(binding));
    ops.link(`selector:${binding.selectorName}`, hookKey, "reads in hook");
  }
}

function expandSelector(ctx: TraceCtx, selectorName: string, depth: number, ops: GraphOps, evidence?: TraceEvidence): void {
  const key = `selector:${selectorName}`;
  ops.ensure(key, "selector", selectorName, depth, { evidence });
  if (ops.expanded.has(key)) return;
  ops.expanded.add(key);

  const read = ctx.stateReads.find((fact) => fact.selectorName === selectorName);
  if (!read) return;

  const derived = read.derivedFromSelectors ?? [];
  if (derived.length > 0) {
    for (const input of derived) {
      expandSelector(ctx, input, depth + 1, ops, evidenceOf(read));
      ops.link(`selector:${input}`, key, "derived from");
    }
    return;
  }

  if (!read.statePath) return;
  const stateKey = `state:${read.statePath}`;
  ops.ensure(stateKey, "state", read.statePath, depth + 1, { evidence: evidenceOf(read) });
  ops.link(stateKey, key, "reads");
  expandState(ctx, read.statePath, stateKey, depth + 2, ops);
}

function expandState(ctx: TraceCtx, statePath: string, stateKey: string, depth: number, ops: GraphOps): void {
  if (ops.expanded.has(stateKey)) return;
  ops.expanded.add(stateKey);

  const sliceName = statePath.split(".")[1];
  const writers = sliceName ? ctx.sliceWrites.filter((fact) => fact.sliceName === sliceName) : [];
  const seen = new Set<string>();
  for (const writer of writers) {
    if (seen.has(writer.writerName)) continue;
    seen.add(writer.writerName);
    const thunkKey = `thunk:${writer.writerName}`;
    const thunk = ctx.thunks.find((fact) => fact.name === writer.writerName);
    const detail = writer.writerState ? `extraReducers · ${writer.writerState}` : "extraReducers";
    ops.ensure(thunkKey, "thunk", writer.writerName, depth, {
      relation: "written by",
      detail: thunk?.typePrefix ? `${detail} · ${thunk.typePrefix}` : detail,
      evidence: { file: writer.file, line: writer.location.line, code: writer.code },
    });
    ops.link(thunkKey, stateKey, "written by");
    if (ops.expanded.has(thunkKey)) continue;
    ops.expanded.add(thunkKey);
    for (const apiCall of thunk?.apiCalls ?? []) {
      const apiKey = `api:${apiCall.method} ${apiCall.url}`;
      ops.ensure(apiKey, "api", `${apiCall.method} ${apiCall.url}`.trim(), depth + 1, {
        evidence: { file: thunk!.file, line: apiCall.line, code: apiCall.code },
      });
      ops.link(apiKey, thunkKey, "calls api");
    }
  }
}
