import { AlertTriangle, ArrowDown, Braces, FileCode2 } from "lucide-react";
import type { ReactNode } from "react";
import type {
  ValueJourney,
  ValueJourneyEvidence,
  ValueJourneyStep,
  ValueJourneyView,
} from "../../../flow/buildValueJourney.js";
import type { FlowEvidence, FlowNodeKind, FlowRelation } from "../../../flow/types.js";
import { analysisIssueReason } from "../analysisIssuePresentation.js";
import { useT, type T } from "../i18n.js";

export function ValueJourneyScreen(props: {
  journey: ValueJourney;
  view: Exclude<ValueJourneyView, "graph">;
  onOpenEvidence: (evidence: FlowEvidence, title: string) => void;
  onOpenStepCode: (evidence: FlowEvidence, title: string) => void;
  renderStepDetails?: (step: ValueJourneyStep) => ReactNode;
}) {
  const t = useT();
  const source = props.journey.steps
    .filter((step) => step.predecessorIds.length === 0)
    .map((step) => step.gap ? analysisIssueReason(step.gap.reasonCode, t).title : step.name)
    .join(", ") || t.flowAnswerUnknown;
  const consumer = props.journey.consumerNames.join(", ") || t.flowAnswerUnknown;

  return (
    <section className="value-journey-screen" aria-label={t.flowTraceSingle}>
      <header className="value-journey-header">
        <span className="analysis-fact-label">{t.unitFactsLabel}</span>
        <h1>{props.journey.subject.path ?? props.journey.subject.name}</h1>
        <p className="value-journey-answer">
          <strong>{props.journey.subject.path ?? props.journey.subject.name}</strong>
          {` — ${t.flowAnswerSource.toLowerCase()} `}<strong>{source}</strong>;
          {` ${t.flowAnswerReaches} `}<strong>{consumer}</strong>.
        </p>
        <div className="value-journey-metrics" aria-label={t.flowTraceQuality}>
          <span>{props.journey.stats.stepsCount} {t.flowStepsCount}</span>
          <span>{props.journey.stats.evidenceCount} {t.flowEvidenceCount}</span>
          <span className={props.journey.stats.gapCount > 0 ? "quality-warn" : "quality-ok"}>
            {props.journey.stats.gapCount} {t.traceGapsLabel}
          </span>
          <span>{props.journey.isBranched ? t.flowBranched : t.flowLinear}</span>
        </div>
      </header>

      {props.view === "steps" ? (
        <JourneySteps
          journey={props.journey}
          onOpenStepCode={props.onOpenStepCode}
          renderStepDetails={props.renderStepDetails}
        />
      ) : (
        <JourneyEvidence journey={props.journey} onOpenEvidence={props.onOpenEvidence} />
      )}
    </section>
  );
}

