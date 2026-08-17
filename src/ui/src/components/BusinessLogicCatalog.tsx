import { useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BookOpenCheck,
  Braces,
  CheckCircle2,
  CircleDot,
  FileCode2,
  Search,
  ShieldAlert,
  Waypoints,
} from "lucide-react";
import type { FlowEvidence } from "../../../flow/types.js";
import type {
  BusinessLogicAssociation,
  BusinessLogicCategory,
  BusinessLogicEntry,
  BusinessLogicFilters,
  BusinessLogicIndex,
  BusinessLogicTarget,
} from "../../graph-view/buildBusinessLogicIndex.js";
import { filterBusinessLogicEntries } from "../../graph-view/buildBusinessLogicIndex.js";
import { useT, type T } from "../i18n.js";
import { EnrichmentMarkdown } from "./details/EnrichmentMarkdown.js";

export function BusinessLogicCatalog(props: {
  index: BusinessLogicIndex;
  selectedKey?: string;
  onSelect: (key: string) => void;
  onOpenTarget: (target: BusinessLogicTarget) => void;
  onOpenPage: (pageId: string) => void;
  onOpenEvidence: (evidence: FlowEvidence, title: string) => void;
  renderOwnerActions?: (entry: BusinessLogicEntry) => ReactNode;
}) {
  const t = useT();
  const [filters, setFilters] = useState<BusinessLogicFilters>({
    category: "all",
    quality: "all",
    association: "all",
    pageId: "all",
  });
  const entries = useMemo(
    () => filterBusinessLogicEntries(props.index.entries, filters),
    [filters, props.index.entries]
  );
  const selected = entries.find((entry) => entry.key === props.selectedKey) ?? entries[0];
  const needsReview = props.index.stats.totalCount - props.index.stats.reviewedCount;

  return (
    <article className="business-catalog" data-business-catalog>
      <header className="product-screen-header business-catalog-header">
        <span>{t.businessCatalogKicker}</span>
        <h1>{t.businessCatalogTitle}</h1>
        <p>{t.businessCatalogSubtitle}</p>
      </header>

      <div className="business-catalog-metrics">
        <Metric value={props.index.stats.ruleCount} label={t.businessCatalogMetricRules} icon={<ShieldAlert size={17} />} onClick={() => setFilters((current) => ({ ...current, category: "rule" }))} />
        <Metric value={props.index.stats.scenarioCount} label={t.businessCatalogMetricScenarios} icon={<Waypoints size={17} />} onClick={() => setFilters((current) => ({ ...current, category: "scenario" }))} />
        <Metric value={needsReview} label={t.businessCatalogMetricNeedsReview} icon={<BookOpenCheck size={17} />} tone={needsReview > 0 ? "warn" : "ok"} onClick={() => setFilters((current) => ({ ...current, quality: "unreviewed" }))} />
        <Metric value={props.index.stats.staleCount} label={t.businessCatalogMetricStale} icon={<AlertTriangle size={17} />} tone={props.index.stats.staleCount > 0 ? "warn" : "ok"} onClick={() => setFilters((current) => ({ ...current, quality: "stale" }))} />
        <Metric value={props.index.stats.undocumentedValueCount} label={t.businessCatalogMetricUndocumented} icon={<Braces size={17} />} />
        <Metric value={props.index.stats.pagesWithoutBusinessContextCount} label={t.businessCatalogMetricEmptyPages} icon={<CircleDot size={17} />} />
        <Metric value={props.index.stats.duplicateCount} label={t.businessCatalogMetricDuplicates} icon={<Braces size={17} />} tone={props.index.stats.duplicateCount > 0 ? "warn" : "ok"} onClick={() => setFilters((current) => ({ ...current, quality: "duplicate" }))} />
      </div>

      <div className="business-catalog-filters">
        <label className="business-catalog-search">
          <Search size={16} aria-hidden="true" />
          <input
            value={filters.query ?? ""}
            onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
            placeholder={t.businessCatalogSearch}
          />
        </label>
        <FilterSelect
          label={t.businessCatalogAllKinds}
          value={filters.category ?? "all"}
          onChange={(value) => setFilters((current) => ({ ...current, category: value as BusinessLogicCategory | "all" }))}
          options={[
            ["all", t.businessCatalogAllKinds],
            ["rule", t.businessCatalogRules],
            ["scenario", t.businessCatalogScenarios],
            ["caution", t.businessCatalogCautions],
            ["contract", t.businessCatalogContracts],
          ]}
        />
        <FilterSelect
          label={t.businessCatalogAllQuality}
          value={filters.quality ?? "all"}
          onChange={(value) => setFilters((current) => ({ ...current, quality: value as BusinessLogicFilters["quality"] }))}
          options={[
            ["all", t.businessCatalogAllQuality],
            ["reviewed", t.businessCatalogReviewed],
            ["unreviewed", t.businessCatalogUnreviewed],
            ["stale", t.businessCatalogStale],
            ["unlinked", t.businessCatalogUnlinked],
            ["duplicate", t.businessCatalogDuplicate],
          ]}
        />
        <FilterSelect
          label={t.businessCatalogAllRelations}
          value={filters.association ?? "all"}
          onChange={(value) => setFilters((current) => ({ ...current, association: value as BusinessLogicAssociation | "all" }))}
          options={[
            ["all", t.businessCatalogAllRelations],
            ["direct", t.businessCatalogDirect],
            ["inherited", t.businessCatalogInherited],
            ["related", t.businessCatalogRelated],
          ]}
        />
        <FilterSelect
          label={t.businessCatalogAllPages}
          value={filters.pageId ?? "all"}
          onChange={(value) => setFilters((current) => ({ ...current, pageId: value }))}
          options={[["all", t.businessCatalogAllPages], ...props.index.pages.map((page) => [page.id, `${page.label} · ${page.count}`] as [string, string])]}
        />
      </div>

      <CoverageGaps index={props.index} onOpenTarget={props.onOpenTarget} onOpenPage={props.onOpenPage} t={t} />

      <div className="business-catalog-result-count"><strong>{entries.length}</strong> {t.businessCatalogResults}</div>
      {entries.length === 0 ? (
        <div className="business-catalog-empty"><Search size={22} /><p>{t.businessCatalogEmpty}</p></div>
      ) : (
        <div className="business-catalog-workspace">
          <div className="business-catalog-list" role="list">
            {entries.map((entry) => (
              <CatalogRow
                key={entry.key}
                entry={entry}
                selected={entry.key === selected?.key}
                onClick={() => props.onSelect(entry.key)}
                t={t}
              />
            ))}
          </div>
          {selected ? (
            <BusinessLogicDetails
              entry={selected}
              onOpenTarget={props.onOpenTarget}
              onOpenPage={props.onOpenPage}
              onOpenEvidence={props.onOpenEvidence}
              ownerActions={props.renderOwnerActions?.(selected)}
              t={t}
            />
          ) : <div className="business-catalog-empty"><p>{t.businessCatalogSelect}</p></div>}
        </div>
      )}
    </article>
  );
}

