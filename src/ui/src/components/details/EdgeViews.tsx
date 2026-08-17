import { Braces, Cable, CircleDot, Radar } from "lucide-react";
import type { ReactNode } from "react";
import type { ProjectMapEdge, ProjectMapGraph, ProjectMapNode } from "../../../../graph/types.js";
import type { MergedEnrichmentAnnotation } from "../../../../modules/enrichmentTypes.js";
import type { ViewGraphEdge, ViewGraphNode } from "../../../graph-view/viewTypes.js";
import type { FlowEvidence } from "../../../../flow/types.js";
import { useT, type T } from "../../i18n.js";
import { canViewEdgeUsage } from "../../source/sourceClient.js";
import { KeyValues } from "../primitives.js";
import { SourceViewerButton } from "../source/SourceViewerButton.js";
import { EnrichmentMarkdown } from "./EnrichmentMarkdown.js";

export function DebugEdges(props: {
  incoming: ProjectMapEdge[];
  outgoing: ProjectMapEdge[];
  onViewEdgeUsage: (edge: ProjectMapEdge) => void;
}) {
  const t = useT();
  return (
    <section className="debug-section">
      <h3><Braces size={15} aria-hidden="true" /> {t.secDebug}</h3>
      <EdgeList title={t.edgeIncoming} edges={props.incoming} onViewEdgeUsage={props.onViewEdgeUsage} />
      <EdgeList title={t.edgeOutgoing} edges={props.outgoing} onViewEdgeUsage={props.onViewEdgeUsage} />
    </section>
  );
}

export function EdgeDetails(props: { edge: ProjectMapEdge; onViewEdgeUsage: (edge: ProjectMapEdge) => void }) {
  const t = useT();
  return (
    <div className="detail-stack">
      <div className="detail-title">
        <Cable size={18} aria-hidden="true" />
        <div>
          <h2>{props.edge.type}</h2>
          <span>{props.edge.confidence}</span>
        </div>
      </div>
      <KeyValues
        values={[
          [t.keyFrom, props.edge.from],
          [t.keyTo, props.edge.to],
          [t.keyId, props.edge.id],
        ]}
      />
      <div className="source-actions">
        <SourceViewerButton
          label={t.btnViewUsage}
          disabled={!canViewEdgeUsage(props.edge)}
          title={canViewEdgeUsage(props.edge) ? undefined : t.tipNoEvidence}
          onClick={() => props.onViewEdgeUsage(props.edge)}
        />
      </div>
      <EvidenceList edges={[props.edge]} title={t.secEvidence} />
    </div>
  );
}

export function PageFocusEvidence(props: {
  graph: ProjectMapGraph;
  edges: ProjectMapEdge[];
  onViewEdgeUsage?: (edge: ProjectMapEdge) => void;
}) {
  const t = useT();
  if (props.edges.length === 0) return null;

  return (
    <section className="evidence-section">
      <h3><Braces size={15} aria-hidden="true" /> {t.secWhyHere}</h3>
      <div className="evidence-list">
        {props.edges.slice(0, 6).map((edge) => (
          <div key={edge.id} className="evidence-card">
            <strong>{reasonSummary(props.graph, edge, t)}</strong>
            {props.onViewEdgeUsage ? (
              <SourceViewerButton
                label={t.btnViewUsage}
                size="small"
                disabled={!canViewEdgeUsage(edge)}
                title={canViewEdgeUsage(edge) ? undefined : t.tipNoEvidence}
                onClick={() => props.onViewEdgeUsage?.(edge)}
              />
            ) : null}
            <EvidenceList edges={[edge]} title={t.secEvidence} compact />
          </div>
        ))}
      </div>
    </section>
  );
}

