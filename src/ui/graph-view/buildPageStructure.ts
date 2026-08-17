import type { FlowQueries } from "../../flow/queries.js";
import type { JsxOccurrence } from "../../flow/types.js";
import type { ProjectMapEdge, ProjectMapGraph, ProjectMapNode } from "../../graph/types.js";

export type PageStructureItem = {
  id: string;
  /** Canonical graph node opened from this row; absent for structural groups. */
  unitId?: string;
  kind: "unit" | "section" | "fragment" | "slot" | "element";
  name: string;
  type: ProjectMapNode["type"] | "section" | "fragment" | "slot" | "element";
  file?: string;
  layer?: string;
  slice?: string;
  occurrenceId?: string;
  /** Semantic projection: JSX prop through which this occurrence is rendered. */
  relationLabel?: string;
  /** Semantic projection: repeated occurrence position among equal siblings. */
  occurrenceIndex?: number;
  occurrenceCount?: number;
  /** Semantic projection: hooks compacted into their owning component card. */
  logicUnits?: Array<{ id: string; unitId: string; name: string }>;
  metricsKind: "values" | "inputs";
  valuesCount: number;
  sourceResolvedCount: number;
  originGapCount: number;
  children: PageStructureItem[];
};

export type PageStructure = {
  pageId: string;
  pageName: string;
  root: PageStructureItem | null;
  warnings: string[];
};

const UNIT_TYPES = new Set<ProjectMapNode["type"]>(["component", "hook"]);

/**
 * Build an occurrence-aware React structure without changing the canonical
 * dependency graph. Hooks come from proven topology edges; Return comes from
 * the concrete JSX AST, so fragments, repeated callsites and prop slots keep
 * their real nesting.
 */
