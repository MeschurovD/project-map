import type { ProjectMapNode } from "../../graph/types.js";
import type { ProjectFact } from "../../scanner/facts.js";
import type { DataFlowUsage, DataFlowUsageRole } from "./valueFlowTypes.js";
import type { ViewGraph, ViewGraphEdge, ViewGraphNode } from "../graph-view/viewTypes.js";
import { buildValueTraceGraph, type TraceGraphNode } from "./buildValueTrace.js";
import { classifyUsageRole } from "./classifyUsageRole.js";
import { usageNodeFor } from "./usageNode.js";
import {
  hookReturnUsageFacts,
  localVariableUsageFacts,
  selectorBindingFacts,
} from "./valueFlowTypes.js";

// Component data-flow: a compact overview of the component's values bucketed by
// role, each value linked to where it goes (destination nodes). Clicking a value
// expands its full trace in place — origin on the left (selector → state → thunk
// → API) and destinations on the right — instead of jumping to another view.

const COL_COMPONENT = 0;
const COL_GROUP = 340;
const COL_VALUE = 680;
const COL_DEST = 1020;
const ROW_STEP = 132;

const ROLE_ORDER: DataFlowUsageRole[] = ["data", "loading", "error", "availability", "visibility", "text", "handler", "event", "unknown"];
const ROLE_LABEL: Record<DataFlowUsageRole, string> = {
  data: "Data", loading: "Loading", error: "Error", availability: "Availability",
  visibility: "Visibility", text: "Text", handler: "Handlers", event: "Events", unknown: "Other",
};

type ComponentValue = {
  localName: string;
  role: DataFlowUsageRole;
  sourceLabel: string;
  destinations: Array<{ label: string; nodeType: string }>;
};

export function buildComponentValueFlowView(
  graph: { nodes: ProjectMapNode[] },
  facts: ProjectFact[],
  component: ProjectMapNode,
  expandedValueId?: string
): ViewGraph {
  const values = collectValues(facts, component);
  const expanded = expandedValueId ? values.find((value) => valueNodeId(component, value.localName) === expandedValueId) : undefined;
  if (expanded) return buildValueTraceView(facts, component, expanded);
  return buildOverview(component, values);
}

function buildOverview(component: ProjectMapNode, values: ComponentValue[]): ViewGraph {
  const byRole = new Map<DataFlowUsageRole, ComponentValue[]>();
  for (const value of values) {
    (byRole.get(value.role) ?? byRole.set(value.role, []).get(value.role)!).push(value);
  }

  const nodes: ViewGraphNode[] = [];
  const edges: ViewGraphEdge[] = [];
  let row = 0;

  for (const role of ROLE_ORDER) {
    const group = byRole.get(role);
    if (!group || group.length === 0) continue;

    const groupId = `value-flow:${component.id}:role:${role}`;
    nodes.push({
      id: groupId,
      kind: "group-card",
      label: ROLE_LABEL[role],
      count: group.length,
      badgeLabel: `${ROLE_LABEL[role]} ${group.length}`,
      position: { x: COL_GROUP, y: row * ROW_STEP },
    });
    edges.push(viewEdge(component.id, groupId, ROLE_LABEL[role]));

    let groupRow = row;
    for (const value of group) {
      const valueId = valueNodeId(component, value.localName);
      const valueY = groupRow * ROW_STEP;
      // No sourceNode on value cards: keeps file-level docs summaries from
      // landing on every value (their docs context comes from the trace).
      nodes.push({
        id: valueId,
        kind: "semantic-card",
        label: value.localName,
        nodeType: "bound-value",
        subtitle: value.sourceLabel,
        position: { x: COL_VALUE, y: valueY },
      });
      edges.push(viewEdge(groupId, valueId, "value"));

      value.destinations.forEach((destination, index) => {
        const destId = `${valueId}:dest:${index}`;
        nodes.push({
          id: destId,
          kind: "semantic-card",
          label: destination.label,
          nodeType: destination.nodeType,
          position: { x: COL_DEST, y: (groupRow + index) * ROW_STEP },
        });
        edges.push(viewEdge(valueId, destId, "→"));
      });
      groupRow += Math.max(1, value.destinations.length);
    }
    row = groupRow + 1; // gap between role groups
  }

  nodes.unshift({
    id: component.id,
    kind: "semantic-card",
    sourceNode: component,
    label: component.name,
    nodeType: component.type,
    file: component.file,
    fsdLayer: component.fsd?.layer,
    fsdSlice: component.fsd?.slice,
    position: { x: COL_COMPONENT, y: (Math.max(0, row - 2) / 2) * ROW_STEP },
  });

  return { nodes, edges };
}

