import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { ViewGraphNode } from "../../graph-view/viewTypes.js";
import { useT, type T } from "../i18n.js";

export type CardNodeData = Record<string, unknown> & {
  viewNode: ViewGraphNode;
};

export type CardNode = Node<CardNodeData>;

export function PageCardNode(props: NodeProps<CardNode>) {
  const t = useT();
  const node = props.data.viewNode;
  const summaryBadges = node.summaryBadges ?? pageStatsBadges(node, t);

  return (
    <div className="flow-card page-card">
      <FlowHandles />
      <div className="flow-card-header">
        <span>{t.cardPageLabel}</span>
        <strong>{node.label}</strong>
      </div>
      {summaryBadges.length > 0 ? (
        <SummaryLine badges={summaryBadges} />
      ) : node.file ? (
        <div className="flow-card-file">{node.file}</div>
      ) : null}
      <EnrichmentLine node={node} />
    </div>
  );
}

export function FolderCardNode(props: NodeProps<CardNode>) {
  const t = useT();
  const node = props.data.viewNode;

  return (
    <div className="flow-card folder-card">
      <FlowHandles />
      <div className="flow-card-header">
        <span>{t.cardFolderLabel}</span>
        <strong>{node.label}</strong>
      </div>
      <div className="flow-card-count">{node.count ?? 0} {t.cardPages}</div>
    </div>
  );
}

export function GroupCardNode(props: NodeProps<CardNode>) {
  const t = useT();
  const node = props.data.viewNode;

  return (
    <div className="flow-card group-card">
      <FlowHandles />
      <div className="flow-card-header">
        <span>{t.cardGroupLabel}</span>
        <strong>{node.label}</strong>
      </div>
      <div className="flow-card-count">{node.badgeLabel ?? `${node.count ?? 0} ${t.cardItems}`}</div>
    </div>
  );
}

// A column header on the flow trace canvas: labels a stage (Network, Selector,
// Hook, UI receiver, …) so the columns are identified rather than anonymous.
// Non-interactive; it carries no handles and is ignored by node-click handling.
export function StageHeaderNode(props: NodeProps<CardNode>) {
  const t = useT();
  const node = props.data.viewNode;
  return (
    <div className="flow-stage-header" data-stage-header={node.label}>
      {localizeStage(node.label, t)}
    </div>
  );
}

// Map the canonical (English) stage names the flow builder emits to i18n, so the
// header reads in the active language while grouping/tests keep the stable key.
export function localizeStage(stage: string, t: T): string {
  const map: Record<string, string> = {
    "Boundary": t.stageBoundary,
    "Network": t.stageNetwork,
    "Async operation": t.stageAsyncOperation,
    "Store field": t.stageStoreField,
    "Selector": t.stageSelector,
    "Hook input": t.stageHookInput,
    "Hook return": t.stageHookReturn,
    "Component value": t.stageComponentValue,
    "UI receiver": t.stageUiReceiver,
    "UI effect": t.stageUiEffect,
    "Trace gap": t.stageTraceGap,
  };
  return map[stage] ?? stage;
}

export function SemanticNodeCard(props: NodeProps<CardNode>) {
  const t = useT();
  const node = props.data.viewNode;

  return (
    <div
      className={`flow-card semantic-card ${classNameForNodeType(node.nodeType)} ${node.dataFlow ? "data-flow-card" : ""}`}
      data-testid="flow-node"
      data-flow-node-label={node.label}
    >
      <FlowHandles />
      <div className="flow-card-header">
        <span>{node.dataFlow?.stage ?? labelForNodeType(node.nodeType, t)}</span>
        <strong>{node.label}</strong>
      </div>
      {node.summaryBadges && node.summaryBadges.length > 0 ? (
        <SummaryLine badges={node.summaryBadges} />
      ) : null}
      {node.subtitle || node.fsdLayer ? (
        <div className="flow-card-file">{node.subtitle ?? fsdPath(node)}</div>
      ) : null}
      <DataFlowLine node={node} />
      <EnrichmentLine node={node} />
    </div>
  );
}

function DataFlowLine(props: { node: ViewGraphNode }) {
  const flow = props.node.dataFlow;
  if (!flow) return null;
  const evidence = flow.evidence?.find((entry) => entry.code || entry.file || entry.line);
  const receiverRows = flow.stage === "UI receiver" ? receiverInputRows(flow.inputs) : [];
  const showMiniRows = receiverRows.length === 0;
  const hasContent = receiverRows.length > 0 ||
    Boolean(flow.inputs?.length || flow.values?.length || flow.outputs?.length || flow.note || evidence);
  if (!hasContent) return null;

  return (
    <div className="flow-card-dataflow">
      {receiverRows.length > 0 ? <ReceiverTable rows={receiverRows} /> : null}
      {showMiniRows ? <FlowMiniRow label="in" values={flow.inputs} /> : null}
      {showMiniRows ? <FlowMiniRow label="value" values={flow.values} /> : null}
      {showMiniRows ? <FlowMiniRow label="out" values={flow.outputs} /> : null}
      {flow.note ? <div className="flow-card-note">{flow.note}</div> : null}
      {flow.secondaryWrites && flow.secondaryWrites.length > 0 ? (
        <details className="flow-secondary-writes">
          <summary>{flow.secondaryWrites.length} {flow.secondaryWrites.length === 1 ? "other write" : "other writes"}</summary>
          <ul>
            {flow.secondaryWrites.map((write) => <li key={write}>{write}</li>)}
          </ul>
        </details>
      ) : null}
      {evidence?.code ? <code>{evidence.code}</code> : evidence?.file ? (
        <div className="flow-card-evidence">{evidence.file}{evidence.line ? `:${evidence.line}` : ""}</div>
      ) : null}
    </div>
  );
}