export function buildPageStructure(
  graph: ProjectMapGraph,
  flowQueries: FlowQueries,
  pageId: string
): PageStructure | null {
  const page = graph.nodes.find((node) => node.id === pageId && node.type === "page");
  const overview = flowQueries.getPageOverview(pageId);
  if (!page || !overview) return null;

  const nodesById = new Map(overview.topologyNodes.map((node) => [node.id, node]));
  const semanticChildren = semanticChildrenByOwner(overview.topologyEdges, nodesById);
  const flowIds = overview.flows.map((flow) => flow.id);
  const rootNode = overview.primaryComponentId
    ? nodesById.get(overview.primaryComponentId) ?? null
    : null;

  const buildUnit = (
    node: ProjectMapNode,
    itemId: string,
    ancestors: Set<string>,
    occurrence?: JsxOccurrence,
    callsiteChildren: JsxOccurrence[] = [],
    callsiteOccurrences: JsxOccurrence[] = []
  ): PageStructureItem => {
    const nextAncestors = new Set(ancestors).add(node.id);
    const callsiteMetrics = occurrence
      ? occurrenceMetrics(flowQueries, flowIds, occurrence.id)
      : null;
    const usesCallsiteMetrics = Boolean(callsiteMetrics && callsiteMetrics.valuesCount > 0);
    const metrics = usesCallsiteMetrics
      ? callsiteMetrics!
      : unitMetrics(flowQueries, flowIds, node.id);
    const children = [
      ...callsiteGroups(
        callsiteChildren,
        callsiteOccurrences,
        nextAncestors,
        buildOccurrence
      ),
      ...definitionGroups(node, nextAncestors, ancestors.size === 0),
    ];

    return {
      id: itemId,
      unitId: node.id,
      kind: "unit",
      name: node.name,
      type: node.type,
      file: node.file,
      layer: node.fsd?.layer,
      slice: node.fsd?.slice ?? undefined,
      occurrenceId: occurrence?.id,
      metricsKind: usesCallsiteMetrics ? "inputs" : "values",
      ...metrics,
      children,
    };
  };

  const buildHook = (
    node: ProjectMapNode,
    itemId: string,
    ancestors: Set<string>
  ): PageStructureItem => {
    const nextAncestors = new Set(ancestors).add(node.id);
    const nestedHooks = (semanticChildren.get(node.id) ?? [])
      .filter(({ node: child, edge }) => edge.type === "usesHook" && child.type === "hook")
      .filter(({ node: child }) => !nextAncestors.has(child.id))
      .map(({ node: child, edge }) => buildHook(
        child,
        `${itemId}:hook:${child.id}:${sourcePosition(edge)}`,
        nextAncestors
      ));
    return {
      id: itemId,
      unitId: node.id,
      kind: "unit",
      name: node.name,
      type: node.type,
      file: node.file,
      layer: node.fsd?.layer,
      slice: node.fsd?.slice ?? undefined,
      ...unitMetrics(flowQueries, flowIds, node.id),
      metricsKind: "values",
      children: nestedHooks,
    };
  };

  function definitionGroups(
    node: ProjectMapNode,
    ancestors: Set<string>,
    showLogicSection: boolean
  ): PageStructureItem[] {
    const groups: PageStructureItem[] = [];
    const hooks = (semanticChildren.get(node.id) ?? [])
      .filter(({ node: child, edge }) => edge.type === "usesHook" && child.type === "hook")
      .filter(({ node: child }) => !ancestors.has(child.id))
      .map(({ node: child, edge }) => buildHook(
        child,
        `${node.id}:logic:${child.id}:${sourcePosition(edge)}`,
        ancestors
      ));
    if (hooks.length > 0) {
      groups.push(...(showLogicSection
        ? [section(`${node.id}:logic`, "Logic", hooks)]
        : hooks));
    }

    const structure = flowQueries.getComponentStructure(node.id);
    if (structure) {
      const roots = structure.occurrences.filter((occurrence) =>
        !occurrence.parentId &&
        shouldDisplayOccurrence(occurrence, structure.occurrences)
      );
      const byReturn = new Map<number, JsxOccurrence[]>();
      for (const root of roots) {
        const current = byReturn.get(root.returnIndex) ?? [];
        current.push(root);
        byReturn.set(root.returnIndex, current);
      }
      for (const [returnIndex, returnRoots] of [...byReturn.entries()].sort((a, b) => a[0] - b[0])) {
        const children = returnRoots.map((root) =>
          buildOccurrence(root, structure.occurrences, ancestors)
        );
        if (children.length > 0) {
          groups.push(section(
            `${node.id}:return:${returnIndex}`,
            byReturn.size > 1 ? `Return ${returnIndex + 1}` : "Return",
            children
          ));
        }
      }
    } else {
      // Backward-compatible fallback for an artifact without occurrence facts.
      const rendered = (semanticChildren.get(node.id) ?? [])
        .filter(({ node: child, edge }) => edge.type === "renders" && child.type === "component")
        .filter(({ node: child }) => !ancestors.has(child.id))
        .map(({ node: child, edge }) => buildUnit(
          child,
          `${node.id}:render:${child.id}:${sourcePosition(edge)}`,
          ancestors
        ));
      if (rendered.length > 0) groups.push(section(`${node.id}:return`, "Return", rendered));
    }

    return groups;
  }

  function buildOccurrence(
    occurrence: JsxOccurrence,
    allOccurrences: JsxOccurrence[],
    ancestors: Set<string>
  ): PageStructureItem {
    const directChildren = allOccurrences.filter((candidate) =>
      candidate.parentId === occurrence.id &&
      shouldDisplayOccurrence(candidate, allOccurrences)
    );
    if (occurrence.kind === "fragment") {
      return {
        id: occurrence.id,
        kind: "fragment",
        name: "Fragment",
        type: "fragment",
        valuesCount: 0,
        sourceResolvedCount: 0,
        originGapCount: 0,
        metricsKind: "values",
        children: callsiteGroups(directChildren, allOccurrences, ancestors, buildOccurrence),
      };
    }

    if (occurrence.kind === "intrinsic") {
      return {
        id: occurrence.id,
        kind: "element",
        name: `<${occurrence.name}>`,
        type: "element",
        valuesCount: 0,
        sourceResolvedCount: 0,
        originGapCount: 0,
        metricsKind: "values",
        children: callsiteGroups(directChildren, allOccurrences, ancestors, buildOccurrence),
      };
    }

    const target = occurrence.targetNodeId
      ? nodesById.get(occurrence.targetNodeId) ??
        graph.nodes.find((node) => node.id === occurrence.targetNodeId)
      : undefined;
    if (target && UNIT_TYPES.has(target.type) && !ancestors.has(target.id)) {
      return buildUnit(
        target,
        occurrence.id,
        ancestors,
        occurrence,
        directChildren,
        allOccurrences
      );
    }

    return {
      id: occurrence.id,
      kind: "unit",
      name: occurrence.name,
      type: "component",
      occurrenceId: occurrence.id,
      metricsKind: "inputs",
      ...occurrenceMetrics(flowQueries, flowIds, occurrence.id),
      children: callsiteGroups(directChildren, allOccurrences, ancestors, buildOccurrence),
    };
  }

  return {
    pageId,
    pageName: page.name,
    root: rootNode ? buildUnit(rootNode, rootNode.id, new Set()) : null,
    warnings: overview.warnings.map((warning) => warning.message),
  };
}