export function EvidenceList(props: { edges: ProjectMapEdge[]; title: string; compact?: boolean }) {
  const evidenceEntries = props.edges.flatMap((edge) => edge.evidence.map((evidence) => ({
    edge,
    evidence,
  })));

  if (evidenceEntries.length === 0) return null;

  return (
    <section className={props.compact ? "edge-list compact" : "edge-list"}>
      {!props.compact ? <h3><Braces size={15} aria-hidden="true" /> {props.title}</h3> : null}
      {evidenceEntries.slice(0, 8).map(({ edge, evidence }, index) => (
        <div key={`${edge.id}:${evidence.file}:${evidence.line}:${index}`} className="evidence-item">
          <dl>
            <div>
              <dt>file</dt>
              <dd>{evidence.file}</dd>
            </div>
            <div>
              <dt>line</dt>
              <dd>{evidence.line}</dd>
            </div>
          </dl>
          {evidence.code ? <code>{evidence.code}</code> : null}
        </div>
      ))}
    </section>
  );
}

function reasonSummary(graph: ProjectMapGraph, edge: ProjectMapEdge, t: T) {
  const source = graph.nodes.find((node) => node.id === edge.from);
  const target = graph.nodes.find((node) => node.id === edge.to);
  const sourceName = source?.name ?? edge.from;
  const targetName = target?.name ?? edge.to;
  return `${sourceName} ${relationshipLabel(edge, target, t)} ${targetName}:`;
}

function relationshipLabel(edge: ProjectMapEdge, target: ProjectMapNode | undefined, t: T) {
  if (edge.type === "renders") return t.relRenders;
  if (edge.type === "usesHook") return t.relUsesHook;
  if (edge.type === "usesSelector") return target?.type === "selector" ? t.relReadsSelector : t.relUsesSelector;
  if (edge.type === "dispatchesAction") return t.relDispatches;
  if (edge.type === "readsSlice") return t.relReadsSlice;
  if (edge.type === "callsApi") return t.relCallsApi;
  if (edge.type === "dependsOn") return t.relDependsOn;
  return edge.type;
}

export function ViewNodeDetails(props: {
  node: ViewGraphNode;
  annotations?: MergedEnrichmentAnnotation[];
  actions?: ReactNode;
  onShowImpact?: () => void;
}) {
  const t = useT();
  return (
    <div className="detail-stack">
      <div className="detail-title">
        <CircleDot size={18} aria-hidden="true" />
        <div>
          <h2>{props.node.label}</h2>
          <span>{props.node.kind}</span>
        </div>
      </div>
      <KeyValues
        values={[
          ["type", props.node.dataFlow?.stage ?? props.node.nodeType],
          [t.keyLayer, props.node.fsdLayer],
          [t.keySlice, props.node.fsdSlice],
          [t.keyId, props.node.id],
        ]}
      />
      {props.node.dataFlow ? (
        <section className="edge-list">
          <h3><Braces size={15} aria-hidden="true" /> Data flow</h3>
          <KeyValues values={[
            ["inputs", props.node.dataFlow.inputs?.join(", ")],
            ["values", props.node.dataFlow.values?.join(", ")],
            ["outputs", props.node.dataFlow.outputs?.join(", ")],
            ["note", props.node.dataFlow.note],
          ]} />
          <FlowEvidenceList evidence={props.node.dataFlow.evidence ?? []} />
        </section>
      ) : null}
      {props.annotations && props.annotations.length > 0 ? (
        <section className="edge-list trace-annotations">
          <h3><Braces size={15} aria-hidden="true" /> Documentation</h3>
          {props.annotations.map((annotation) => (
            <article key={`${annotation.moduleId}:${annotation.id}`}>
              <strong>{annotation.kind}</strong>
              <EnrichmentMarkdown markdown={annotation.markdown} />
              <TraceAnnotationAssociation annotation={annotation} t={t} />
            </article>
          ))}
        </section>
      ) : null}
      {props.actions ? (
        <div className="trace-value-actions">{props.actions}</div>
      ) : null}
      {props.node.dataFlow && props.onShowImpact ? (
        <button type="button" className="source-button" onClick={props.onShowImpact}>
          <Radar size={14} aria-hidden="true" /> {t.btnImpact}
        </button>
      ) : null}
    </div>
  );
}

