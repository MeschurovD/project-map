import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Braces, Component, FileCode2, GitBranch, Layers3 } from "lucide-react";
import type { MergedNodeEnrichment } from "../../../modules/enrichmentTypes.js";
import type { PageSummary } from "../../../flow/buildPageSummary.js";
import type { AnalysisIssueSummary } from "../../../flow/buildAnalysisIssueSummary.js";
import type { FlowEvidence } from "../../../flow/types.js";
import type {
  PageStructure as PageStructureModel,
  PageStructureItem,
} from "../../graph-view/buildPageStructure.js";
import {
  projectPageStructure,
  type PageStructureMode,
} from "../../graph-view/projectPageStructure.js";
import { nodeEnrichmentPresentation } from "../enrichmentPresentation.js";
import { analysisIssuePosition, analysisIssueReason } from "../analysisIssuePresentation.js";
import { useT } from "../i18n.js";

export function PageStructure(props: {
  structure: PageStructureModel;
  summary: PageSummary;
  issues: AnalysisIssueSummary;
  enrichmentByNodeId?: Map<string, MergedNodeEnrichment[]>;
  renderNodeActions?: (nodeId: string) => ReactNode;
  onOpenUnit: (unitId: string) => void;
  onOpenFlow: (flowId: string) => void;
  onOpenEvidence: (evidence: FlowEvidence, title: string) => void;
  onOpenSource: (unitId: string) => void;
}) {
  const t = useT();
  const [mode, setMode] = useState<PageStructureMode>("semantic");
  const [filter, setFilter] = useState<"all" | "values" | "gaps">("all");
  const displayedStructure = useMemo(
    () => projectPageStructure(props.structure, mode),
    [mode, props.structure]
  );
  const allExpandableIds = useMemo(
    () => displayedStructure.root ? collectExpandableIds(displayedStructure.root) : [],
    [displayedStructure.root]
  );
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() =>
    displayedStructure.root ? defaultExpandedIds(displayedStructure.root) : new Set()
  );
  const pageEnrichment = nodeEnrichmentPresentation(
    props.enrichmentByNodeId?.get(props.structure.pageId)
  );

  useEffect(() => {
    setExpandedIds(displayedStructure.root ? defaultExpandedIds(displayedStructure.root) : new Set());
    setFilter("all");
  }, [displayedStructure.root, mode, props.structure.pageId]);

  return (
    <article className="structure-screen">
      <header className="product-screen-header">
        <div className="structure-title-tags">
          {displayedStructure.root?.layer ? (
            <span className="unit-owner-chip">{ownerTag(displayedStructure.root.layer, t)}</span>
          ) : <span className="unit-owner-chip">{t.structureLayerPage}</span>}
          <span className="unit-type-chip">{t.nodeComponent}</span>
          <span>{t.tabStructure}</span>
        </div>
        <h1>{props.structure.pageName}</h1>
        <p>{t.structureSubtitle}</p>
      </header>

      <section className="page-summary" aria-label={t.pageSummaryTitle}>
        <div className="page-summary-heading">
          <div>
            <span>{t.unitFactsLabel}</span>
            <h2>{t.pageSummaryTitle}</h2>
          </div>
          <div className="page-summary-context">
            {props.summary.primaryComponent ? (
              <span>
                {t.pageSummaryEntry}: <strong>{props.summary.primaryComponent.name}</strong>
              </span>
            ) : null}
            {props.summary.keyLogic.length > 0 ? (
              <span className="page-summary-logic">
                {t.pageSummaryLogic}:
                {props.summary.keyLogic.map((logic) => (
                  <button key={logic.id} type="button" onClick={() => props.onOpenUnit(logic.id)}>
                    {logic.name}
                  </button>
                ))}
              </span>
            ) : null}
          </div>
        </div>

        {pageEnrichment.summary ? (
          <div className="page-summary-purpose">
            <small>{t.pageSummaryDocs}</small>
            <p>{pageEnrichment.summary}</p>
          </div>
        ) : null}

        <div className="page-summary-metrics">
          {pageSummaryMetrics(props.summary, t).map((metric) => (
            <div
              key={metric.label}
              className={`page-summary-metric${metric.tone ? ` metric-${metric.tone}` : ""}`}
            >
              <strong>{metric.value}</strong>
              <span>{metric.label}</span>
              {metric.detail ? <small>{metric.detail}</small> : null}
            </div>
          ))}
        </div>
        {props.issues.totalCount > 0 ? (
          <PageAnalysisIssues
            summary={props.issues}
            onOpenFlow={props.onOpenFlow}
            onOpenEvidence={props.onOpenEvidence}
          />
        ) : null}
      </section>

      <div className="structure-mode-switch" aria-label={t.structureModeLabel}>
        <span>{t.structureModeLabel}</span>
        <div>
          {(["semantic", "logic-data", "exact"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={mode === value ? "active" : ""}
              onClick={() => setMode(value)}
            >
              {{
                semantic: t.structureModeSemantic,
                "logic-data": t.structureModeLogicData,
                exact: t.structureModeExact,
              }[value]}
            </button>
          ))}
        </div>
      </div>

      <div className="structure-controls" aria-label={t.structureControls}>
        <div className="structure-filter-group">
          {(["all", "values", "gaps"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={filter === value ? "active" : ""}
              onClick={() => setFilter(value)}
            >
              {{
                all: t.structureFilterAll,
                values: t.structureFilterValues,
                gaps: t.structureFilterGaps,
              }[value]}
            </button>
          ))}
        </div>
        <div className="structure-expand-actions">
          <button type="button" onClick={() => setExpandedIds(new Set(allExpandableIds))}>
            {t.structureExpandAll}
          </button>
          <button type="button" onClick={() => setExpandedIds(new Set())}>
            {t.structureCollapseAll}
          </button>
        </div>
      </div>

      {displayedStructure.warnings.map((warning) => (
        <div key={warning} className="warning-row">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{warning}</span>
        </div>
      ))}

      {displayedStructure.root ? (
        <ol className="structure-tree">
          <StructureRow
            item={displayedStructure.root}
            filter={filter}
            expandedIds={expandedIds}
            onToggle={(id) => setExpandedIds((current) => {
              const next = new Set(current);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })}
            enrichmentByNodeId={props.enrichmentByNodeId}
            renderNodeActions={props.renderNodeActions}
            onOpenUnit={props.onOpenUnit}
            onOpenSource={props.onOpenSource}
          />
        </ol>
      ) : (
        <div className="product-empty">
          <AlertTriangle size={20} aria-hidden="true" />
          <strong>{t.structureEmpty}</strong>
        </div>
      )}
    </article>
  );
}

