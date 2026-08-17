import type { ReactNode } from "react";
import { AlertTriangle, FileCode2, Scale, Waypoints } from "lucide-react";
import type { ProjectMapGraph, ProjectMapNode } from "../../../../graph/types.js";
import type { SourceLocation } from "../../../../analyzers/value-flow/types.js";
import type {
  EnrichmentBadge,
  EnrichmentTarget,
  MergedNodeEnrichment,
} from "../../../../modules/enrichmentTypes.js";
import type { FlowQueries } from "../../../../flow/queries.js";
import { buildPageDossier, type DossierGroup, type DossierItem } from "../../../graph-view/buildPageDossier.js";
import { useT, type T } from "../../i18n.js";
import { EnrichmentMarkdown } from "./EnrichmentMarkdown.js";
import type {
  PageBusinessContext,
  PageBusinessContextEntry,
} from "../../../graph-view/buildPageBusinessContext.js";

// Full-document page README over canonical PageOverview queries, with evidence
// and source navigation. Docs summaries are overlaid from enrichment.
export function PageDossier(props: {
  graph: ProjectMapGraph;
  page: ProjectMapNode;
  flowQueries?: FlowQueries;
  enrichmentByNodeId: Map<string, MergedNodeEnrichment[]>;
  nodeActions?: ReactNode;
  businessContext?: PageBusinessContext;
  onOpenBusinessTarget?: (target: EnrichmentTarget) => void;
  onSelectNode: (node: ProjectMapNode) => void;
  onOpenNodeSource: (node: ProjectMapNode) => void;
  onOpenEvidence: (evidence: SourceLocation, title: string) => void;
  onTraceTag?: (tag: string) => void;
}) {
  const t = useT();
  const dossier = buildPageDossier(props.graph, props.page.id, props.flowQueries);
  if (!dossier) return null;

  const entriesFor = (nodeId: string) => props.enrichmentByNodeId.get(nodeId) ?? [];
  const summaryFor = (nodeId: string) => entriesFor(nodeId).find((entry) => entry.summary)?.summary;
  const badgesFor = (nodeId: string) => entriesFor(nodeId).flatMap((entry) => entry.badges ?? []);
  // Page-level docs sections ("Business rules", "Scenarios", …) minus Summary,
  // which is already shown as the page summary above.
  const pageSections = entriesFor(dossier.page.id)
    .flatMap((entry) => entry.sections ?? [])
    .filter((section) => section.title.toLowerCase() !== "summary");

  return (
    <article className="page-dossier">
      <header className="dossier-header">
        <span className="dossier-kicker">{t.dossierKicker}</span>
        <h1>{dossier.page.name}</h1>
        <div className="dossier-header-actions">
          {props.nodeActions}
          {dossier.page.file ? (
            <button type="button" className="dossier-source" onClick={() => props.onOpenNodeSource(props.page)}>
              <FileCode2 size={13} aria-hidden="true" /> {dossier.page.file}
            </button>
          ) : null}
        </div>
        <BadgeRow badges={badgesFor(dossier.page.id)} />
        {summaryFor(dossier.page.id) ? <p className="dossier-summary">{summaryFor(dossier.page.id)}</p> : null}
      </header>

      {pageSections.length > 0 ? (
        <section className="dossier-section dossier-docs">
          <h2>{t.secModuleDocs}</h2>
          {pageSections.map((section) => (
            <div key={section.id} className="dossier-doc-section">
              <h3>{section.title}</h3>
              <EnrichmentMarkdown markdown={section.markdown} onTagClick={props.onTraceTag} />
            </div>
          ))}
        </section>
      ) : null}

      {props.businessContext && props.businessContext.totalCount > 0 ? (
        <BusinessContext
          context={props.businessContext}
          onOpenTarget={props.onOpenBusinessTarget}
          t={t}
        />
      ) : null}

      <Section title={t.secComposition} groups={dossier.composition} {...props} summaryFor={summaryFor} badgesFor={badgesFor} t={t} />
      <Section title={t.secStateDeps} groups={dossier.state} {...props} summaryFor={summaryFor} badgesFor={badgesFor} t={t} />

      {dossier.composition.length === 0 && dossier.state.length === 0 ? (
        <p className="muted-row">{t.dossierEmpty}</p>
      ) : null}
    </article>
  );
}

function BusinessContext(props: {
  context: PageBusinessContext;
  onOpenTarget?: (target: EnrichmentTarget) => void;
  t: T;
}) {
  return (
    <section className="dossier-section dossier-business-context" data-page-business-context>
      <div className="dossier-business-heading">
        <div>
          <span>{props.t.businessContextKicker}</span>
          <h2>{props.t.businessContextTitle}</h2>
        </div>
        <strong>{props.context.totalCount}</strong>
      </div>
      <BusinessGroup title={props.t.businessRulesTitle} icon={<Scale size={15} aria-hidden="true" />} entries={props.context.rules} onOpenTarget={props.onOpenTarget} />
      <BusinessGroup title={props.t.businessScenariosTitle} icon={<Waypoints size={15} aria-hidden="true" />} entries={props.context.scenarios} onOpenTarget={props.onOpenTarget} />
      <BusinessGroup title={props.t.businessCautionsTitle} icon={<AlertTriangle size={15} aria-hidden="true" />} entries={props.context.cautions} onOpenTarget={props.onOpenTarget} />
    </section>
  );
}