function ReceiverTable(props: { rows: Array<{ prop: string; value: string }> }) {
  return (
    <div className="flow-receiver-table">
      {props.rows.slice(0, 6).map((row) => (
        <div key={`${row.prop}:${row.value}`} className="flow-receiver-row">
          <span>{row.prop}</span>
          <strong>{row.value}</strong>
        </div>
      ))}
      {props.rows.length > 6 ? <div className="flow-card-note">+{props.rows.length - 6} more</div> : null}
    </div>
  );
}

function FlowMiniRow(props: { label: string; values?: string[] }) {
  const values = props.values?.filter(Boolean).slice(0, 3) ?? [];
  if (values.length === 0) return null;
  return (
    <div className="flow-mini-row">
      <span>{props.label}</span>
      <strong>{values.join(", ")}</strong>
    </div>
  );
}

function receiverInputRows(inputs: string[] | undefined) {
  return (inputs ?? []).map((entry) => {
    const separator = entry.indexOf(":");
    if (separator === -1) return { prop: "value", value: entry };
    return { prop: entry.slice(0, separator).trim(), value: entry.slice(separator + 1).trim() };
  }).filter((row) => row.value);
}

// Module overlay on the card: badges and the short summary from enrichment.
function EnrichmentLine(props: { node: ViewGraphNode }) {
  const badges = props.node.enrichmentBadges ?? [];
  const summary = props.node.enrichmentSummary;
  if (badges.length === 0 && !summary) return null;

  return (
    <div className="flow-card-enrichment">
      {badges.map((badge) => (
        <span key={badge.id} className={`enrichment-badge enrichment-badge-${badge.tone ?? "info"}`}>
          {badge.label}
        </span>
      ))}
      {summary ? <span className="enrichment-summary">{summary}</span> : null}
    </div>
  );
}

function FlowHandles() {
  return (
    <>
      <Handle className="flow-handle" type="target" position={Position.Left} />
      <Handle className="flow-handle" type="source" position={Position.Right} />
    </>
  );
}

function SummaryLine(props: { badges: string[] }) {
  return (
    <div className="flow-card-summary">
      {props.badges.map((badge, index) => (
        <span key={badge}>
          {index > 0 ? " · " : null}{badge}
        </span>
      ))}
    </div>
  );
}

function pageStatsBadges(node: ViewGraphNode, t: T) {
  const stats = node.stats;
  if (!stats) return [];

  return ([
    [t.badgeWidgets, stats.widgets],
    [t.badgeFeatures, stats.features],
    [t.badgeEntities, stats.entities],
    [t.badgeShared, stats.shared],
    [t.badgeHooks, stats.hooks],
    [t.badgeRedux, stats.redux],
  ] satisfies Array<[string, number]>)
    .filter(([, value]) => value > 0)
    .map(([label, value]) => `${label} ${value}`);
}

function fsdPath(node: ViewGraphNode) {
  return [node.fsdLayer, node.fsdSlice].filter(Boolean).join("/");
}

function labelForNodeType(type: string | undefined, t: T): string {
  if (!type) return t.nodeUnknown;
  const map: Record<string, string> = {
    widget: t.nodeWidget,
    feature: t.nodeFeature,
    entity: t.nodeEntity,
    selector: t.nodeSelector,
    "input-selectors": t.nodeInputSelectors,
    "bound-value": t.nodeBoundValue,
    "ui-effect": t.nodeUiEffect,
    "slice-model": t.nodeSliceModel,
    prop: "PROP",
    action: t.nodeAction,
    thunk: t.nodeThunk,
    hook: t.nodeHook,
    api: t.nodeApi,
    component: t.nodeComponent,
  };
  return map[type] ?? type.replace(/-/g, " ").toUpperCase();
}

function classNameForNodeType(type: string | undefined) {
  if (type === "widget") return "node-widget";
  if (type === "feature") return "node-feature";
  if (type === "entity") return "node-entity";
  if (type === "selector" || type === "slice-model") return "node-selector";
  if (type === "input-selectors") return "node-input-selectors";
  if (type === "bound-value") return "node-bound-value";
  if (type === "ui-effect") return "node-ui-effect";
  if (type === "prop") return "node-bound-value";
  if (type === "action" || type === "thunk") return "node-action";
  if (type === "hook") return "node-hook";
  if (type === "api") return "node-api";
  if (type === "component") return "node-component";
  return "node-generic";
}