function Metric(props: {
  value: number;
  label: string;
  icon: ReactNode;
  tone?: "warn" | "ok";
  onClick?: () => void;
}) {
  const content = <>{props.icon}<strong>{props.value}</strong><span>{props.label}</span></>;
  return props.onClick ? (
    <button type="button" className={`business-catalog-metric tone-${props.tone ?? "neutral"}`} onClick={props.onClick}>{content}</button>
  ) : (
    <div className={`business-catalog-metric tone-${props.tone ?? "neutral"}`}>{content}</div>
  );
}

function FilterSelect(props: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="business-catalog-select">
      <span>{props.label}</span>
      <select aria-label={props.label} value={props.value} onChange={(event) => props.onChange(event.target.value)}>
        {props.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>
  );
}

function CatalogRow(props: { entry: BusinessLogicEntry; selected: boolean; onClick: () => void; t: T }) {
  return (
    <button
      type="button"
      role="listitem"
      className={props.selected ? "business-catalog-row active" : "business-catalog-row"}
      onClick={props.onClick}
    >
      <div className="business-catalog-row-heading">
        <span className={`business-kind kind-${props.entry.category}`}>{kindLabel(props.entry.category, props.t)}</span>
        {props.entry.annotation.stale ? <span className="business-quality warning">{props.t.businessCatalogStale}</span> : null}
        {props.entry.annotation.review === "reviewed" ? <CheckCircle2 size={14} aria-label={props.t.businessCatalogReviewed} /> : null}
      </div>
      <p>{plainText(props.entry.annotation.markdown)}</p>
      <div className="business-catalog-row-meta">
        <span>{props.entry.owner?.name ?? props.entry.annotation.ownerNodeId}</span>
        {props.entry.pageLabels.slice(0, 2).map((page) => <span key={page}>{page}</span>)}
        <b>{props.entry.targets.length}</b>
      </div>
    </button>
  );
}

