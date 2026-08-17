import { Activity, AlertTriangle, ArrowRight, Database, FileCode2, Globe2, MonitorDot } from "lucide-react";
import type { ReactNode } from "react";
import type {
  PageActionOperation,
  PageActionReference,
  PageActionStateChange,
  PageActionSummary,
} from "../../../flow/buildPageActionSummary.js";
import type { FlowEvidence } from "../../../flow/types.js";
import { analysisIssueReason } from "../analysisIssuePresentation.js";
import { useT, type T } from "../i18n.js";

export function PageActionsScreen(props: {
  summary: PageActionSummary;
  onOpenFlow: (flowId: string) => void;
  onOpenEvidence: (evidence: FlowEvidence, title: string) => void;
  onOpenImpact: (operationId: string) => void;
}) {
  const t = useT();
  const metrics = [
    [props.summary.stats.operationsCount, t.actionsMetricOperations],
    [props.summary.stats.initiatorsCount, t.actionsMetricInitiators],
    [props.summary.stats.apiCallsCount, t.actionsMetricApiCalls],
    [props.summary.stats.exactStateChangesCount, t.actionsMetricStateChanges],
    [props.summary.stats.uiOutcomesCount, t.actionsMetricUiOutcomes],
  ] as const;

  return (
    <article className="page-actions-screen">
      <header className="product-screen-header">
        <span>{t.actionsKicker}</span>
        <h1>{t.actionsTitle}</h1>
        <p>{t.actionsSubtitle}</p>
      </header>

      <section className="page-actions-overview" aria-label={t.actionsFacts}>
        <span>{t.unitFactsLabel}</span>
        <div className="page-actions-metrics">
          {metrics.map(([value, label]) => (
            <div key={label}>
              <strong>{value}</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </section>

      {props.summary.operations.length === 0 ? (
        <div className="product-empty page-actions-empty">
          <Activity size={22} aria-hidden="true" />
          <strong>{t.actionsNoOperations}</strong>
        </div>
      ) : (
        <div className="page-action-list">
          {props.summary.operations.map((operation) => (
            <OperationCard
              key={operation.operation.id}
              operation={operation}
              onOpenFlow={props.onOpenFlow}
              onOpenEvidence={props.onOpenEvidence}
              onOpenImpact={props.onOpenImpact}
            />
          ))}
        </div>
      )}
    </article>
  );
}

function OperationCard(props: {
  operation: PageActionOperation;
  onOpenFlow: (flowId: string) => void;
  onOpenEvidence: (evidence: FlowEvidence, title: string) => void;
  onOpenImpact: (operationId: string) => void;
}) {
  const t = useT();
  const { operation } = props;
  const evidence = operation.operation.evidence[0];
  const answerParts = [
    operation.initiators.map((reference) => reference.name).join(", "),
    operation.operation.name,
    operation.apiCalls.filter((reference) => reference.id !== operation.operation.id)
      .map((reference) => reference.name).join(", "),
    operation.stateChanges.map((reference) => reference.name).join(", "),
    operation.uiOutcomes.map((reference) => reference.name).join(", "),
  ].filter(Boolean);

  return (
    <section className="page-action-card" data-page-operation={operation.operation.name}>
      <div className="page-action-card-heading">
        <div>
          <span className="unit-type-chip">{operationTypeLabel(operation.operation.type, t)}</span>
          <h2>{operationDisplayName(operation.operation)}</h2>
        </div>
        <div className="page-action-card-actions">
          {evidence ? (
            <button type="button" onClick={() => props.onOpenEvidence(evidence, operation.operation.name)}>
              <FileCode2 size={14} aria-hidden="true" /> {t.actionsOpenEvidence}
            </button>
          ) : null}
          <button type="button" onClick={() => props.onOpenImpact(operation.operation.id)}>
            <Activity size={14} aria-hidden="true" /> {t.btnImpact}
          </button>
        </div>
      </div>

      {answerParts.length > 1 ? (
        <div className="page-action-answer">
          {answerParts.map((part, index) => (
            <span key={`${part}:${index}`}>
              {index > 0 ? <ArrowRight size={13} aria-hidden="true" /> : null}
              <strong>{part}</strong>
            </span>
          ))}
        </div>
      ) : null}

      {operation.detailLevel === "topology-only" ? (
        <div className="page-action-topology-note">
          <AlertTriangle size={14} aria-hidden="true" /> {t.actionsTopologyOnly}
        </div>
      ) : null}

      <div className="page-action-model">
        <ActionColumn
          icon={<Activity size={15} aria-hidden="true" />}
          title={t.actionsInitiatedBy}
          references={operation.initiators}
          emptyText={t.actionsInitiatorNotFound}
          onOpenEvidence={props.onOpenEvidence}
        />
        <ActionColumn
          icon={<Globe2 size={15} aria-hidden="true" />}
          title={t.actionsApiCalls}
          references={operation.apiCalls}
          emptyText={operation.operation.type === "action"
            ? t.actionsNoExternalCall
            : t.actionsApiNotTraced}
          onOpenEvidence={props.onOpenEvidence}
        />
        <StateChanges changes={operation.stateChanges} onOpenEvidence={props.onOpenEvidence} />
        <ActionColumn
          icon={<MonitorDot size={15} aria-hidden="true" />}
          title={t.actionsUiOutcomes}
          references={operation.uiOutcomes}
          emptyText={t.actionsUiOutcomeNotTraced}
          onOpenEvidence={props.onOpenEvidence}
        />
      </div>

      {operation.affectedValues.length > 0 ? (
        <div className="page-action-values">
          <small>{t.actionsAffectedValues}</small>
          <div>
            {operation.affectedValues.map((value) => (
              <button key={value.flowId} type="button" onClick={() => props.onOpenFlow(value.flowId)}>
                {value.path ?? value.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {operation.issues.length > 0 ? (
        <div className="page-action-issues">
          <AlertTriangle size={14} aria-hidden="true" />
          <span>{[...new Set(operation.issues.map((issue) => analysisIssueReason(issue.reasonCode, t).title))].join(" · ")}</span>
        </div>
      ) : null}
    </section>
  );
}

function ActionColumn(props: {
  icon: ReactNode;
  title: string;
  references: PageActionReference[];
  emptyText: string;
  onOpenEvidence: (evidence: FlowEvidence, title: string) => void;
}) {
  return (
    <section className="page-action-column">
      <h3>{props.icon}{props.title}</h3>
      {props.references.length > 0 ? (
        <div>
          {props.references.map((reference) => (
            <ReferenceButton key={reference.id} reference={reference} onOpenEvidence={props.onOpenEvidence} />
          ))}
        </div>
      ) : <span className="page-action-empty-value">{props.emptyText}</span>}
    </section>
  );
}

function StateChanges(props: {
  changes: PageActionStateChange[];
  onOpenEvidence: (evidence: FlowEvidence, title: string) => void;
}) {
  const t = useT();
  return (
    <section className="page-action-column page-action-state-column">
      <h3><Database size={15} aria-hidden="true" />{t.actionsStateChanges}</h3>
      {props.changes.length > 0 ? (
        <div>
          {props.changes.map((change) => (
            <div key={change.id} className="page-action-state-change">
              <ReferenceButton reference={change} onOpenEvidence={props.onOpenEvidence} />
              <small>{change.exact ? t.actionsExactState : t.actionsSliceState}</small>
              {change.lifecycle ? <code>{t.actionsLifecycle}: {change.lifecycle}</code> : null}
              {change.valueOrigin ? <code>{t.actionsValueOrigin}: {valueOriginLabel(change.valueOrigin, t)}</code> : null}
            </div>
          ))}
        </div>
      ) : <span className="page-action-empty-value">—</span>}
    </section>
  );
}

function ReferenceButton(props: {
  reference: PageActionReference;
  onOpenEvidence: (evidence: FlowEvidence, title: string) => void;
}) {
  const t = useT();
  const evidence = props.reference.evidence[0];
  return evidence ? (
    <button
      type="button"
      className="page-action-reference"
      onClick={() => props.onOpenEvidence(evidence, props.reference.name)}
    >
      {props.reference.name}
      {props.reference.context === "project" ? <small>{t.actionsProjectWide}</small> : null}
      <FileCode2 size={12} aria-hidden="true" />
    </button>
  ) : <span className="page-action-reference is-static">
    {props.reference.name}
    {props.reference.context === "project" ? <small>{t.actionsProjectWide}</small> : null}
  </span>;
}

function operationTypeLabel(type: PageActionReference["type"], t: T) {
  if (type === "action") return t.nodeAction;
  if (type === "thunk") return t.nodeThunk;
  if (type === "api") return t.nodeApi;
  return t.nodeUnknown;
}

function operationDisplayName(operation: PageActionReference) {
  if (operation.type !== "action") return operation.name;
  return operation.name.split(".").pop() ?? operation.name;
}

function valueOriginLabel(origin: NonNullable<PageActionStateChange["valueOrigin"]>, t: T) {
  return {
    payload: t.actionsOriginPayload,
    literal: t.actionsOriginLiteral,
    reset: t.actionsOriginReset,
    derived: t.actionsOriginDerived,
    unknown: t.actionsOriginUnknown,
  }[origin];
}
