import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, FileCode2, Info, Zap } from "lucide-react";
import type { MergedNodeEnrichment } from "../../../modules/enrichmentTypes.js";
import type {
  SymbolContract,
  SymbolContractStep,
  SymbolContractValue,
  SymbolContractValueGroup,
} from "../../../flow/queries.js";
import type { OriginStatus } from "../../../flow/types.js";
import type { SymbolOverview } from "../../../flow/buildSymbolOverview.js";
import { nodeEnrichmentPresentation } from "../enrichmentPresentation.js";
import { analysisIssueReason } from "../analysisIssuePresentation.js";
import { useT, type T } from "../i18n.js";
import { SymbolOverviewScreen } from "./SymbolOverviewScreen.js";
import { SymbolConsumersScreen } from "./SymbolConsumersScreen.js";
import type { SymbolPipelineNode } from "../symbolPresentation.js";

export function UnitScreen(props: {
  contract: SymbolContract;
  overview: SymbolOverview;
  enrichment?: MergedNodeEnrichment[];
  nodeActions?: ReactNode;
  renderValueDetails?: (row: SymbolContractValue, displayMode?: "overview" | "default") => ReactNode;
  renderValueActions?: (row: SymbolContractValue) => ReactNode;
  hasValueDetails?: (row: SymbolContractValue) => boolean;
  onOpenFlow: (flowId: string) => void;
  onOpenTransformationCode: (value: SymbolOverview["values"][number]) => void | Promise<void>;
  onOpenPipelineNodeCode: (node: SymbolPipelineNode) => void | Promise<void>;
  onOpenSource: () => void;
}) {
  const t = useT();
  const [activeTab, setActiveTab] = useState<"overview" | "contract" | "consumers">("overview");
  const rowCount = props.contract.groups.reduce((count, group) => count + group.values.length, 0);
  const contractValuesById = new Map(
    props.contract.groups.flatMap((group) => group.values).map((row) => [row.id, row])
  );
  const enrichment = nodeEnrichmentPresentation(props.enrichment);

  useEffect(() => setActiveTab("overview"), [props.contract.symbol.id]);

  return (
    <article className="unit-screen">
      <header className="product-screen-header unit-screen-header">
        <span>{t.unitContractKicker} · {symbolTypeLabel(props.contract.symbol.type, t)}</span>
        <h1>{props.contract.symbol.name}</h1>
        <p>{[
          props.contract.symbol.layer,
          props.contract.symbol.slice,
          props.contract.symbol.file,
        ].filter(Boolean).join(" · ")}</p>
        {props.contract.usedBy.length > 0 ? (
          <div className="unit-used-by">
            <small>{t.unitUsedBy}</small>
            <div>
              {props.contract.usedBy.map((reference) => (
                <span key={`${reference.id}:${reference.relation}`}>{reference.name}</span>
              ))}
            </div>
          </div>
        ) : null}
        {enrichment.summary ? (
          <div className="unit-docs-summary">
            <small>{t.unitDocsLabel}</small>
            <p>{enrichment.summary}</p>
          </div>
        ) : null}
        {enrichment.badges.length > 0 ? (
          <div className="unit-docs-badges">
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
        <div className="unit-header-actions">
          {props.nodeActions}
          {props.contract.symbol.file ? (
            <button type="button" className="secondary-action" onClick={props.onOpenSource}>
              <FileCode2 size={14} aria-hidden="true" /> {t.btnViewSource}
            </button>
          ) : null}
        </div>
      </header>

      <nav className="symbol-tabs" aria-label={t.symbolTabsLabel}>
        {(["overview", "contract", "consumers"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            className={activeTab === tab ? "active" : ""}
            aria-current={activeTab === tab ? "page" : undefined}
            onClick={() => setActiveTab(tab)}
          >
            {{
              overview: t.symbolTabOverview,
              contract: t.symbolTabContract,
              consumers: t.symbolTabConsumers,
            }[tab]}
          </button>
        ))}
      </nav>

      {activeTab === "overview" ? (
        <>
          <SymbolOverviewScreen
            overview={props.overview}
            onOpenFlow={props.onOpenFlow}
            onOpenTransformationCode={props.onOpenTransformationCode}
            onOpenPipelineNodeCode={props.onOpenPipelineNodeCode}
            renderValueDocumentation={props.renderValueDetails || props.renderValueActions
              ? (value) => {
                const row = contractValuesById.get(value.id);
                return row ? <OverviewValueDocumentation {...props} row={row} t={t} /> : null;
              }
              : undefined}
          />
          <ValueDocumentationOverview {...props} t={t} />
        </>
      ) : activeTab === "consumers" ? (
        <SymbolConsumersScreen overview={props.overview} onOpenFlow={props.onOpenFlow} />
      ) : rowCount === 0 ? (
        <div className="product-empty">
          <strong>{t.unitNoValues}</strong>
        </div>
      ) : (
        <div className="unit-groups" data-symbol-tab="contract">
          {props.contract.groups.map((group) => (
            <section key={group.key} className="unit-group">
              <div className="unit-group-heading">
                <h2>{unitGroupLabel(group.key, props.contract.symbol.type, t)}</h2>
                <span>{group.values.length}</span>
              </div>
              <div className="unit-value-list">
                {group.values.map((row) => (
                  <div key={row.id} className="unit-value-row-shell">
                    <button
                      type="button"
                      className="unit-value-row"
                      onClick={() => props.onOpenFlow(row.flowId)}
                      data-unit-value={row.name}
                    >
                      <span className="unit-value-main">
                        <strong>{row.name}</strong>
                        <small>{valueKindLabel(row.kind, t)}</small>
                      </span>
                      <span className="unit-value-journey">
                        {row.origin.length > 0 ? (
                          <Journey label={t.unitOrigin} steps={row.origin} />
                        ) : null}
                        {row.derivationInputs.length > 0 ? (
                          <Journey label={t.unitDerivation} steps={row.derivationInputs} />
                        ) : null}
                        {row.consumers.length > 0 ? (
                          <Journey label={t.unitConsumers} steps={row.consumers} />
                        ) : null}
                        {row.issues.length > 0 ? (
                          <span className="unit-value-issue-reasons">
                            <AlertTriangle size={13} aria-hidden="true" />
                            {uniqueIssueReasons(row).map((reason) => analysisIssueReason(reason, t).title).join(" · ")}
                          </span>
                        ) : null}
                      </span>
                      <span className="unit-value-status">
                        <span className={`flow-badge flow-badge-${
                          row.coverage.origin === "proven" || row.coverage.origin === "boundary"
                            ? "complete"
                            : "partial"
                        }`}>
                          {originLabel(row.coverage.origin, t)}
                        </span>
                        {row.issues.length > 0 ? (
                          <span className="unit-value-gaps">
                            {row.issues.length} {t.traceIssuesLabel}
                          </span>
                        ) : null}
                        <span className="unit-value-action">
                          {t.unitTrace} <ArrowRight size={14} aria-hidden="true" />
                        </span>
                      </span>
                    </button>
                    {props.renderValueDetails ? (
                      <div className="unit-value-module-details">
                        {(props.hasValueDetails?.(row) ?? true)
                          ? props.renderValueDetails(row)
                          : <span className="unit-value-docs-empty">{t.unitValueDocsMissing}</span>}
                      </div>
                    ) : null}
                    <div className="unit-value-module-actions">
                      {props.renderValueActions?.(row)}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
          {props.contract.effects.length > 0 ? (
            <section className="unit-group unit-effects">
              <div className="unit-group-heading">
                <h2>{t.unitSideEffects}</h2>
                <span>{props.contract.effects.length}</span>
              </div>
              <div className="unit-effect-list">
                {props.contract.effects.map((effect) => (
                  <div key={`${effect.id}:${effect.relation}`} className="unit-effect-row">
                    <Zap size={15} aria-hidden="true" />
                    <strong>{effect.name}</strong>
                    <span>{effectRelationLabel(effect.relation, t)}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </article>
  );
}

function ValueDocumentationOverview(props: {
  contract: SymbolContract;
  overview: SymbolOverview;
  renderValueDetails?: (row: SymbolContractValue, displayMode?: "overview" | "default") => ReactNode;
  renderValueActions?: (row: SymbolContractValue) => ReactNode;
  hasValueDetails?: (row: SymbolContractValue) => boolean;
  t: T;
}) {
  const storyValueIds = new Set(
    props.overview.stories.flatMap((story) => story.outputs.map((value) => value.id))
  );
  const groups = props.contract.groups
    .map((group) => ({
      ...group,
      values: group.values.filter((row) => !storyValueIds.has(row.id)),
    }))
    .filter((group) => group.values.length > 0);
  if (groups.length === 0 || (!props.renderValueDetails && !props.renderValueActions)) return null;
  return (
    <section className="symbol-value-docs-overview" data-symbol-overview-docs>
      <div className="symbol-section-heading">
        <div>
          <span>{props.t.unitValueDocsKicker}</span>
          <h2>{props.t.unitValueDocsTitle}</h2>
          <p>{props.t.unitValueDocsHint}</p>
        </div>
        <strong>{groups.reduce((count, group) => count + group.values.length, 0)}</strong>
      </div>
      <div className="symbol-value-docs-groups">
        {groups.map((group) => (
          <section key={group.key}>
            <h3>{unitGroupLabel(group.key, props.contract.symbol.type, props.t)}</h3>
            <div>
              {group.values.map((row) => {
                const hasDetails = props.hasValueDetails?.(row) ?? true;
                return (
                  <article key={row.id} data-overview-value-docs={row.name}>
                    <header>
                      <span><strong>{row.name}</strong><small>{valueKindLabel(row.kind, props.t)}</small></span>
                    </header>
                    <OverviewValueDocumentation {...props} row={row} t={props.t} hasDetails={hasDetails} />
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

function OverviewValueDocumentation(props: {
  row: SymbolContractValue;
  renderValueDetails?: (row: SymbolContractValue, displayMode?: "overview" | "default") => ReactNode;
  renderValueActions?: (row: SymbolContractValue) => ReactNode;
  hasValueDetails?: (row: SymbolContractValue) => boolean;
  hasDetails?: boolean;
  t: T;
}) {
  const hasDetails = props.hasDetails ?? (props.hasValueDetails?.(props.row) ?? true);
  return (
    <div className="symbol-overview-value-documentation-content">
      {hasDetails && props.renderValueDetails
        ? props.renderValueDetails(props.row, "overview")
        : <p className="unit-value-docs-empty"><Info size={14} aria-hidden="true" />{props.t.unitValueDocsMissing}</p>}
      {props.renderValueActions ? (
        <div className="symbol-overview-value-documentation-actions">
          {props.renderValueActions(props.row)}
        </div>
      ) : null}
    </div>
  );
}

function Journey(props: { label: string; steps: SymbolContractStep[] }) {
  return (
    <span className="unit-journey-line">
      <small>{props.label}</small>
      <span>
        {props.steps.map((step, index) => (
          <span key={step.id} className="unit-journey-step">
            {index > 0 ? <ArrowRight size={12} aria-hidden="true" /> : null}
            <strong>{step.path ?? step.name}</strong>
          </span>
        ))}
      </span>
    </span>
  );
}

function originLabel(origin: OriginStatus, t: T) {
  if (origin === "proven" || origin === "boundary") return t.sourceKnown;
  if (origin === "gap") return t.sourceGap;
  return t.sourceUnknown;
}

function unitGroupLabel(group: SymbolContractValueGroup, symbolType: string, t: T) {
  return {
    inputs: t.unitGroupInputs,
    reads: t.unitGroupReads,
    results: symbolType === "hook" ? t.unitGroupReturns : t.unitGroupResults,
    "ui-effects": t.unitGroupUiEffects,
  }[group];
}

function effectRelationLabel(relation: string, t: T) {
  if (relation === "dispatchesAction") return t.unitDispatchesAction;
  if (relation === "callsApi") return t.unitCallsApi;
  return relation;
}

function uniqueIssueReasons(value: SymbolContractValue) {
  return [...new Set(value.issues.map((issue) => issue.reasonCode))];
}

function valueKindLabel(kind: SymbolContractValue["kind"], t: T) {
  return {
    boundary: t.stageBoundary,
    api: t.stageNetwork,
    "async-operation": t.stageAsyncOperation,
    "state-field": t.stageStoreField,
    "selector-result": t.stageSelector,
    "hook-input": t.stageHookInput,
    "hook-return": t.stageHookReturn,
    "component-value": t.stageComponentValue,
    prop: t.stageUiReceiver,
    "ui-effect": t.stageUiEffect,
    gap: t.stageTraceGap,
  }[kind];
}

function symbolTypeLabel(type: SymbolContract["symbol"]["type"], t: T) {
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
