import {
  AlertTriangle,
  ArrowRight,
  Database,
  FileCode2,
  GitBranch,
  MonitorDot,
  Network,
  Radar,
  Workflow,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import type {
  PageImpactItem,
  PageImpactReference,
  PageImpactStage,
  PageImpactSummary,
} from "../../../flow/buildPageImpactSummary.js";
import type { FlowEvidence } from "../../../flow/types.js";
import { analysisIssueReason } from "../analysisIssuePresentation.js";
import { useT, type T } from "../i18n.js";

export function PageImpactScreen(props: {
  summary: PageImpactSummary;
  onOpenFlow: (flowId: string) => void;
  onOpenEvidence: (evidence: FlowEvidence, title: string) => void;
  onOpenImpactGraph: (targetId: string) => void;
  onOpenSymbol: (targetId: string) => void;
  onOpenPage: (pageId: string) => void;
}) {
  const t = useT();
  const metrics = [
    [props.summary.stats.changePointsCount, t.pageImpactMetricPoints],
    [props.summary.stats.affectedValuesCount, t.pageImpactMetricValues],
    [props.summary.stats.uiOutcomesCount, t.pageImpactMetricUi],
    [props.summary.stats.crossPageDependenciesCount, t.pageImpactMetricCrossPage],
    [props.summary.stats.possibleLinksCount, t.pageImpactMetricPossible],
  ] as const;

  return (
    <article className="page-impact-screen">
      <header className="product-screen-header">
        <span>{t.pageImpactKicker}</span>
        <h1>{t.pageImpactTitle}</h1>
        <p>{t.pageImpactSubtitle}</p>
      </header>

      <section className="page-impact-overview" aria-label={t.pageImpactFacts}>
        <div className="page-impact-answer">
          <Radar size={20} aria-hidden="true" />
          <p>
            <strong>{props.summary.stats.changePointsCount}</strong> {t.pageImpactAnswerPoints}
            {" · "}<strong>{props.summary.stats.affectedValuesCount}</strong> {t.pageImpactAnswerValues}
            {props.summary.stats.crossPageDependenciesCount > 0 ? (
              <> · <strong>{props.summary.stats.crossPageDependenciesCount}</strong> {t.pageImpactAnswerCrossPage}</>
            ) : null}
          </p>
        </div>
        <div className="page-impact-metrics">
          {metrics.map(([value, label]) => (
            <div key={label}><strong>{value}</strong><span>{label}</span></div>
          ))}
        </div>
      </section>

      {props.summary.groups.length === 0 ? (
        <div className="product-empty page-impact-empty">
          <Radar size={22} aria-hidden="true" />
          <strong>{t.pageImpactEmpty}</strong>
        </div>
      ) : (
        <div className="page-impact-groups">
          {props.summary.groups.map((group) => (
            <ImpactStageGroup
              key={group.stage}
              stage={group.stage}
              items={group.items}
              {...props}
            />
          ))}
        </div>
      )}
    </article>
  );
}

function ImpactStageGroup(props: {
  stage: PageImpactStage;
  items: PageImpactItem[];
  summary: PageImpactSummary;
  onOpenFlow: (flowId: string) => void;
  onOpenEvidence: (evidence: FlowEvidence, title: string) => void;
  onOpenImpactGraph: (targetId: string) => void;
  onOpenSymbol: (targetId: string) => void;
  onOpenPage: (pageId: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(props.stage === "source" || props.stage === "operation");
  return (
    <details className="page-impact-stage" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <span className="page-impact-stage-icon">{stageIcon(props.stage)}</span>
        <span><strong>{stageLabel(props.stage, t)}</strong><small>{stageHint(props.stage, t)}</small></span>
        <b>{props.items.length}</b>
      </summary>
      <div className="page-impact-list">
        {props.items.map((item) => <ImpactCard key={item.id} item={item} {...props} />)}
      </div>
    </details>
  );
}

function ImpactCard(props: {
  item: PageImpactItem;
  summary: PageImpactSummary;
  onOpenFlow: (flowId: string) => void;
  onOpenEvidence: (evidence: FlowEvidence, title: string) => void;
  onOpenImpactGraph: (targetId: string) => void;
  onOpenSymbol: (targetId: string) => void;
  onOpenPage: (pageId: string) => void;
}) {
  const t = useT();
  const { item } = props;
  const evidence = item.target.evidence[0];
  const possibleCount = item.possibleUiOutcomes.length + item.possibleSteps.length +
    item.possibleSymbols.length + item.possiblePages.length;

  return (
    <section className="page-impact-card" data-impact-target={item.target.name}>
      <div className="page-impact-card-heading">
        <div>
          <span className="unit-type-chip">{referenceTypeLabel(item.target, t)}</span>
          <h2>{item.target.path ?? item.target.name}</h2>
          {item.crossPage ? (
            <small className={`page-impact-cross-page is-${item.crossPage}`}>
              <GitBranch size={12} />
              {item.crossPage === "proven" ? t.pageImpactCrossPage : t.pageImpactCrossPagePossible}
            </small>
          ) : null}
        </div>
        <div className="page-impact-card-actions">
          {evidence ? (
            <button type="button" onClick={() => props.onOpenEvidence(evidence, item.target.name)}>
              <FileCode2 size={14} aria-hidden="true" />{t.pageImpactEvidence}
            </button>
          ) : null}
          <button type="button" onClick={() => props.onOpenImpactGraph(item.id)}>
            <Radar size={14} aria-hidden="true" />{t.pageImpactGraph}
          </button>
        </div>
      </div>

      <div className="page-impact-chain" aria-label={t.pageImpactChain}>
        <strong>{item.target.name}</strong><ArrowRight size={13} />
        <span>{item.affectedValues.length} {t.pageImpactValuesShort}</span><ArrowRight size={13} />
        <span>{item.uiOutcomes.length} {t.pageImpactUiShort}</span>
      </div>

      <div className="page-impact-model">
        <ImpactColumn icon={<Workflow size={15} />} title={t.pageImpactAffectedValues}>
          {item.affectedValues.length > 0 ? item.affectedValues.slice(0, 8).map((value) => (
            <button key={value.flowId} type="button" onClick={() => props.onOpenFlow(value.flowId)}>
              {value.path ?? value.name}
            </button>
          )) : <Empty text={t.pageImpactNoneProven} />}
          {item.affectedValues.length > 8 ? <More count={item.affectedValues.length - 8} /> : null}
        </ImpactColumn>
        <ImpactColumn icon={<MonitorDot size={15} />} title={t.pageImpactUiOutcomes}>
          <ReferenceList references={item.uiOutcomes} empty={t.pageImpactNoneProven} onOpenEvidence={props.onOpenEvidence} />
        </ImpactColumn>
        <ImpactColumn icon={<Network size={15} />} title={t.pageImpactAffectedSymbols}>
          <ReferenceList references={item.affectedSymbols} empty={t.pageImpactNoneProven} onOpenReference={props.onOpenSymbol} />
        </ImpactColumn>
      </div>

      <div className="page-impact-pages">
        <small>{t.pageImpactAffectedPages}</small>
        <div>{item.affectedPages.slice(0, 8).map((page) => (
          <button key={page.id} type="button" onClick={() => props.onOpenPage(page.id)}>{page.name}</button>
        ))}{item.affectedPages.length > 8 ? <More count={item.affectedPages.length - 8} /> : null}</div>
      </div>

      {possibleCount > 0 ? (
        <details className="page-impact-possible">
          <summary><AlertTriangle size={14} />{t.pageImpactPossible} · {possibleCount}</summary>
          <div className="page-impact-possible-grid">
            <ReferenceGroup title={t.pageImpactPossibleSteps} references={item.possibleSteps} />
            <ReferenceGroup title={t.pageImpactUiOutcomes} references={item.possibleUiOutcomes} />
            <ReferenceGroup title={t.pageImpactAffectedSymbols} references={item.possibleSymbols} onOpenReference={props.onOpenSymbol} />
            <ReferenceGroup title={t.pageImpactAffectedPages} references={item.possiblePages} onOpenReference={props.onOpenPage} />
          </div>
        </details>
      ) : null}

      {item.issues.length > 0 ? (
        <div className="page-impact-issues">
          <AlertTriangle size={14} />
          <span>{[...new Set(item.issues.map((issue) => analysisIssueReason(issue.reasonCode, t).title))].join(" · ")}</span>
        </div>
      ) : null}
    </section>
  );
}

function ImpactColumn(props: { icon: ReactNode; title: string; children: ReactNode }) {
  return <section className="page-impact-column"><h3>{props.icon}{props.title}</h3><div>{props.children}</div></section>;
}

function ReferenceGroup(props: {
  title: string;
  references: PageImpactReference[];
  onOpenReference?: (id: string) => void;
}) {
  if (props.references.length === 0) return null;
  return <section><small>{props.title}</small><ReferenceList references={props.references} empty="" onOpenReference={props.onOpenReference} /></section>;
}

function ReferenceList(props: {
  references: PageImpactReference[];
  empty: string;
  onOpenEvidence?: (evidence: FlowEvidence, title: string) => void;
  onOpenReference?: (id: string) => void;
  limit?: number;
}) {
  if (props.references.length === 0) return <Empty text={props.empty} />;
  const limit = props.limit ?? 6;
  return <>{props.references.slice(0, limit).map((reference) => {
    const evidence = reference.evidence[0];
    const onClick = props.onOpenReference
      ? () => props.onOpenReference!(reference.id)
      : evidence && props.onOpenEvidence
        ? () => props.onOpenEvidence!(evidence, reference.name)
        : undefined;
    return onClick ? (
      <button key={reference.id} type="button" onClick={onClick}>
        {reference.path ?? reference.name}{evidence && !props.onOpenReference ? <FileCode2 size={11} /> : null}
      </button>
    ) : <span key={reference.id}>{reference.path ?? reference.name}</span>;
  })}{props.references.length > limit ? <More count={props.references.length - limit} /> : null}</>;
}

function Empty(props: { text: string }) {
  return <span className="page-impact-empty-value">{props.text}</span>;
}

function More(props: { count: number }) {
  return <span className="page-impact-more">+{props.count}</span>;
}

function stageIcon(stage: PageImpactStage) {
  if (stage === "source") return <Network size={17} />;
  if (stage === "state") return <Database size={17} />;
  if (stage === "operation") return <Workflow size={17} />;
  return <GitBranch size={17} />;
}

function stageLabel(stage: PageImpactStage, t: T) {
  return {
    source: t.pageImpactGroupSources,
    state: t.pageImpactGroupState,
    operation: t.pageImpactGroupOperations,
    logic: t.pageImpactGroupLogic,
  }[stage];
}

function stageHint(stage: PageImpactStage, t: T) {
  return {
    source: t.pageImpactGroupSourcesHint,
    state: t.pageImpactGroupStateHint,
    operation: t.pageImpactGroupOperationsHint,
    logic: t.pageImpactGroupLogicHint,
  }[stage];
}

function referenceTypeLabel(reference: PageImpactReference, t: T) {
  if (reference.type === "api") return t.nodeApi;
  if (reference.type === "state-field" || reference.type === "slice-model") return t.stageStoreField;
  if (reference.type === "async-operation" || reference.type === "thunk") return t.nodeThunk;
  if (reference.type === "selector-result" || reference.type === "selector") return t.nodeSelector;
  if (reference.type === "hook-return" || reference.type === "hook") return t.nodeHook;
  return t.nodeUnknown;
}