function callsiteGroups(
  children: JsxOccurrence[],
  allOccurrences: JsxOccurrence[],
  ancestors: Set<string>,
  buildOccurrence: (
    occurrence: JsxOccurrence,
    allOccurrences: JsxOccurrence[],
    ancestors: Set<string>
  ) => PageStructureItem
): PageStructureItem[] {
  if (children.length === 0) return [];
  const ordinary = children.filter((child) => !child.slotName)
    .map((child) => ({
      position: occurrencePosition(child),
      item: buildOccurrence(child, allOccurrences, ancestors),
    }));
  const slotNames = [...new Set(children.flatMap((child) => child.slotName ?? []))];
  const slots = slotNames.map((slotName) => {
    const slotChildren = children.filter((child) => child.slotName === slotName);
    return {
      position: Math.min(...slotChildren.map(occurrencePosition)),
      item: {
        id: `slot:${slotChildren[0]?.parentId ?? "root"}:${slotName}`,
        kind: "slot" as const,
        name: slotName,
        type: "slot" as const,
        valuesCount: 0,
        sourceResolvedCount: 0,
        originGapCount: 0,
        metricsKind: "values" as const,
        children: slotChildren.map((child) =>
          buildOccurrence(child, allOccurrences, ancestors)
        ),
      },
    };
  });
  return [...ordinary, ...slots]
    .sort((left, right) => left.position - right.position)
    .map((entry) => entry.item);
}

function semanticChildrenByOwner(
  edges: ProjectMapEdge[],
  nodesById: Map<string, ProjectMapNode>
) {
  const children = new Map<string, Array<{ node: ProjectMapNode; edge: ProjectMapEdge }>>();
  for (const edge of edges) {
    if (edge.type !== "renders" && edge.type !== "usesHook") continue;
    const child = nodesById.get(edge.to);
    if (!child || !UNIT_TYPES.has(child.type)) continue;
    const current = children.get(edge.from) ?? [];
    current.push({ node: child, edge });
    children.set(edge.from, current);
  }
  for (const entries of children.values()) {
    entries.sort((left, right) =>
      sourcePosition(left.edge) - sourcePosition(right.edge) ||
      left.node.name.localeCompare(right.node.name)
    );
  }
  return children;
}

function shouldDisplayOccurrence(
  occurrence: JsxOccurrence,
  allOccurrences: JsxOccurrence[]
): boolean {
  if (occurrence.kind !== "intrinsic") return true;
  const children = allOccurrences.filter((candidate) => candidate.parentId === occurrence.id);
  return children.some((child) =>
    child.kind === "component" ||
    child.kind === "fragment" ||
    shouldDisplayOccurrence(child, allOccurrences)
  );
}

function occurrencePosition(occurrence: JsxOccurrence): number {
  return (occurrence.evidence.line ?? 0) * 1_000_000 +
    (occurrence.evidence.column ?? 0);
}

function section(id: string, name: string, children: PageStructureItem[]): PageStructureItem {
  return {
    id,
    kind: "section",
    name,
    type: "section",
    valuesCount: aggregate(children, "valuesCount"),
    sourceResolvedCount: aggregate(children, "sourceResolvedCount"),
    originGapCount: aggregate(children, "originGapCount"),
    metricsKind: "values",
    children,
  };
}

function unitMetrics(flowQueries: FlowQueries, flowIds: string[], unitId: string) {
  return metricsFor(flowQueries, flowIds, (node) => node.ownerNodeId === unitId);
}

function occurrenceMetrics(flowQueries: FlowQueries, flowIds: string[], occurrenceId: string) {
  return metricsFor(flowQueries, flowIds, (node) => node.occurrenceId === occurrenceId);
}

function metricsFor(
  flowQueries: FlowQueries,
  flowIds: string[],
  matches: (node: NonNullable<ReturnType<FlowQueries["getValueFlow"]>>["nodes"][number]) => boolean
) {
  let valuesCount = 0;
  let sourceResolvedCount = 0;
  let originGapCount = 0;

  for (const flowId of flowIds) {
    const detail = flowQueries.getValueFlow(flowId);
    if (!detail || !detail.nodes.some(matches)) continue;
    valuesCount += 1;
    if (detail.flow.coverage.origin === "proven" || detail.flow.coverage.origin === "boundary") {
      sourceResolvedCount += 1;
    }
    if (detail.flow.coverage.origin === "gap") originGapCount += 1;
  }

  return { valuesCount, sourceResolvedCount, originGapCount };
}

function aggregate(
  items: PageStructureItem[],
  field: "valuesCount" | "sourceResolvedCount" | "originGapCount"
) {
  return items.reduce((total, item) => total + item[field], 0);
}

function sourcePosition(edge: ProjectMapEdge) {
  const positions = edge.evidence.flatMap((item) =>
    Number.isFinite(item.line)
      ? [item.line * 1_000_000 + item.column]
      : []
  );
  return positions.length > 0 ? Math.min(...positions) : Number.MAX_SAFE_INTEGER;
}