// Expanded value: its deduplicated trace graph laid out in columns — origin to
// the left (deeper = further left: selector → state → thunk → API), the value at
// x=0, and its destinations to the right. Shared nodes appear once.
function buildValueTraceView(facts: ProjectFact[], component: ProjectMapNode, value: ComponentValue): ViewGraph {
  const nodes: ViewGraphNode[] = [];
  const edges: ViewGraphEdge[] = [];

  const valueId = valueNodeId(component, value.localName);
  const trace = buildValueTraceGraph(facts, component, value.localName);

  // Stack nodes per depth column so rows don't collide.
  const rowByDepth = new Map<number, number>();
  const idByKey = new Map<string, string>([[`value:${value.localName}`, valueId]]);
  const maxRows = Math.max(1, ...[...trace.nodes].map((node) => node.depth).map((depth) =>
    trace.nodes.filter((n) => n.depth === depth).length
  ));

  for (const node of trace.nodes) {
    if (node.key === `value:${value.localName}`) continue;
    const row = rowByDepth.get(node.depth) ?? 0;
    rowByDepth.set(node.depth, row + 1);
    const id = `trace:${node.key}`;
    idByKey.set(node.key, id);
    nodes.push({
      id,
      kind: "semantic-card",
      label: node.title,
      nodeType: traceNodeType(node.kind),
      subtitle: node.detail ?? node.relation,
      position: { x: -node.depth * 360, y: row * ROW_STEP },
    });
  }

  for (const edge of trace.edges) {
    const from = idByKey.get(edge.from);
    const to = idByKey.get(edge.to);
    if (from && to) edges.push(viewEdge(from, to, edge.label));
  }

  // Value in the centre, then destinations to the right.
  nodes.push({ id: valueId, kind: "semantic-card", label: value.localName, nodeType: "bound-value", subtitle: value.sourceLabel, position: { x: 0, y: (maxRows - 1) / 2 * ROW_STEP } });
  value.destinations.forEach((destination, index) => {
    const destId = `${valueId}:dest:${index}`;
    nodes.push({ id: destId, kind: "semantic-card", label: destination.label, nodeType: destination.nodeType, position: { x: 360, y: index * ROW_STEP } });
    edges.push(viewEdge(valueId, destId, "→"));
  });

  return { nodes, edges };
}

function traceNodeType(kind: TraceGraphNode["kind"]): string {
  if (kind === "selector") return "selector";
  if (kind === "state") return "slice-model";
  if (kind === "thunk") return "thunk";
  if (kind === "hook") return "hook";
  if (kind === "api") return "api";
  return "bound-value";
}

function collectValues(facts: ProjectFact[], component: ProjectMapNode): ComponentValue[] {
  const localUsages = localVariableUsageFacts(facts);
  const values: ComponentValue[] = [];
  const seen = new Set<string>();

  for (const binding of selectorBindingFacts(facts).filter((fact) => fact.ownerNodeId === component.id)) {
    if (seen.has(binding.localName)) continue;
    seen.add(binding.localName);
    const usages = localUsages.filter((usage) => usage.owner === binding.owner && usage.variableName === binding.localName);
    values.push({
      localName: binding.localName,
      role: roleOf(binding.localName, usages[0]),
      sourceLabel: `← ${binding.selectorName}`,
      destinations: destinationsFrom(usages.map((usage) => ({ usageKind: usage.usageKind, targetName: usage.targetName, propName: usage.propName }))),
    });
  }

  const hookUsages = hookReturnUsageFacts(facts).filter((fact) => fact.ownerNodeId === component.id);
  for (const usage of hookUsages) {
    if (seen.has(usage.localName)) continue;
    seen.add(usage.localName);
    const sameValue = hookUsages.filter((fact) => fact.localName === usage.localName);
    values.push({
      localName: usage.localName,
      role: roleOf(usage.localName, usage),
      sourceLabel: `← ${usage.hookName}`,
      destinations: destinationsFrom(sameValue.map((fact) => ({ usageKind: fact.usageKind, targetName: fact.targetName, propName: fact.propName }))),
    });
  }

  return values;
}

function destinationsFrom(usages: Array<{ usageKind: string; targetName?: string; propName?: string }>): Array<{ label: string; nodeType: string }> {
  const byLabel = new Map<string, { label: string; nodeType: string }>();
  for (const usage of usages) {
    const node = usageNodeFor(normalizeKind(usage.usageKind), usage.targetName, usage.propName);
    if (!byLabel.has(node.label)) byLabel.set(node.label, node);
  }
  return [...byLabel.values()];
}

function roleOf(localName: string, usage: { usageKind: string; targetName?: string; propName?: string } | undefined): DataFlowUsageRole {
  return classifyUsageRole({
    sourceName: localName,
    sourceKind: "localVariable",
    usageKind: normalizeKind(usage?.usageKind),
    targetName: usage?.targetName,
    propName: usage?.propName,
  });
}

function normalizeKind(kind: string | undefined): DataFlowUsage["usageKind"] {
  return (kind === "ternaryCondition" ? "conditionalRender" : (kind ?? "prop")) as DataFlowUsage["usageKind"];
}

export function valueNodeId(component: ProjectMapNode, localName: string): string {
  return `value-flow:${component.id}:value:${localName}`;
}

function viewEdge(from: string, to: string, label: string): ViewGraphEdge {
  return { id: `value-flow-edge:${from}:${label}:${to}`, from, to, type: "view", label };
}