function JourneySteps(props: {
  journey: ValueJourney;
  onOpenStepCode: (evidence: FlowEvidence, title: string) => void;
  renderStepDetails?: (step: ValueJourneyStep) => ReactNode;
}) {
  const t = useT();
  return (
    <div className="value-journey-steps" data-trace-view="steps">
      <div className="value-journey-section-heading">
        <div>
          <span className="section-kicker">{t.flowStepsTab}</span>
          <h2>{t.flowStepsTitle}</h2>
        </div>
        {props.journey.isBranched ? <span className="journey-branch-hint">{t.flowGraphRecommended}</span> : null}
      </div>
      <ol>
        {props.journey.steps.map((step, index) => {
          const evidence = props.journey.evidence.find((entry) =>
            entry.stepId === step.id && Boolean(entry.code)
          );
          const gapPresentation = step.gap ? analysisIssueReason(step.gap.reasonCode, t) : null;
          const displayName = gapPresentation?.title ?? step.name;
          return (
            <li key={step.id} className={`value-journey-step${step.gap ? " is-gap" : ""}`} data-flow-step={step.name}>
              <div className="journey-step-index">{index + 1}</div>
              <div className="journey-step-card">
                <div className="journey-step-topline">
                  <span className="journey-step-kind">{stageLabel(step.kind, t)}</span>
                  <span className={`confidence-chip confidence-${step.confidence}`}>{confidenceLabel(step.confidence, t)}</span>
                </div>
                <strong className="journey-step-name">{displayName}</strong>
                {step.path && step.path !== step.name ? <code className="journey-step-path">{step.path}</code> : null}
                {step.incomingRelations.length > 0 ? (
                  <div className="journey-step-relation">
                    <ArrowDown size={13} aria-hidden="true" /> {step.incomingRelations.map((relation) => relationLabel(relation, t)).join(" · ")}
                  </div>
                ) : null}
                {isBranch(step) ? (
                  <div className="journey-branch-note">
                    <Braces size={13} aria-hidden="true" /> {branchLabel(step, t)}
                  </div>
                ) : null}
                {props.renderStepDetails ? (
                  <div className="journey-step-module-details">
                    {props.renderStepDetails(step)}
                  </div>
                ) : null}
                {step.gap && gapPresentation ? (
                  <div className="journey-gap-reason">
                    <AlertTriangle size={14} aria-hidden="true" />
                    <span>
                      <strong>{gapPresentation.title}</strong> · {gapPresentation.detail}
                      <code>{t.pageIssuesReasonCode}: {step.gap.reasonCode}</code>
                    </span>
                  </div>
                ) : null}
                {evidence ? (
                  <button
                    type="button"
                    className="journey-evidence-link"
                    onClick={() => props.onOpenStepCode(evidence, displayName)}
                  >
                    <FileCode2 size={13} aria-hidden="true" />
                    {t.flowViewStepCode}
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function JourneyEvidence(props: {
  journey: ValueJourney;
  onOpenEvidence: (evidence: FlowEvidence, title: string) => void;
}) {
  const t = useT();
  return (
    <div className="value-journey-evidence" data-trace-view="evidence">
      <div className="value-journey-section-heading">
        <div>
          <span className="section-kicker">{t.flowEvidenceTab}</span>
          <h2>{t.flowEvidenceTitle}</h2>
        </div>
      </div>
      {props.journey.evidence.length > 0 ? (
        <div className="journey-evidence-list">
          {props.journey.evidence.map((entry) => (
            <EvidenceRow key={entry.id} entry={entry} onOpen={props.onOpenEvidence} />
          ))}
        </div>
      ) : (
        <div className="empty-state journey-evidence-empty">
          <FileCode2 size={22} aria-hidden="true" />
          <strong>{t.flowEvidenceEmpty}</strong>
        </div>
      )}
    </div>
  );
}

function EvidenceRow(props: {
  entry: ValueJourneyEvidence;
  onOpen: (evidence: FlowEvidence, title: string) => void;
}) {
  const t = useT();
  return (
    <article className="journey-evidence-row">
      <div className="journey-evidence-row-head">
        <div>
          <span className="journey-evidence-context">
            {props.entry.source === "relation" && props.entry.relation
              ? relationLabel(props.entry.relation, t)
              : t.flowNodeEvidence}
          </span>
          <strong>{props.entry.stepName}</strong>
        </div>
        <span className={`confidence-chip confidence-${props.entry.confidence}`}>{confidenceLabel(props.entry.confidence, t)}</span>
      </div>
      <button
        type="button"
        className="journey-evidence-source"
        onClick={() => props.onOpen(props.entry, props.entry.stepName)}
      >
        <FileCode2 size={14} aria-hidden="true" />
        <span>{props.entry.file}{props.entry.line ? `:${props.entry.line}` : ""}</span>
      </button>
      {props.entry.code ? <code className="journey-evidence-code">{props.entry.code}</code> : null}
    </article>
  );
}

function isBranch(step: ValueJourneyStep) {
  return step.predecessorIds.length > 1 || step.successorIds.length > 1;
}

function branchLabel(step: ValueJourneyStep, t: T) {
  const labels: string[] = [];
  if (step.predecessorIds.length > 1) labels.push(`${step.predecessorIds.length} ${t.flowInputsCount}`);
  if (step.successorIds.length > 1) labels.push(`${step.successorIds.length} ${t.flowOutputsCount}`);
  return labels.join(" · ");
}

function stageLabel(kind: FlowNodeKind, t: T) {
  switch (kind) {
    case "boundary": return t.stageBoundary;
    case "api": return t.stageNetwork;
    case "async-operation": return t.stageAsyncOperation;
    case "state-field": return t.stageStoreField;
    case "selector-result": return t.stageSelector;
    case "hook-input": return t.stageHookInput;
    case "hook-return": return t.stageHookReturn;
    case "component-value": return t.stageComponentValue;
    case "prop": return t.stageUiReceiver;
    case "ui-effect": return t.stageUiEffect;
    case "gap": return t.stageTraceGap;
  }
}

function relationLabel(relation: FlowRelation, t: T) {
  return {
    produces: t.flowRelationProduces,
    writes: t.flowRelationWrites,
    selects: t.flowRelationSelects,
    derives: t.flowRelationDerives,
    returns: t.flowRelationReturns,
    binds: t.flowRelationBinds,
    passes: t.flowRelationPasses,
    controls: t.flowRelationControls,
  }[relation];
}

function confidenceLabel(confidence: ValueJourneyStep["confidence"], t: T) {
  return {
    high: t.flowConfidenceHigh,
    medium: t.flowConfidenceMedium,
    low: t.flowConfidenceLow,
    unknown: t.flowConfidenceUnknown,
  }[confidence];
}