function StructureRow(props: {
  item: PageStructureItem;
  filter: "all" | "values" | "gaps";
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  enrichmentByNodeId?: Map<string, MergedNodeEnrichment[]>;
  renderNodeActions?: (nodeId: string) => ReactNode;
  onOpenUnit: (unitId: string) => void;
  onOpenSource: (unitId: string) => void;
}) {
  const t = useT();
  const { item } = props;
  const structural = item.kind !== "unit";
  const Icon = item.kind === "fragment"
    ? Layers3
    : item.kind === "element"
      ? Layers3
    : item.kind === "slot" || item.kind === "section"
      ? GitBranch
      : item.type === "hook"
        ? Braces
        : Component;
  const visibleChildren = item.children.filter((child) => branchMatches(child, props.filter));
  const expanded = props.expandedIds.has(item.id);
  const enrichment = nodeEnrichmentPresentation(
    item.unitId ? props.enrichmentByNodeId?.get(item.unitId) : undefined
  );

  return (
    <li className={`structure-item structure-item-${item.kind}`}>
      <div className={`structure-unit-card ${structural ? "structure-group-card" : ""}`}>
        {item.children.length > 0 ? (
          <button
            type="button"
            className="structure-tree-toggle"
            onClick={() => props.onToggle(item.id)}
            aria-label={expanded ? t.structureCollapseBranch : t.structureExpandBranch}
            aria-expanded={expanded}
          >
            {expanded ? "−" : "+"}
          </button>
        ) : <span className="structure-tree-toggle-spacer" />}
        <Icon size={17} aria-hidden="true" />
        <div className="structure-unit-main">
          {structural ? (
            <div className="structure-group-title">
              <span>{structureLabel(item, t)}</span>
              {item.kind === "slot" ? <code>{item.name}</code> : null}
            </div>
          ) : (
            <>
              <div className="structure-unit-tags">
                {item.layer ? <span className="unit-owner-chip">{ownerTag(item.layer, t)}</span> : null}
                <span className="unit-type-chip">{unitTypeTag(item.type, t)}</span>
                {item.relationLabel ? (
                  <span className="unit-relation-chip">{item.relationLabel}</span>
                ) : null}
              </div>
              {item.unitId ? (
                <button
                  type="button"
                  className="structure-unit-name"
                  onClick={() => props.onOpenUnit(item.unitId!)}
                >
                  {item.name}
                </button>
              ) : <strong className="structure-unit-name-static">{item.name}</strong>}
              {item.occurrenceIndex && item.occurrenceCount ? (
                <small className="structure-occurrence-label">
                  {t.structureUsage} {item.occurrenceIndex} / {item.occurrenceCount}
                </small>
              ) : null}
              {item.file ? <small>{item.file}</small> : null}
              {item.logicUnits && item.logicUnits.length > 0 ? (
                <div className="structure-unit-logic">
                  <small>{t.structureLogicCompact}</small>
                  {item.logicUnits.map((logicUnit) => (
                    <button
                      key={logicUnit.id}
                      type="button"
                      onClick={() => props.onOpenUnit(logicUnit.unitId)}
                      aria-label={logicUnit.name}
                    >
                      <span className="unit-type-chip">{t.nodeHook}</span>
                      {logicUnit.name}
                    </button>
                  ))}
                </div>
              ) : null}
              {enrichment.summary ? (
                <p className="structure-unit-summary">{enrichment.summary}</p>
              ) : null}
              {enrichment.badges.length > 0 ? (
                <div className="structure-unit-badges">
                  {enrichment.badges.map((badge, index) => (
                    <span
                      key={`${badge.id}:${index}`}
                      className={`enrichment-badge enrichment-badge-${badge.tone ?? "info"}`}
                    >
                      {badge.label}
                    </span>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>
        {!structural && item.valuesCount > 0 ? (
          <div className="structure-unit-metrics" aria-label={t.structureValues}>
            <span className="metric-traced">
              {item.sourceResolvedCount} / {item.valuesCount} {t.tracedLabel}
            </span>
            {item.originGapCount > 0 ? (
              <span className="metric-issues">
                {item.originGapCount} {t.traceGapsLabel}
              </span>
            ) : null}
          </div>
        ) : null}
        {item.unitId ? (
          <div className="structure-unit-actions">
            {props.renderNodeActions?.(item.unitId)}
            {item.file ? (
              <button
                type="button"
                className="icon-action"
                onClick={() => props.onOpenSource(item.unitId!)}
                title={t.btnViewSource}
                aria-label={`${t.btnViewSource}: ${item.name}`}
              >
                <FileCode2 size={15} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {expanded && visibleChildren.length > 0 ? (
        <ol>
          {visibleChildren.map((child) => (
            <StructureRow
              key={child.id}
              item={child}
              filter={props.filter}
              expandedIds={props.expandedIds}
              onToggle={props.onToggle}
              enrichmentByNodeId={props.enrichmentByNodeId}
              renderNodeActions={props.renderNodeActions}
              onOpenUnit={props.onOpenUnit}
              onOpenSource={props.onOpenSource}
            />
          ))}
        </ol>
      ) : null}
    </li>
  );
}

function branchMatches(item: PageStructureItem, filter: "all" | "values" | "gaps"): boolean {
  if (filter === "all") return true;
  if (filter === "values" && item.valuesCount > 0) return true;
  if (filter === "gaps" && item.originGapCount > 0) return true;
  return item.children.some((child) => branchMatches(child, filter));
}

function collectExpandableIds(root: PageStructureItem): string[] {
  return [root, ...root.children.flatMap(collectAllItems)]
    .filter((item) => item.children.length > 0)
    .map((item) => item.id);
}

function collectAllItems(item: PageStructureItem): PageStructureItem[] {
  return [item, ...item.children.flatMap(collectAllItems)];
}

function defaultExpandedIds(root: PageStructureItem): Set<string> {
  const ids = new Set<string>();
  const visit = (item: PageStructureItem) => {
    const structural = item.kind !== "unit";
    const exposesSlot = item.children.some((child) => child.kind === "slot" || child.relationLabel);
    const exposesLogic = item.children.some((child) =>
      (child.kind === "section" && child.name === "Logic") || child.type === "hook"
    ) || Boolean(item.logicUnits?.length);
    if (
      item.children.length > 0 &&
      (item.id === root.id || structural || exposesSlot || exposesLogic)
    ) {
      ids.add(item.id);
    }
    for (const child of item.children) visit(child);
  };
  visit(root);
  return ids;
}

function ownerTag(layer: string, t: ReturnType<typeof useT>) {
  return ({
    pages: t.structureLayerPage,
    widgets: t.structureLayerWidget,
    features: t.structureLayerFeature,
    entities: t.structureLayerEntity,
    shared: t.structureLayerShared,
  } as Record<string, string>)[layer] ?? layer.toUpperCase();
}

function unitTypeTag(type: string, t: ReturnType<typeof useT>) {
  return ({
    component: t.nodeComponent,
    hook: t.nodeHook,
    selector: t.nodeSelector,
    action: t.nodeAction,
    thunk: t.nodeThunk,
    api: t.nodeApi,
    "slice-model": t.nodeSliceModel,
    widget: t.nodeWidget,
    feature: t.nodeFeature,
    entity: t.nodeEntity,
  } as Record<string, string>)[type] ?? t.nodeUnknown;
}

function structureLabel(item: PageStructureItem, t: ReturnType<typeof useT>) {
  if (item.kind === "fragment") return t.structureFragment;
  if (item.kind === "element") return item.name;
  if (item.kind === "slot") return t.structurePropSlot;
  if (item.name.startsWith("Return")) {
    return item.name === "Return"
      ? t.structureReturn
      : item.name.replace("Return", t.structureReturn);
  }
  return t.structureLogic;
}

function pageSummaryMetrics(summary: PageSummary, t: ReturnType<typeof useT>) {
  const dataSources = [...summary.data.stateFields, ...summary.data.apis];
  return [
    {
      value: summary.composition.domainBlocks.length,
      label: t.pageSummaryDomainBlocks,
      detail: referenceNames(summary.composition.domainBlocks),
    },
    {
      value: dataSources.length,
      label: t.pageSummaryDataSources,
      detail: referenceNames(dataSources),
    },
    ...(summary.behavior.operations.length > 0 ? [{
      value: summary.behavior.operations.length,
      label: t.pageSummaryOperations,
      detail: referenceNames(summary.behavior.operations),
    }] : []),
    ...(summary.behavior.uiEffects.length > 0 ? [{
      value: summary.behavior.uiEffects.length,
      label: t.pageSummaryUiEffects,
      detail: referenceNames(summary.behavior.uiEffects),
    }] : []),
    {
      value: `${summary.quality.originResolvedCount} / ${summary.quality.valuesCount}`,
      label: t.pageSummaryOriginCoverage,
      detail: `${summary.quality.originCoveragePct}%`,
      tone: summary.quality.originResolvedCount === summary.quality.valuesCount ? "ok" : "warn",
    },
    ...(summary.quality.issueCount > 0 ? [{
      value: summary.quality.issueCount,
      label: t.pageSummaryIssues,
      detail: summary.quality.issueReasonCounts
        .map((reason) => `${analysisIssueReason(reason.reasonCode, t).title} · ${reason.count}`)
        .join(", "),
      tone: "issues",
    }] : []),
  ];
}

function PageAnalysisIssues(props: {
  summary: AnalysisIssueSummary;
  onOpenFlow: (flowId: string) => void;
  onOpenEvidence: (evidence: FlowEvidence, title: string) => void;
}) {
  const t = useT();
  return (
    <details className="page-analysis-issues">
      <summary>
        <span>
          <AlertTriangle size={15} aria-hidden="true" />
          <strong>{t.pageIssuesTitle}</strong>
        </span>
        <span>{props.summary.totalCount}</span>
      </summary>
      <p>{t.pageIssuesSubtitle}</p>
      <div className="page-analysis-issue-list">
        {props.summary.groups.map((group) => {
          const presentation = analysisIssueReason(group.reasonCode, t);
          const values = [...new Map(group.issues.flatMap((issue) => issue.affectedValues)
            .map((value) => [value.flowId, value])).values()];
          const owners = [...new Map(group.issues.flatMap((issue) => issue.affectedOwners)
            .map((owner) => [owner.id, owner])).values()];
          const evidence = group.issues.flatMap((issue) => issue.evidence)[0];
          return (
            <article key={group.reasonCode} className="page-analysis-issue-group">
              <div className="page-analysis-issue-heading">
                <div>
                  <strong>{presentation.title}</strong>
                  <code>{t.pageIssuesReasonCode}: {group.reasonCode}</code>
                </div>
                <span>{group.count} · {analysisIssuePosition(group.position, t)}</span>
              </div>
              <p>{presentation.detail}</p>
              {values.length > 0 ? (
                <div className="page-analysis-issue-values">
                  <small>{t.pageIssuesAffectedValues}</small>
                  <div>
                    {values.map((value) => (
                      <button key={value.flowId} type="button" onClick={() => props.onOpenFlow(value.flowId)}>
                        {value.path ?? value.name}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {owners.length > 0 ? (
                <div className="page-analysis-issue-owners">
                  <small>{t.pageIssuesAffectedOwners}</small>
                  <span>{owners.map((owner) => owner.name).join(", ")}</span>
                </div>
              ) : null}
              {evidence ? (
                <button
                  type="button"
                  className="journey-evidence-link"
                  onClick={() => props.onOpenEvidence(evidence, presentation.title)}
                >
                  <FileCode2 size={13} aria-hidden="true" /> {t.pageIssuesOpenEvidence}
                </button>
              ) : null}
            </article>
          );
        })}
      </div>
    </details>
  );
}

function referenceNames(references: PageSummary["keyLogic"]) {
  if (references.length === 0) return undefined;
  const shown = references.slice(0, 3).map((reference) => reference.name);
  return references.length > shown.length
    ? `${shown.join(", ")} +${references.length - shown.length}`
    : shown.join(", ");
}