function BusinessLogicDetails(props: {
  entry: BusinessLogicEntry;
  onOpenTarget: (target: BusinessLogicTarget) => void;
  onOpenPage: (pageId: string) => void;
  onOpenEvidence: (evidence: FlowEvidence, title: string) => void;
  ownerActions?: ReactNode;
  t: T;
}) {
  const groups = (["direct", "inherited", "related"] as const)
    .map((association) => ({ association, targets: props.entry.targets.filter((target) => target.association === association) }))
    .filter((group) => group.targets.length > 0);
  return (
    <section className="business-rule-details" data-business-rule={props.entry.key}>
      <header>
        <div className="business-rule-heading-actions">
          <span className={`business-kind kind-${props.entry.category}`}>{kindLabel(props.entry.category, props.t)}</span>
          {props.ownerActions ? <div title={props.t.businessCatalogOpenDocs}>{props.ownerActions}</div> : null}
        </div>
        <h2>{plainText(props.entry.annotation.markdown)}</h2>
      </header>
      <div className="business-rule-markdown"><EnrichmentMarkdown markdown={props.entry.annotation.markdown} /></div>

      <dl className="business-rule-facts">
        <div><dt>{props.t.businessCatalogOwner}</dt><dd>{props.entry.owner?.name ?? props.entry.annotation.ownerNodeId}</dd></div>
        <div><dt>{props.t.businessCatalogPages}</dt><dd>{props.entry.pageIds.length > 0 ? props.entry.pageIds.map((pageId, index) => (
          <button key={pageId} type="button" onClick={() => props.onOpenPage(pageId)}>{props.entry.pageLabels[index] ?? pageId}</button>
        )) : "—"}</dd></div>
        <div><dt>{props.t.businessCatalogQuality}</dt><dd><QualityBadges entry={props.entry} t={props.t} /></dd></div>
      </dl>

      <div className="business-implementation">
        <h3>{props.t.businessCatalogImplementation}</h3>
        {groups.length === 0 ? <p className="business-no-targets">{props.t.businessCatalogNoTargets}</p> : groups.map((group) => (
          <section key={group.association} className={`business-target-group association-${group.association}`}>
            <h4>{associationLabel(group.association, props.t)} <span>{group.targets.length}</span></h4>
            <div>{group.targets.map((target) => (
              <TargetCard
                key={`${target.association}:${target.target.type}:${target.target.id}`}
                target={target}
                onOpen={() => props.onOpenTarget(target)}
                onOpenEvidence={props.onOpenEvidence}
                t={props.t}
              />
            ))}</div>
          </section>
        ))}
      </div>
    </section>
  );
}

