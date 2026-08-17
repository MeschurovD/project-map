import { Radar } from "lucide-react";
import type { ProjectMapGraph, ProjectMapNode } from "../../../../graph/types.js";
import type { FlowQueries } from "../../../../flow/queries.js";
import { collectImpactSubgraph, summarizeImpactSubgraph } from "../../../graph-view/buildImpactView.js";
import { useT, type T } from "../../i18n.js";

// The side list of the impact view: a flat, grouped roll-up of everything that
// depends on the target node (up to pages). The canvas shows the same blast
// radius as a graph; this answers "what exactly breaks if I change this?".
export function ImpactSummary(props: {
  graph: ProjectMapGraph;
  targetId: string;
  flowQueries?: FlowQueries;
  onSelectNode: (node: ProjectMapNode) => void;
}) {
  const t = useT();
  const summary = props.flowQueries
    ? queryImpactSummary(props.graph, props.flowQueries, props.targetId)
    : legacyImpactSummary(props.graph, props.targetId);
  if (!summary) return null;
  const affectedCount = summary.groups.reduce((total, group) => total + group.nodes.length, 0) + summary.pages.length;
  const possibleCount =
    summary.possibleGroups.reduce((total, group) => total + group.nodes.length, 0) + summary.possiblePages.length;

  return (
    <div className="detail-stack impact-summary">
      <div className="detail-title">
        <Radar size={18} aria-hidden="true" />
        <div>
          <h2>{summary.target.name}</h2>
          <span>{t.secImpact} · {affectedCount}</span>
        </div>
      </div>

      {affectedCount === 0 && possibleCount === 0 ? <p className="muted-row">{t.impactNothing}</p> : null}

      {summary.pages.length > 0 ? (
        <NodeGroup title={`${t.impactPagesAffected} · ${summary.pages.length}`} nodes={summary.pages} onSelectNode={props.onSelectNode} />
      ) : null}

      {summary.groups.map((group) => (
        <NodeGroup
          key={group.kind}
          title={`${groupLabel(group.kind, t)} · ${group.nodes.length}`}
          nodes={group.nodes}
          onSelectNode={props.onSelectNode}
        />
      ))}

      {possibleCount > 0 ? (
        <section className="impact-possible">
          <h3 className="impact-possible-title">{t.impactPossible} · {possibleCount}</h3>
          {summary.possiblePages.length > 0 ? (
            <NodeGroup title={`${t.impactPagesAffected} · ${summary.possiblePages.length}`} nodes={summary.possiblePages} onSelectNode={props.onSelectNode} />
          ) : null}
          {summary.possibleGroups.map((group) => (
            <NodeGroup
              key={group.kind}
              title={`${groupLabel(group.kind, t)} · ${group.nodes.length}`}
              nodes={group.nodes}
              onSelectNode={props.onSelectNode}
            />
          ))}
        </section>
      ) : null}
    </div>
  );
}

function legacyImpactSummary(graph: ProjectMapGraph, targetId: string) {
  const impact = collectImpactSubgraph(graph, targetId);
  if (!impact) return null;
  return { ...summarizeImpactSubgraph(impact), possiblePages: [], possibleGroups: [] };
}

export function queryImpactSummary(graph: ProjectMapGraph, queries: FlowQueries, targetId: string) {
  const impact = queries.getImpact(targetId);
  if (!impact) return null;
  const flowTarget = impact.nodes.find((node) => node.id === targetId);
  const target = graph.nodes.find((node) => node.id === targetId) ?? (flowTarget ? {
    id: flowTarget.id,
    type: "unknown" as const,
    name: flowTarget.name,
    file: flowTarget.evidence[0]?.file,
  } : undefined);
  if (!target) return null;
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const pages = impact.affectedPageIds.flatMap((id) => nodesById.get(id) ?? []);
  const possiblePages = impact.possibleAffectedPageIds.flatMap((id) => nodesById.get(id) ?? []);
  return {
    target,
    pages,
    groups: ownerGroups(nodesById, impact.affectedOwnerNodeIds, targetId, impact.affectedPageIds),
    possiblePages,
    possibleGroups: ownerGroups(nodesById, impact.possibleAffectedOwnerNodeIds, targetId, impact.possibleAffectedPageIds),
  };
}

function ownerGroups(
  nodesById: Map<string, ProjectMapNode>,
  ownerNodeIds: string[],
  targetId: string,
  pageIds: string[]
) {
  const affected = ownerNodeIds
    .filter((id) => id !== targetId && !pageIds.includes(id))
    .flatMap((id) => nodesById.get(id) ?? []);
  const byType = new Map<ProjectMapNode["type"], ProjectMapNode[]>();
  for (const node of affected) {
    const group = byType.get(node.type) ?? [];
    if (!group.some((entry) => entry.id === node.id)) group.push(node);
    byType.set(node.type, group);
  }
  return [...byType.entries()]
    .map(([kind, nodes]) => ({ kind, nodes: nodes.sort((left, right) => left.name.localeCompare(right.name)) }))
    .sort((left, right) => groupOrder(left.kind) - groupOrder(right.kind));
}

function groupOrder(kind: ProjectMapNode["type"]): number {
  const order: ProjectMapNode["type"][] = [
    "widget", "feature", "entity", "component", "hook", "selector", "slice-model", "action", "thunk", "api",
  ];
  const index = order.indexOf(kind);
  return index === -1 ? order.length : index;
}

function NodeGroup(props: { title: string; nodes: ProjectMapNode[]; onSelectNode: (node: ProjectMapNode) => void }) {
  return (
    <section className="impact-group">
      <h3>{props.title}</h3>
      <ul>
        {props.nodes.map((node) => (
          <li key={node.id}>
            <button type="button" className="impact-node" onClick={() => props.onSelectNode(node)}>
              {node.name}
            </button>
            {node.file ? <span className="impact-node-file">{node.file}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function groupLabel(kind: ProjectMapNode["type"], t: T) {
  const map: Partial<Record<ProjectMapNode["type"], string>> = {
    widget: t.listWidgets,
    feature: t.listFeatures,
    entity: t.listEntities,
    component: t.dashComponents,
    hook: t.listHooks,
    selector: t.listSelectors,
    "slice-model": t.listSlices,
    action: t.listActions,
    thunk: t.listActions,
    api: t.listApiCalls,
  };
  return map[kind] ?? kind;
}