function BusinessGroup(props: {
  title: string;
  icon: ReactNode;
  entries: PageBusinessContextEntry[];
  onOpenTarget?: (target: EnrichmentTarget) => void;
}) {
  if (props.entries.length === 0) return null;
  return (
    <div className="dossier-business-group">
      <h3>{props.icon}{props.title}</h3>
      <div>
        {props.entries.map((entry) => (
          <article key={`${entry.annotation.moduleId}:${entry.annotation.id}`}>
            <EnrichmentMarkdown markdown={entry.annotation.markdown} />
            <div className="dossier-business-meta">
              {entry.annotation.review ? (
                <span className={`enrichment-badge enrichment-badge-${entry.annotation.review === "reviewed" ? "ok" : "info"}`}>
                  {entry.annotation.review}
                </span>
              ) : null}
              {entry.annotation.stale ? <span className="enrichment-badge enrichment-badge-warn">stale</span> : null}
              {entry.targets.slice(0, 4).map(({ target, label }) => props.onOpenTarget ? (
                <button key={`${target.type}:${target.id}`} type="button" onClick={() => props.onOpenTarget?.(target)}>
                  {label}
                </button>
              ) : (
                <span key={`${target.type}:${target.id}`}>{label}</span>
              ))}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function Section(props: {
  title: string;
  groups: DossierGroup[];
  graph: ProjectMapGraph;
  summaryFor: (nodeId: string) => string | undefined;
  badgesFor: (nodeId: string) => EnrichmentBadge[];
  onSelectNode: (node: ProjectMapNode) => void;
  onOpenNodeSource: (node: ProjectMapNode) => void;
  onOpenEvidence: (evidence: SourceLocation, title: string) => void;
  t: T;
}) {
  if (props.groups.length === 0) return null;

  return (
    <section className="dossier-section">
      <h2>{props.title}</h2>
      {props.groups.map((group) => (
        <div key={group.key} className="dossier-group">
          <h3>{groupTitle(group.key, props.t)}</h3>
          <ul>
            {group.items.map((item) => (
              <DossierRow key={item.nodeId} item={item} {...props} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function DossierRow(props: {
  item: DossierItem;
  graph: ProjectMapGraph;
  summaryFor: (nodeId: string) => string | undefined;
  badgesFor: (nodeId: string) => EnrichmentBadge[];
  onSelectNode: (node: ProjectMapNode) => void;
  onOpenNodeSource: (node: ProjectMapNode) => void;
  onOpenEvidence: (evidence: SourceLocation, title: string) => void;
  t: T;
}) {
  const { item, t } = props;
  const node = props.graph.nodes.find((entry) => entry.id === item.nodeId);
  const summary = props.summaryFor(item.nodeId);

  return (
    <li className="dossier-item">
      <div className="dossier-item-head">
        <button type="button" className="dossier-item-name" onClick={() => node && props.onSelectNode(node)}>
          {item.name}
        </button>
        {item.relation ? <span className="dossier-rel">{relationLabel(item.relation, t)}</span> : null}
        <BadgeRow badges={props.badgesFor(item.nodeId)} />
        {item.file && node ? (
          <button type="button" className="dossier-source" onClick={() => props.onOpenNodeSource(node)}>
            <FileCode2 size={12} aria-hidden="true" /> {t.btnViewSource}
          </button>
        ) : null}
      </div>
      {summary ? <p className="dossier-item-summary">{summary}</p> : null}
      {item.evidence?.code ? (
        <button
          type="button"
          className="dossier-evidence"
          onClick={() => props.onOpenEvidence({ file: item.evidence?.file, line: item.evidence?.line }, item.name)}
          title={item.evidence.file ? `${item.evidence.file}:${item.evidence.line ?? ""}` : undefined}
        >
          <code>{item.evidence.code}</code>
        </button>
      ) : null}
    </li>
  );
}

function BadgeRow(props: { badges: EnrichmentBadge[] }) {
  if (props.badges.length === 0) return null;
  return (
    <span className="dossier-badges">
      {props.badges.map((badge) => (
        <span key={badge.id} className={`enrichment-badge enrichment-badge-${badge.tone ?? "info"}`}>
          {badge.label}
        </span>
      ))}
    </span>
  );
}

function groupTitle(key: string, t: T) {
  const map: Record<string, string> = {
    widgets: t.listWidgets,
    features: t.listFeatures,
    entities: t.listEntities,
    shared: t.listShared,
    selectors: t.listSelectors,
    slices: t.listSlices,
    actions: t.listActions,
    api: t.listApiCalls,
  };
  return map[key] ?? key;
}

function relationLabel(relation: string, t: T) {
  const map: Record<string, string> = {
    renders: t.relRenders,
    usesHook: t.relUsesHook,
    usesSelector: t.relUsesSelector,
    readsSlice: t.relReadsSlice,
    dispatchesAction: t.relDispatches,
    callsApi: t.relCallsApi,
    dependsOn: t.relDependsOn,
  };
  return map[relation] ?? relation;
}