function CoverageGaps(props: {
  index: BusinessLogicIndex;
  onOpenTarget: (target: BusinessLogicTarget) => void;
  onOpenPage: (pageId: string) => void;
  t: T;
}) {
  const total = props.index.undocumentedValues.length + props.index.pagesWithoutBusinessContext.length;
  if (total === 0) return null;
  return (
    <details className="business-coverage-gaps">
      <summary>
        <AlertTriangle size={16} />
        <span><strong>{props.t.businessCatalogCoverageGaps}</strong><small>{props.t.businessCatalogCoverageHint}</small></span>
        <b>{total}</b>
      </summary>
      <div className="business-gap-groups">
        {props.index.undocumentedValues.length > 0 ? <section>
          <h3>{props.t.businessCatalogUndocumentedValues} <span>{props.index.undocumentedValues.length}</span></h3>
          <div>{props.index.undocumentedValues.slice(0, 12).map((target) => (
            <button key={target.target.id} type="button" onClick={() => props.onOpenTarget(target)}>
              <Braces size={13} /> {target.label}<ArrowRight size={12} />
            </button>
          ))}</div>
          {props.index.undocumentedValues.length > 12 ? <small>+{props.index.undocumentedValues.length - 12} {props.t.businessCatalogMoreGaps}</small> : null}
        </section> : null}
        {props.index.pagesWithoutBusinessContext.length > 0 ? <section>
          <h3>{props.t.businessCatalogPagesWithoutContext} <span>{props.index.pagesWithoutBusinessContext.length}</span></h3>
          <div>{props.index.pagesWithoutBusinessContext.map((page) => (
            <button key={page.id} type="button" onClick={() => props.onOpenPage(page.id)}>
              <CircleDot size={13} /> {page.label}<ArrowRight size={12} />
            </button>
          ))}</div>
        </section> : null}
      </div>
    </details>
  );
}

function TargetCard(props: {
  target: BusinessLogicTarget;
  onOpen: () => void;
  onOpenEvidence: (evidence: FlowEvidence, title: string) => void;
  t: T;
}) {
  const navigable = props.target.target.type !== "occurrence";
  return (
    <article className="business-target-card">
      <div className="business-target-heading">
        <span>{props.target.target.type}</span>
        <strong>{props.target.label}</strong>
        {navigable ? <button type="button" aria-label={`${props.target.label} →`} onClick={props.onOpen}><ArrowRight size={15} /></button> : null}
      </div>
      {props.target.ownerLabel && props.target.ownerLabel !== props.target.label ? <p>{props.target.ownerLabel}</p> : null}
      <div className="business-target-meta">
        {props.target.relations.length > 0 ? <span>{props.t.businessCatalogVia}: <code>{props.target.relations.join(" → ")}</code></span> : null}
        {props.target.confidence ? <span>{props.t.businessCatalogConfidence}: {props.target.confidence}</span> : null}
        {props.target.evidence[0] ? (
          <button type="button" onClick={() => props.onOpenEvidence(props.target.evidence[0]!, props.target.label)}>
            <FileCode2 size={13} /> {props.t.businessCatalogSource}
          </button>
        ) : null}
      </div>
    </article>
  );
}

function QualityBadges(props: { entry: BusinessLogicEntry; t: T }) {
  if (props.entry.diagnostics.length === 0) return <span className="business-quality ok"><CheckCircle2 size={13} />{props.t.businessCatalogReviewed}</span>;
  return <>{props.entry.diagnostics.map((diagnostic) => <span key={diagnostic} className="business-quality warning">{diagnosticLabel(diagnostic, props.t)}</span>)}</>;
}

function kindLabel(category: BusinessLogicCategory, t: T) {
  if (category === "rule") return t.businessCatalogRules;
  if (category === "scenario") return t.businessCatalogScenarios;
  if (category === "caution") return t.businessCatalogCautions;
  return t.businessCatalogContracts;
}

function associationLabel(association: BusinessLogicAssociation, t: T) {
  if (association === "direct") return t.businessCatalogDirect;
  if (association === "inherited") return t.businessCatalogInherited;
  return t.businessCatalogRelated;
}

function diagnosticLabel(diagnostic: BusinessLogicEntry["diagnostics"][number], t: T) {
  if (diagnostic === "unreviewed") return t.businessCatalogUnreviewed;
  if (diagnostic === "stale") return t.businessCatalogStale;
  if (diagnostic === "unlinked") return t.businessCatalogUnlinked;
  if (diagnostic === "duplicate") return t.businessCatalogDuplicate;
  return t.businessCatalogLowConfidence;
}

function plainText(markdown: string) {
  return markdown.replace(/[`*_#[\]()]/g, " ").replace(/\s+/g, " ").trim();
}