function TraceAnnotationAssociation(props: {
  annotation: MergedEnrichmentAnnotation;
  t: T;
}) {
  const association = props.annotation.association;
  if (!association) return null;
  const source = association.sourceLabel ?? association.sourceTargetId;
  const relations = association.relations
    .map((relation) => traceAssociationRelation(relation, props.t))
    .join(" → ");
  const confidence = association.confidence
    ? traceAssociationConfidence(association.confidence, props.t)
    : undefined;
  return (
    <small className={`trace-annotation-association association-${association.kind}`}>
      {association.kind === "inherited" ? props.t.docsInheritedFrom : props.t.docsRelatedFrom}{" "}
      <strong>{source}</strong>
      {relations ? ` · ${props.t.docsVia} ${relations}` : ""}
      {confidence ? ` · ${confidence}` : ""}
    </small>
  );
}

function traceAssociationRelation(relation: string, t: T) {
  return ({
    binds: t.flowRelationBinds,
    passes: t.flowRelationPasses,
    returns: t.flowRelationReturns,
    derives: t.flowRelationDerives,
    controls: t.flowRelationControls,
  } as Record<string, string>)[relation] ?? relation;
}

function traceAssociationConfidence(
  confidence: "high" | "medium" | "low" | "unknown",
  t: T
) {
  return ({
    high: t.flowConfidenceHigh,
    medium: t.flowConfidenceMedium,
    low: t.flowConfidenceLow,
    unknown: t.flowConfidenceUnknown,
  })[confidence];
}

export function ViewEdgeDetails(props: { edge: ViewGraphEdge }) {
  const t = useT();
  return (
    <div className="detail-stack">
      <div className="detail-title">
        <Cable size={18} aria-hidden="true" />
        <div>
          <h2>{props.edge.label ?? props.edge.type}</h2>
          <span>{props.edge.flowEdge?.confidence ?? t.keyViewEdge}</span>
        </div>
      </div>
      <KeyValues
        values={[
          [t.keyFrom, props.edge.from],
          [t.keyTo, props.edge.to],
          [t.keyId, props.edge.id],
        ]}
      />
      <FlowEvidenceList evidence={props.edge.flowEdge?.evidence ?? []} />
    </div>
  );
}

function FlowEvidenceList(props: { evidence: FlowEvidence[] }) {
  const evidence = props.evidence.filter((entry) => entry.file || entry.code);
  if (evidence.length === 0) return null;
  return (
    <div className="evidence-list">
      {evidence.slice(0, 6).map((entry, index) => (
        <div key={`${entry.file}:${entry.line}:${index}`} className="evidence-item">
          <dl>
            <div><dt>file</dt><dd>{entry.file}</dd></div>
            <div><dt>line</dt><dd>{entry.line}</dd></div>
          </dl>
          {entry.code ? <code>{entry.code}</code> : null}
        </div>
      ))}
    </div>
  );
}

function EdgeList(props: {
  title: string;
  edges: ProjectMapEdge[];
  onViewEdgeUsage: (edge: ProjectMapEdge) => void;
}) {
  const t = useT();
  return (
    <section className="edge-list">
      <h3><Cable size={15} aria-hidden="true" /> {props.title}</h3>
      {props.edges.slice(0, 12).map((edge) => (
        <div key={edge.id} className="edge-item">
          <div className="edge-item-main">
            <strong>{edge.type}</strong>
            <span>{props.title === t.edgeIncoming ? edge.from : edge.to}</span>
          </div>
          <SourceViewerButton
            label={t.btnViewUsage}
            size="small"
            disabled={!canViewEdgeUsage(edge)}
            title={canViewEdgeUsage(edge) ? undefined : t.tipNoEvidence}
            onClick={() => props.onViewEdgeUsage(edge)}
          />
        </div>
      ))}
    </section>
  );
}
