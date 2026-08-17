import type { Dispatch, SetStateAction } from "react";
import { AlertTriangle, BookOpenText, Boxes, CheckCircle2, CircleDot, GitBranch, Layers3, RefreshCw, Search } from "lucide-react";
import type { ArtifactHealth } from "../../../artifacts/types.js";
import type { Lang } from "../i18n.js";
import { useT } from "../i18n.js";
import {
  DEBUG_EDGE_TYPES,
  SEMANTIC_EDGE_TYPES,
  type GraphViewState,
  type PageFocusTab,
  type PagesView,
  type ViewMode,
} from "../../graph-view/viewTypes.js";
import { FSD_LAYERS, toggleSet } from "../flow/flowAdapters.js";
import type { Stats } from "../types.js";
import { SidebarWidgetsSlot } from "../slots/SidebarWidgetsSlot.js";
import { BooleanToggle, LangToggle, Metric } from "./primitives.js";
import {
  openBusinessLogic,
  openOverview,
  openPageActions,
  openPageFlows,
  openPageImpact,
  openPageOverview,
  openPageQuality,
  openPageStructure,
} from "../productNavigation.js";

export function Sidebar(props: {
  projectName?: string;
  lang: Lang;
  setLang: (lang: Lang) => void;
  query: string;
  onQueryChange: (query: string) => void;
  onOpenGlobalSearch: () => void;
  viewState: GraphViewState;
  setViewState: Dispatch<SetStateAction<GraphViewState>>;
  stats: Stats;
  viewNodeCount: number;
  viewEdgeCount: number;
  unresolvedCount: number;
  scanning: boolean;
  scanError: string | null;
  artifactHealth: ArtifactHealth | null;
  onRescan: () => void;
  onShowUnresolved: () => void;
}) {
  const t = useT();
  const { viewState, setViewState } = props;

  const MODE_OPTIONS: Array<{ mode: ViewMode; label: string }> = [
    { mode: "pages-overview", label: t.modeOverview },
    { mode: "business-logic", label: t.modeBusinessLogic },
    ...(viewState.selectedPageId ? [{ mode: "page-focus" as ViewMode, label: t.modePage }] : []),
    // The impact mode needs a target node, picked via the node details panel.
    ...(viewState.impactNodeId ? [{ mode: "impact" as ViewMode, label: t.modeImpact }] : []),
  ];
  const PAGE_FOCUS_TABS: Array<{ tab: PageFocusTab; label: string }> = [
    { tab: "structure", label: t.tabStructure },
    { tab: "dossier", label: t.tabSummary },
    { tab: "actions", label: t.tabActions },
    { tab: "impact", label: t.tabImpact },
    { tab: "quality", label: t.tabQuality },
    { tab: "data-flow", label: t.modeFocus },
  ];
  const PAGES_VIEWS: Array<{ view: PagesView; label: string }> = [
    { view: "cards", label: t.viewCards },
    { view: "table", label: t.viewTable },
  ];

  function setMode(mode: ViewMode) {
    setViewState((current) => ({
      ...(mode === "pages-overview"
        ? openOverview(current)
        : mode === "business-logic"
          ? openBusinessLogic(current)
        : mode === "page-focus"
          ? openPageStructure(current)
          : { ...current, mode }),
      inspectedNodeId: undefined,
      showImports: mode === "full-debug" ? current.showImports : false,
      visibleEdgeTypes: mode === "full-debug"
        ? new Set([...SEMANTIC_EDGE_TYPES, ...DEBUG_EDGE_TYPES])
        : new Set(SEMANTIC_EDGE_TYPES),
    }));
  }

  function setBoolean(key: "showHooks" | "showRedux" | "showFiles" | "showUnknown" | "showEnrichmentEdges", value: boolean) {
    setViewState((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function setShowImports(value: boolean) {
    setViewState((current) => ({
      ...current,
      showImports: value,
      visibleEdgeTypes: value
        ? new Set([...current.visibleEdgeTypes, ...DEBUG_EDGE_TYPES])
        : new Set(Array.from(current.visibleEdgeTypes).filter((edgeType) => !DEBUG_EDGE_TYPES.has(edgeType))),
    }));
  }

  return (
    <aside className="sidebar">
      <div className="brand-row">
        <Boxes size={22} aria-hidden="true" />
        <div className="brand-text">
          <h1>Project Map</h1>
          <p>{props.projectName ?? t.loading}</p>
        </div>
        <LangToggle lang={props.lang} setLang={props.setLang} />
      </div>

      <label className="search-box">
        <Search size={16} aria-hidden="true" />
        <input
          id="global-search"
          value={props.query}
          onChange={(event) => props.onQueryChange(event.target.value)}
          onFocus={viewState.mode === "pages-overview" ? undefined : props.onOpenGlobalSearch}
          placeholder={t.sidebarSearch}
        />
      </label>

      <section className="filter-group">
        <h2>{viewState.mode === "business-logic" ? <BookOpenText size={16} aria-hidden="true" /> : <CircleDot size={16} aria-hidden="true" />} {t.sidebarMode}</h2>
        <div className="mode-grid">
          {MODE_OPTIONS.map((option) => (
            <button
              key={option.mode}
              className={viewState.mode === option.mode ? "mode-button active" : "mode-button"}
              type="button"
              onClick={() => setMode(option.mode)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      {viewState.mode === "page-focus" ? (
        <section className="filter-group">
          <h2><GitBranch size={16} aria-hidden="true" /> {t.sidebarPageFocus}</h2>
          <div className="tab-grid">
            {PAGE_FOCUS_TABS.map((option) => (
              <button
                key={option.tab}
                className={viewState.pageFocusTab === option.tab ? "tab-button active" : "tab-button"}
                type="button"
                onClick={() => setViewState((current) => option.tab === "structure"
                  ? openPageStructure(current)
                  : option.tab === "dossier"
                    ? openPageOverview(current)
                    : option.tab === "actions"
                      ? openPageActions(current)
                      : option.tab === "impact"
                        ? openPageImpact(current)
                        : option.tab === "quality"
                          ? openPageQuality(current)
                    : openPageFlows(current))}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {props.artifactHealth ? (
        <div
          className={`artifact-status-row status-${props.artifactHealth.status}`}
          title={props.artifactHealth.reasons.map((reason) => reason.message).join("\n")}
        >
          {props.artifactHealth.status === "fresh" ? (
            <CheckCircle2 size={16} aria-hidden="true" />
          ) : (
            <AlertTriangle size={16} aria-hidden="true" />
          )}
          <span>{t.analysisStatus} · {analysisLabel(props.artifactHealth.status, t)}</span>
        </div>
      ) : null}

      <button type="button" className="rescan-button" onClick={props.onRescan} disabled={props.scanning}>
        <RefreshCw size={15} aria-hidden="true" className={props.scanning ? "spin" : undefined} />
        <span>{props.scanning ? t.scanningLabel : t.btnRescan}</span>
      </button>
      {props.scanError ? (
        <div className="warning-row">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{props.scanError}</span>
        </div>
      ) : null}

      <details className="advanced-panel">
        <summary>{t.advanced}</summary>

        {viewState.mode === "pages-overview" ? (
          <div className="tab-grid layout-grid">
            {PAGES_VIEWS.map((option) => (
              <button
                key={option.view}
                className={viewState.pagesView === option.view ? "tab-button active" : "tab-button"}
                type="button"
                onClick={() => setViewState((current) => ({ ...current, pagesView: option.view }))}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}

        <section className="filter-group">
          <h2><Layers3 size={16} aria-hidden="true" /> {t.sidebarLayers}</h2>
          <div className="toggle-grid">
            {FSD_LAYERS.map((layer) => (
              <label key={layer} className="toggle-row">
                <input
                  type="checkbox"
                  checked={viewState.visibleLayers.has(layer)}
                  onChange={() => setViewState((current) => ({
                    ...current,
                    visibleLayers: toggleSet(current.visibleLayers, layer),
                  }))}
                />
                <span>{layer}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="filter-group">
          <h2><GitBranch size={16} aria-hidden="true" /> {t.sidebarDetails}</h2>
          <div className="toggle-grid">
            <BooleanToggle label={t.toggleHooks} checked={viewState.showHooks} onChange={(checked) => setBoolean("showHooks", checked)} />
            <BooleanToggle label={t.toggleRedux} checked={viewState.showRedux} onChange={(checked) => setBoolean("showRedux", checked)} />
            <BooleanToggle label={t.toggleFiles} checked={viewState.showFiles} onChange={(checked) => setBoolean("showFiles", checked)} />
            <BooleanToggle label={t.toggleImports} checked={viewState.showImports} onChange={(checked) => setShowImports(checked)} />
            <BooleanToggle label={t.toggleUnknown} checked={viewState.showUnknown} onChange={(checked) => setBoolean("showUnknown", checked)} />
            <BooleanToggle label={t.toggleModuleEdges} checked={viewState.showEnrichmentEdges} onChange={(checked) => setBoolean("showEnrichmentEdges", checked)} />
          </div>
          <button type="button" className="advanced-debug-button" onClick={() => setMode("full-debug")}>{t.modeDebug}</button>
        </section>

        <section className="stats-grid">
          <Metric label={t.metricFiles} value={props.stats.filesCount} />
          <Metric label={t.metricFacts} value={props.stats.factsCount} />
          <Metric label={t.metricViewNodes} value={props.viewNodeCount} />
          <Metric label={t.metricViewEdges} value={props.viewEdgeCount} />
        </section>

        <SidebarWidgetsSlot />

        {props.unresolvedCount > 0 ? (
          <button type="button" className="warning-row unresolved-row" onClick={props.onShowUnresolved}>
            <AlertTriangle size={16} aria-hidden="true" />
            <span>{props.unresolvedCount} {t.metricUnresolved}</span>
          </button>
        ) : (
          <div className="muted-row">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>{props.unresolvedCount} {t.metricUnresolved}</span>
          </div>
        )}
      </details>
    </aside>
  );
}

function analysisLabel(status: ArtifactHealth["status"], t: ReturnType<typeof useT>) {
  if (status === "fresh") return t.analysisFresh;
  if (status === "incompatible") return t.analysisIncompatible;
  return t.analysisStale;
}
