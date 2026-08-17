import {
  AlertTriangle,
  BookOpenCheck,
  CheckCircle2,
  FileCode2,
  FileWarning,
  FlaskConical,
  Link2,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ArtifactHealth, ArtifactHealthStatus } from "../../../artifacts/types.js";
import type { AnalysisIssueGroup } from "../../../flow/buildAnalysisIssueSummary.js";
import type { PageQualitySummary, PageQualityStatus } from "../../../flow/buildPageQualitySummary.js";
import type { FlowEvidence } from "../../../flow/types.js";
import type { DocsCoverageNode, DocsCoverageResponse } from "../../../modules/docs/shared/apiTypes.js";
import type { E2eStatusResponse } from "../../../modules/e2e/shared/apiTypes.js";
import { fetchJson } from "../../../modules/ui/apiClient.js";
import { subscribeEnrichmentChanges } from "../../../modules/ui/enrichmentEvents.js";
import { analysisIssueReason } from "../analysisIssuePresentation.js";
import { useT, type T } from "../i18n.js";

type Loadable<T> =
  | { status: "loading" }
  | { status: "available"; value: T }
  | { status: "unavailable" };

export function PageQualityScreen(props: {
  summary: PageQualitySummary;
  topologyNodeIds: string[];
  artifactHealth: ArtifactHealth | null;
  onOpenFlow: (flowId: string) => void;
  onOpenEvidence: (evidence: FlowEvidence, title: string) => void;
  onOpenSymbol: (nodeId: string) => void;
}) {
  const t = useT();
  const topologyKey = props.topologyNodeIds.join("\0");
  const [refresh, setRefresh] = useState(0);
  const [docs, setDocs] = useState<Loadable<DocsCoverageResponse>>({ status: "loading" });
  const [e2e, setE2e] = useState<Loadable<E2eStatusResponse>>({ status: "loading" });

  useEffect(() => subscribeEnrichmentChanges(() => setRefresh((value) => value + 1)), []);

  useEffect(() => {
    let active = true;
    setDocs({ status: "loading" });
    fetchJson<DocsCoverageResponse>("/api/docs/coverage")
      .then((value) => { if (active) setDocs({ status: "available", value }); })
      .catch(() => { if (active) setDocs({ status: "unavailable" }); });
    return () => { active = false; };
  }, [props.summary.pageId, topologyKey, refresh]);

  useEffect(() => {
    let active = true;
    setE2e({ status: "loading" });
    fetchJson<E2eStatusResponse>(`/api/e2e/node/${encodeURIComponent(props.summary.pageId)}/status`)
      .then((value) => { if (active) setE2e({ status: "available", value }); })
      .catch(() => { if (active) setE2e({ status: "unavailable" }); });
    return () => { active = false; };
  }, [props.summary.pageId, refresh]);

  const scopedDocs = useMemo(() => {
    if (docs.status !== "available") return [];
    const ids = new Set(props.topologyNodeIds);
    return docs.value.nodes.filter((node) => ids.has(node.nodeId));
  }, [docs, topologyKey]);

  const uncertainLinks = props.summary.confidence.low + props.summary.confidence.unknown;
  const metrics = [
    [props.summary.values.totalCount, t.qualityMetricValues],
    [`${props.summary.origin.resolvedPct}%`, t.qualityMetricOrigin],
    [`${props.summary.continuation.resolvedPct}%`, t.qualityMetricContinuation],
    [props.summary.issues.totalCount, t.qualityMetricIssues],
    [uncertainLinks, t.qualityMetricUncertain],
  ] as const;

  return (
    <article className="page-quality-screen">
      <header className="product-screen-header">
        <span>{t.qualityKicker}</span>
        <h1>{t.qualityTitle}</h1>
        <p>{t.qualitySubtitle}</p>
      </header>

      <section className={`page-quality-answer status-${props.summary.status}`}>
        <ShieldCheck size={22} aria-hidden="true" />
        <div>
          <strong>{qualityStatusLabel(props.summary.status, t)}</strong>
          <span>{t.qualityStatusHint}</span>
        </div>
      </section>

      <div className="page-quality-metrics">
        {metrics.map(([value, label]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}
      </div>

      <QualitySection icon={<ShieldCheck size={18} />} title={t.qualityAnalysisTitle} hint={t.qualityAnalysisHint}>
        <div className="page-quality-analysis-grid">
          <CoverageCard
            title={t.qualityOrigin}
            resolved={props.summary.origin.resolvedCount}
            total={props.summary.values.totalCount}
            percent={props.summary.origin.resolvedPct}
            details={[
              [t.qualityProven, props.summary.origin.statuses.proven],
              [t.qualityKnownBoundary, props.summary.origin.statuses.boundary],
              [t.qualityGaps, props.summary.origin.statuses.gap],
              [t.qualityUnknown, props.summary.origin.statuses.unknown],
            ]}
          />
          <CoverageCard
            title={t.qualityContinuation}
            resolved={props.summary.continuation.resolvedCount}
            total={props.summary.values.totalCount}
            percent={props.summary.continuation.resolvedPct}
            details={[
              [t.qualityProven, props.summary.continuation.statuses.proven],
              [t.qualityTerminalAtUnit, props.summary.continuation.statuses["terminal-at-unit"]],
              [t.qualityGaps, props.summary.continuation.statuses.gap],
              [t.qualityUnknown, props.summary.continuation.statuses.unknown],
            ]}
          />
          <div className="page-quality-fact-card">
            <h3><Link2 size={15} />{t.qualityConfidence}</h3>
            <div className="quality-confidence-list">
              <ConfidenceRow label={t.flowConfidenceHigh} value={props.summary.confidence.high} tone="high" />
              <ConfidenceRow label={t.flowConfidenceMedium} value={props.summary.confidence.medium} tone="medium" />
              <ConfidenceRow label={t.flowConfidenceLow} value={props.summary.confidence.low} tone="low" />
              <ConfidenceRow label={t.flowConfidenceUnknown} value={props.summary.confidence.unknown} tone="unknown" />
            </div>
          </div>
          <div className="page-quality-fact-card">
            <h3><FileCode2 size={15} />{t.qualityEvidence}</h3>
            <EvidenceRow
              label={t.qualityEvidenceNodes}
              value={props.summary.evidence.nodesWithEvidenceCount}
              total={props.summary.evidence.nodesCount}
            />
            <EvidenceRow
              label={t.qualityEvidenceEdges}
              value={props.summary.evidence.edgesWithEvidenceCount}
              total={props.summary.evidence.edgesCount}
            />
          </div>
        </div>
      </QualitySection>

      <QualitySection icon={<FileWarning size={18} />} title={t.qualityIssuesTitle} hint={t.qualityIssuesHint}>
        {props.summary.issues.groups.length === 0 ? (
          <QualityEmpty icon={<CheckCircle2 size={18} />} text={t.qualityIssuesEmpty} />
        ) : (
          <div className="page-quality-issue-list">
            {props.summary.issues.groups.map((group) => (
              <IssueGroup key={group.reasonCode} group={group} {...props} />
            ))}
          </div>
        )}
      </QualitySection>

      <QualitySection icon={<BookOpenCheck size={18} />} title={t.qualityDocsTitle} hint={t.qualityDocsHint}>
        <DocsQuality state={docs} nodes={scopedDocs} onOpenSymbol={props.onOpenSymbol} />
      </QualitySection>

      <QualitySection icon={<FlaskConical size={18} />} title={t.qualityE2eTitle} hint={t.qualityE2eHint}>
        <E2eQuality state={e2e} onOpenSymbol={props.onOpenSymbol} />
      </QualitySection>

      <QualitySection icon={<FileCode2 size={18} />} title={t.qualityArtifactsTitle} hint={t.qualityArtifactsHint}>
        <ArtifactQuality health={props.artifactHealth} />
      </QualitySection>
    </article>
  );
}

function QualitySection(props: { icon: ReactNode; title: string; hint: string; children: ReactNode }) {
  return (
    <section className="page-quality-section">
      <header><span>{props.icon}</span><div><h2>{props.title}</h2><p>{props.hint}</p></div></header>
      <div className="page-quality-section-body">{props.children}</div>
    </section>
  );
}

function CoverageCard(props: {
  title: string;
  resolved: number;
  total: number;
  percent: number;
  details: Array<[string, number]>;
}) {
  const t = useT();
  return (
    <div className="page-quality-fact-card quality-coverage-card">
      <div className="quality-coverage-heading"><h3>{props.title}</h3><strong>{props.percent}%</strong></div>
      <div className="quality-progress"><span style={{ width: `${props.percent}%` }} /></div>
      <p><b>{props.resolved}</b> {t.qualityResolvedOf} {props.total}</p>
      <div className="quality-detail-pills">
        {props.details.filter(([, value]) => value > 0).map(([label, value]) => (
          <span key={label}>{label} · {value}</span>
        ))}
      </div>
    </div>
  );
}

function ConfidenceRow(props: { label: string; value: number; tone: string }) {
  return <div><span className={`quality-dot tone-${props.tone}`} /> <span>{props.label}</span><strong>{props.value}</strong></div>;
}

function EvidenceRow(props: { label: string; value: number; total: number }) {
  const percent = props.total > 0 ? Math.round((props.value / props.total) * 100) : 0;
  return (
    <div className="quality-evidence-row">
      <span>{props.label}</span><strong>{props.value} / {props.total}</strong>
      <div className="quality-progress"><span style={{ width: `${percent}%` }} /></div>
    </div>
  );
}

function IssueGroup(props: {
  group: AnalysisIssueGroup;
  onOpenFlow: (flowId: string) => void;
  onOpenEvidence: (evidence: FlowEvidence, title: string) => void;
}) {
  const t = useT();
  const presentation = analysisIssueReason(props.group.reasonCode, t);
  const values = [...new Map(props.group.issues.flatMap((issue) => issue.affectedValues)
    .map((value) => [value.flowId, value])).values()];
  const evidence = props.group.issues.flatMap((issue) => issue.evidence)[0];
  return (
    <article className="page-quality-issue">
      <div className="page-quality-issue-heading">
        <AlertTriangle size={16} aria-hidden="true" />
        <div><h3>{presentation.title}</h3><p>{presentation.detail}</p></div>
        <strong>{props.group.count}</strong>
      </div>
      <div className="page-quality-issue-meta">
        <span>{values.length} {t.qualityAffectedValues}</span>
        <code>{props.group.reasonCode}</code>
        {evidence ? (
          <button type="button" onClick={() => props.onOpenEvidence(evidence, presentation.title)}>
            <FileCode2 size={13} />{t.pageImpactEvidence}
          </button>
        ) : null}
      </div>
      {values.length > 0 ? <div className="page-quality-link-list">{values.slice(0, 10).map((value) => (
        <button key={value.flowId} type="button" onClick={() => props.onOpenFlow(value.flowId)}>
          {value.path ?? value.name}
        </button>
      ))}</div> : null}
    </article>
  );
}

function DocsQuality(props: {
  state: Loadable<DocsCoverageResponse>;
  nodes: DocsCoverageNode[];
  onOpenSymbol: (nodeId: string) => void;
}) {
  const t = useT();
  if (props.state.status === "loading") return <ModuleState loading text={t.qualityDocsLoading} />;
  if (props.state.status === "unavailable") return <ModuleState text={t.qualityDocsUnavailable} />;
  if (props.nodes.length === 0) return <QualityEmpty text={t.qualityDocsEmpty} />;
  const documented = props.nodes.filter((node) => node.documented).length;
  const fresh = props.nodes.filter((node) => node.fresh).length;
  const reviewed = props.nodes.filter((node) => node.reviewed).length;
  const missing = props.nodes.filter((node) => !node.documented);
  const stale = props.nodes.filter((node) => node.documented && (!node.fresh || !node.reviewed || node.issues.length > 0));
  return (
    <div className="page-quality-module">
      <ModuleMetrics items={[
        [`${documented} / ${props.nodes.length}`, t.qualityDocsDocumented],
        [`${fresh} / ${props.nodes.length}`, t.qualityDocsFresh],
        [`${reviewed} / ${props.nodes.length}`, t.qualityDocsReviewed],
      ]} />
      <ProblemList title={t.qualityDocsMissing} nodes={missing} onOpenSymbol={props.onOpenSymbol} />
      <ProblemList title={t.qualityDocsStale} nodes={stale} onOpenSymbol={props.onOpenSymbol} />
      <small className="page-quality-independent">{t.qualityModuleIndependent}</small>
    </div>
  );
}

function ProblemList(props: { title: string; nodes: DocsCoverageNode[]; onOpenSymbol: (id: string) => void }) {
  if (props.nodes.length === 0) return null;
  return (
    <div className="page-quality-problems">
      <h3>{props.title} <span>{props.nodes.length}</span></h3>
      <div className="page-quality-link-list">{props.nodes.slice(0, 12).map((node) => (
        <button key={node.nodeId} type="button" onClick={() => props.onOpenSymbol(node.nodeId)}>
          <span>{node.nodeName}</span><small>{node.nodeType}</small>
        </button>
      ))}</div>
    </div>
  );
}

function E2eQuality(props: { state: Loadable<E2eStatusResponse>; onOpenSymbol: (id: string) => void }) {
  const t = useT();
  if (props.state.status === "loading") return <ModuleState loading text={t.qualityE2eLoading} />;
  if (props.state.status === "unavailable") return <ModuleState text={t.qualityE2eUnavailable} />;
  if (props.state.value.status === "unsupported") {
    return <ModuleState text={`${t.qualityE2eUnsupported}: ${props.state.value.reason}`} />;
  }
  if (props.state.value.status !== "page") return <ModuleState text={t.qualityE2eUnsupported} />;
  const dependencies = props.state.value.dependentPageObjects;
  const missing = dependencies.filter((dependency) => dependency.status === "missing");
  const existing = dependencies.filter((dependency) => dependency.status === "exists");
  if (dependencies.length === 0) return <QualityEmpty text={t.qualityE2eEmpty} />;
  return (
    <div className="page-quality-module">
      <ModuleMetrics items={[
        [`${props.state.value.coverage.existing} / ${props.state.value.coverage.total}`, t.qualityE2eCovered],
        [missing.length, t.qualityE2eMissing],
      ]} />
      <E2eList title={t.qualityE2eMissing} dependencies={missing} onOpenSymbol={props.onOpenSymbol} />
      <E2eList title={t.qualityE2eCovered} dependencies={existing} onOpenSymbol={props.onOpenSymbol} />
      <small className="page-quality-independent">{t.qualityModuleIndependent}</small>
    </div>
  );
}

function E2eList(props: {
  title: string;
  dependencies: Extract<E2eStatusResponse, { status: "page" }>["dependentPageObjects"];
  onOpenSymbol: (id: string) => void;
}) {
  const t = useT();
  if (props.dependencies.length === 0) return null;
  return (
    <div className="page-quality-problems">
      <h3>{props.title} <span>{props.dependencies.length}</span></h3>
      <div className="page-quality-link-list">{props.dependencies.slice(0, 12).map((dependency) => (
        <button key={dependency.nodeId} type="button" onClick={() => props.onOpenSymbol(dependency.nodeId)}>
          <span>{dependency.name}</span>
          <small>{dependency.status === "exists" ? t.qualityE2eStatusExists : t.qualityE2eStatusMissing}</small>
        </button>
      ))}</div>
    </div>
  );
}

function ArtifactQuality(props: { health: ArtifactHealth | null }) {
  const t = useT();
  if (!props.health) return <ModuleState text={t.analysisUnavailable} />;
  return (
    <div className={`page-quality-artifact status-${props.health.status}`}>
      {props.health.status === "fresh" ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
      <div>
        <strong>{artifactStatusLabel(props.health.status, t)}</strong>
        {props.health.generatedAt ? <time>{new Date(props.health.generatedAt).toLocaleString()}</time> : null}
        {props.health.reasons.map((reason) => <p key={`${reason.code}:${reason.artifact ?? ""}`}>{reason.message}</p>)}
      </div>
    </div>
  );
}

function ModuleMetrics(props: { items: ReadonlyArray<readonly [string | number, string]> }) {
  return <div className="page-quality-module-metrics">{props.items.map(([value, label]) => (
    <div key={label}><strong>{value}</strong><span>{label}</span></div>
  ))}</div>;
}

function ModuleState(props: { text: string; loading?: boolean }) {
  return (
    <div className="page-quality-module-state">
      {props.loading ? <LoaderCircle className="spin" size={18} /> : <AlertTriangle size={18} />}
      <span>{props.text}</span>
    </div>
  );
}

function QualityEmpty(props: { text: string; icon?: ReactNode }) {
  return <div className="page-quality-empty">{props.icon}<span>{props.text}</span></div>;
}

function qualityStatusLabel(status: PageQualityStatus, t: T) {
  return {
    complete: t.qualityStatusComplete,
    bounded: t.qualityStatusBounded,
    uncertain: t.qualityStatusUncertain,
    partial: t.qualityStatusPartial,
    limited: t.qualityStatusLimited,
    empty: t.qualityStatusEmpty,
  }[status];
}

function artifactStatusLabel(status: ArtifactHealthStatus, t: T) {
  return {
    fresh: t.qualityArtifactsFresh,
    stale: t.qualityArtifactsStale,
    incompatible: t.qualityArtifactsIncompatible,
  }[status];
}
