import { useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Node,
  type NodeMouseHandler,
  type OnSelectionChangeParams,
  type ReactFlowInstance,
} from "@xyflow/react";
import { AlertTriangle, ChevronLeft, CircleDot, LoaderCircle } from "lucide-react";
import type { ProjectMapEdge, ProjectMapGraph, ProjectMapNode } from "../../graph/types.js";
import type { ProjectFact, UnresolvedFact } from "../../scanner/facts.js";
import type { SourceLocation } from "../../analyzers/value-flow/types.js";
import type { EnrichmentTarget, MergedEnrichment } from "../../modules/enrichmentTypes.js";
import { subscribeEnrichmentChanges } from "../../modules/ui/enrichmentEvents.js";
import type { ArtifactHealth } from "../../artifacts/types.js";
import { createFlowQueries, type FlowQueries } from "../../flow/queries.js";
import type { FlowEvidence, FlowIndex } from "../../flow/types.js";
import type { SymbolOverviewValue } from "../../flow/buildSymbolOverview.js";
import type { SymbolPipelineNode } from "./symbolPresentation.js";
import { hasValueDetails, ValueDetailsSlot } from "./slots/ValueDetailsSlot.js";
import {
  indexEnrichmentAnnotations,
  indexEnrichmentByNodeId,
} from "../graph-view/applyEnrichment.js";
import { buildViewGraph } from "../graph-view/buildViewGraph.js";
import { buildPageBusinessContext } from "../graph-view/buildPageBusinessContext.js";
import {
  buildBusinessLogicIndex,
  type BusinessLogicTarget,
} from "../graph-view/buildBusinessLogicIndex.js";
import {
  DEFAULT_VISIBLE_EDGE_TYPES,
  type GraphViewState,
  type ViewGraphEdge,
  type ViewGraphNode,
} from "../graph-view/viewTypes.js";
import { LanguageContext, translations, type Lang, type T } from "./i18n.js";
import { SourceCodeModal } from "./components/source/SourceCodeModal.js";
import type { CardNodeData } from "./nodes/CardNodes.js";
import {
  FSD_LAYERS,
  NODE_TYPES,
  applyHoverFocus,
  buildFlowGraph,
  dataFlowTargetIdFromViewNode,
  isDataFlowTargetViewNode,
} from "./flow/flowAdapters.js";
import {
  fetchSource,
  sourceModalFromResponse,
  type SourceModalState,
  type SourceResponse,
} from "./source/sourceClient.js";
import type { Stats } from "./types.js";
import { ImpactSummary } from "./components/details/ImpactSummary.js";
import { PageDossier } from "./components/details/PageDossier.js";
import { PagesDashboard } from "./components/PagesDashboard.js";
import { FlowList } from "./components/FlowList.js";
import { buildPagesDashboard } from "../graph-view/buildPagesDashboard.js";
import { buildPageFlowList } from "../graph-view/buildPageFlowList.js";
import { buildPageStructure } from "../graph-view/buildPageStructure.js";
import { traceFocus } from "./traceFocus.js";
import {
  buildPaletteEntries,
  CommandPalette,
  type PaletteEntry,
} from "./components/CommandPalette.js";
import { Sidebar } from "./components/Sidebar.js";
import { UnresolvedPanel } from "./components/UnresolvedPanel.js";
import { GraphBreadcrumb } from "./components/GraphBreadcrumb.js";
import { ExplorerHome } from "./components/ExplorerHome.js";
import { PageStructure } from "./components/PageStructure.js";
import { PageActionsScreen } from "./components/PageActionsScreen.js";
import { PageImpactScreen } from "./components/PageImpactScreen.js";
import { PageQualityScreen } from "./components/PageQualityScreen.js";
import { UnitScreen } from "./components/UnitScreen.js";
import { BusinessLogicCatalog } from "./components/BusinessLogicCatalog.js";
import { ValueJourneyScreen } from "./components/ValueJourneyScreen.js";
import { NodeDetails } from "./components/details/NodeDetails.js";
import { EdgeDetails, ViewEdgeDetails, ViewNodeDetails } from "./components/details/EdgeViews.js";
import { GlobalWidgetsSlot } from "./slots/GlobalWidgetsSlot.js";
import { NodeActionsSlot } from "./slots/NodeActionsSlot.js";
import { ValueActionsSlot } from "./slots/ValueActionsSlot.js";
import { parseUrlState, serializeUrlState, type UrlState } from "./urlState.js";
import {
  openFlowAggregate,
  openFlowList,
  openFlowTrace,
  openImpact,
  openOverview,
  openPageFlows,
  openPageOverview,
  openPageStructure,
  openUnit,
} from "./productNavigation.js";

export function App() {
  const [lang, setLangState] = useState<Lang>(() => preferredLanguage());
  const setLang = (next: Lang) => {
    window.localStorage.setItem("project-map-language", next);
    setLangState(next);
  };
  const t = translations[lang];

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      <AppInner lang={lang} setLang={setLang} t={t} />
    </LanguageContext.Provider>
  );
}

function preferredLanguage(): Lang {
  const saved = window.localStorage.getItem("project-map-language");
  if (saved === "en" || saved === "ru") return saved;
  return window.navigator.language.toLowerCase().startsWith("ru") ? "ru" : "en";
}

function AppInner(props: { lang: Lang; setLang: (lang: Lang) => void; t: T }) {
  const { lang, setLang, t } = props;

  const [graph, setGraph] = useState<ProjectMapGraph | null>(null);
  const [facts, setFacts] = useState<ProjectFact[]>([]);
  const [stats, setStats] = useState<Stats>({});
  const [unresolved, setUnresolved] = useState<UnresolvedFact[]>([]);
  const [showUnresolved, setShowUnresolved] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [enrichment, setEnrichment] = useState<MergedEnrichment | null>(null);
  const [error, setError] = useState<{ detail: string } | null>(null);
  const [loadingArtifacts, setLoadingArtifacts] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [artifactHealth, setArtifactHealth] = useState<ArtifactHealth | null>(null);
  const [flowIndex, setFlowIndex] = useState<FlowIndex | null>(null);
  const initialUrlState = useMemo(() => parseUrlState(window.location.hash), []);
  const [query, setQuery] = useState(initialUrlState.query ?? "");
  const [viewState, setViewState] = useState<GraphViewState>(() => ({
    mode: initialUrlState.mode ?? "pages-overview",
    selectedBusinessAnnotationId: initialUrlState.selectedBusinessAnnotationId,
    selectedPageId: initialUrlState.selectedPageId,
    selectedUnitId: initialUrlState.selectedUnitId,
    inspectedNodeId: initialUrlState.inspectedNodeId,
    impactNodeId: initialUrlState.impactNodeId,
    pageFocusTab: initialUrlState.pageFocusTab ?? "structure",
    pagesView: initialUrlState.pagesView ?? "table",
    flowsView: initialUrlState.flowsView ?? "list",
    selectedFlowId: initialUrlState.selectedFlowId,
    traceView: initialUrlState.traceView,
    expandedNodeIds: new Set(),
    visibleEdgeTypes: new Set(DEFAULT_VISIBLE_EDGE_TYPES),
    visibleLayers: new Set(FSD_LAYERS),
    showHooks: true,
    showRedux: true,
    showFiles: false,
    showImports: false,
    showUnknown: false,
    showEnrichmentEdges: true,
  }));
  const [selectedNode, setSelectedNode] = useState<ProjectMapNode | null>(null);
  const [selectedViewNode, setSelectedViewNode] = useState<ViewGraphNode | null>(null);
  const graphShellRef = useRef<HTMLElement | null>(null);
  const reactFlowRef = useRef<ReactFlowInstance<Node<CardNodeData>> | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<ProjectMapEdge | null>(null);
  const [selectedViewEdge, setSelectedViewEdge] = useState<ViewGraphEdge | null>(null);
  const [selectedDataFlowTargetId, setSelectedDataFlowTargetId] = useState<string | undefined>(undefined);
  const [sourceModal, setSourceModal] = useState<SourceModalState>(null);

  useEffect(() => {
    void loadArtifacts();
  }, []);

  useEffect(
    () => subscribeEnrichmentChanges(() => {
      void refreshEnrichment();
    }),
    []
  );

  // Cmd/Ctrl+K toggles the jump-to-node palette from anywhere.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function loadArtifacts() {
    setLoadingArtifacts(true);
    try {
      const [graphResponse, statsResponse, unresolvedResponse, factsResponse, enrichmentResponse, artifactStatusResponse, flowsResponse] = await Promise.all([
        fetch("/api/graph"),
        fetch("/api/stats"),
        fetch("/api/unresolved"),
        fetch("/api/facts"),
        fetch("/api/enrichment"),
        fetch("/api/artifacts/status"),
        fetch("/api/flows"),
      ]);

      const nextArtifactHealth = artifactStatusResponse.ok
        ? ((await artifactStatusResponse.json()) as ArtifactHealth)
        : {
          status: "stale" as const,
          checkedAt: new Date().toISOString(),
          reasons: [{ code: "status-unavailable", message: "Artifact status is unavailable." }],
        };
      setArtifactHealth(nextArtifactHealth);

      if (!graphResponse.ok) {
        throw new Error(await responseErrorMessage(graphResponse, "Project graph is unavailable."));
      }
      if (!flowsResponse.ok) {
        throw new Error(await responseErrorMessage(flowsResponse, "Value traces are unavailable or incompatible."));
      }

      const nextGraph = (await graphResponse.json()) as ProjectMapGraph;
      const nextStats = statsResponse.ok ? ((await statsResponse.json()) as Stats) : {};
      const nextUnresolved = unresolvedResponse.ok ? ((await unresolvedResponse.json()) as UnresolvedFact[]) : [];
      const nextFacts = factsResponse.ok ? ((await factsResponse.json()) as ProjectFact[]) : [];
      const nextEnrichment = enrichmentResponse.ok
        ? ((await enrichmentResponse.json()) as MergedEnrichment)
        : null;
      const nextFlowIndex = (await flowsResponse.json()) as FlowIndex;

      setGraph(nextGraph);
      setFacts(nextFacts);
      setStats(nextStats);
      setUnresolved(nextUnresolved);
      setEnrichment(nextEnrichment);
      setArtifactHealth(nextArtifactHealth);
      setFlowIndex(nextFlowIndex);
      setError(null);
    } catch (loadError) {
      setError({ detail: loadError instanceof Error ? loadError.message : String(loadError) });
    } finally {
      setLoadingArtifacts(false);
    }
  }

  async function rescan() {
    setScanning(true);
    setScanError(null);
    try {
      const response = await fetch("/api/scan", { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!response.ok) {
        throw new Error(body.message ?? body.error ?? "Scan failed");
      }
      await loadArtifacts();
    } catch (scanFailure) {
      setScanError(scanFailure instanceof Error ? scanFailure.message : String(scanFailure));
    } finally {
      setScanning(false);
    }
  }

  async function refreshEnrichment() {
    try {
      const response = await fetch("/api/enrichment");
      if (!response.ok) return;
      setEnrichment((await response.json()) as MergedEnrichment);
    } catch {
      // A module refresh is best-effort: generation status already carries
      // actionable errors, and a transient overlay failure must not replace
      // the currently usable project analysis.
    }
  }

  async function responseErrorMessage(response: Response, fallback: string) {
    const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
    return body.message ?? body.error ?? fallback;
  }

  const enrichmentIndex = useMemo(
    () => indexEnrichmentByNodeId(enrichment?.nodes ?? []),
    [enrichment]
  );
  const enrichmentAnnotationIndex = useMemo(
    () => indexEnrichmentAnnotations(enrichment?.annotations ?? []),
    [enrichment]
  );
  const semanticAnnotationIndex = useMemo(
    () => indexEnrichmentAnnotations(enrichment?.annotations ?? [], flowIndex ?? undefined),
    [enrichment, flowIndex]
  );
  const paletteEntries = useMemo(
    () => graph ? buildPaletteEntries({
      nodes: graph.nodes,
      annotations: enrichment?.annotations ?? [],
      flowIndex: flowIndex ?? undefined,
    }) : [],
    [enrichment, flowIndex, graph]
  );
  const businessLogicIndex = useMemo(
    () => graph && flowIndex ? buildBusinessLogicIndex({
      graph,
      flowIndex,
      annotations: enrichment?.annotations ?? [],
    }) : null,
    [enrichment, flowIndex, graph]
  );

  const flowQueries = useMemo<FlowQueries | null>(
    () => graph && flowIndex ? createFlowQueries({ graph, flowIndex }) : null,
    [flowIndex, graph]
  );

  const viewGraph = useMemo(() => {
    if (!graph) return { nodes: [], edges: [] };
    return buildViewGraph(graph, viewState, facts, {
      byNodeId: enrichmentIndex,
      edges: enrichment?.edges ?? [],
      showEdges: viewState.showEnrichmentEdges,
    }, flowQueries ?? undefined);
  }, [enrichment, enrichmentIndex, facts, flowQueries, graph, viewState]);

  const filteredViewGraph = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return viewGraph;

    const nodes = viewGraph.nodes.filter((node) => {
      const queryText = `${node.label} ${node.file ?? ""} ${node.fsdLayer ?? ""} ${node.fsdSlice ?? ""}`.toLowerCase();
      return queryText.includes(normalizedQuery);
    });
    const visibleNodeIds = new Set(nodes.map((node) => node.id));

    return {
      nodes,
      edges: viewGraph.edges.filter((edge) => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to)),
    };
  }, [query, viewGraph]);

  const flowGraph = useMemo(() => {
    return buildFlowGraph(filteredViewGraph, { selectedNodeId: selectedNode?.id ?? selectedViewNode?.id });
  }, [filteredViewGraph, selectedNode, selectedViewNode]);

  // Re-fit the viewport when the Flows canvas switches trace (single flow ↔
  // aggregate), so the newly drawn graph isn't left off-screen.
  useEffect(() => {
    if (!reactFlowRef.current) return;
    const id = requestAnimationFrame(() => reactFlowRef.current?.fitView({ duration: 250 }));
    return () => cancelAnimationFrame(id);
  }, [viewState.selectedFlowId, viewState.flowsView]);

  const incomingEdges = useMemo(() => {
    if (!graph || !selectedNode) return [];
    return graph.edges.filter((edge) => edge.to === selectedNode.id);
  }, [graph, selectedNode]);

  const outgoingEdges = useMemo(() => {
    if (!graph || !selectedNode) return [];
    return graph.edges.filter((edge) => edge.from === selectedNode.id);
  }, [graph, selectedNode]);

  const selectedPage = useMemo(() => {
    if (!graph || !viewState.selectedPageId) return null;
    return graph.nodes.find((node) => node.id === viewState.selectedPageId) ?? null;
  }, [graph, viewState.selectedPageId]);

  const selectedUnit = useMemo(() => {
    if (!graph || !viewState.selectedUnitId) return null;
    return graph.nodes.find((node) => node.id === viewState.selectedUnitId) ?? null;
  }, [graph, viewState.selectedUnitId]);

  const pageStructure = useMemo(() => {
    if (!graph || !flowQueries || !selectedPage) return null;
    return buildPageStructure(graph, flowQueries, selectedPage.id);
  }, [flowQueries, graph, selectedPage]);

  const pageSummary = useMemo(() => {
    if (!flowQueries || !selectedPage) return null;
    return flowQueries.getPageSummary(selectedPage.id);
  }, [flowQueries, selectedPage]);

  const pageBusinessContext = useMemo(() => {
    if (!graph || !flowIndex || !flowQueries || !selectedPage) return undefined;
    const overview = flowQueries.getPageOverview(selectedPage.id);
    if (!overview) return undefined;
    return buildPageBusinessContext({
      graph,
      overview,
      flowIndex,
      annotations: enrichment?.annotations ?? [],
    });
  }, [enrichment, flowIndex, flowQueries, graph, selectedPage]);

  const pageIssues = useMemo(() => {
    if (!flowQueries || !selectedPage) return null;
    return flowQueries.getPageIssues(selectedPage.id);
  }, [flowQueries, selectedPage]);

  const pageActions = useMemo(() => {
    if (!flowQueries || !selectedPage) return null;
    return flowQueries.getPageActions(selectedPage.id);
  }, [flowQueries, selectedPage]);

  const pageImpact = useMemo(() => {
    if (!flowQueries || !selectedPage) return null;
    return flowQueries.getPageImpact(selectedPage.id);
  }, [flowQueries, selectedPage]);

  const pageQuality = useMemo(() => {
    if (!flowQueries || !selectedPage) return null;
    return flowQueries.getPageQuality(selectedPage.id);
  }, [flowQueries, selectedPage]);

  const pageTopologyNodeIds = useMemo(() => {
    if (!flowQueries || !selectedPage) return [];
    return flowQueries.getPageOverview(selectedPage.id)?.topologyNodes.map((node) => node.id) ?? [];
  }, [flowQueries, selectedPage]);

  const symbolContract = useMemo(() => {
    if (!graph || !flowQueries || !selectedPage || !selectedUnit) return null;
    return flowQueries.getSymbolContract(selectedPage.id, selectedUnit.id);
  }, [flowQueries, graph, selectedPage, selectedUnit]);

  const symbolOverview = useMemo(() => {
    if (!flowQueries || !selectedPage || !selectedUnit) return null;
    return flowQueries.getSymbolOverview(selectedPage.id, selectedUnit.id);
  }, [flowQueries, selectedPage, selectedUnit]);

  const selectedFlow = useMemo(() => {
    if (!flowQueries || !viewState.selectedFlowId) return null;
    return flowQueries.getValueFlow(viewState.selectedFlowId);
  }, [flowQueries, viewState.selectedFlowId]);

  const selectedJourney = useMemo(() => {
    if (!flowQueries || !viewState.selectedFlowId) return null;
    return flowQueries.getValueJourney(viewState.selectedFlowId);
  }, [flowQueries, viewState.selectedFlowId]);

  const activeTraceView = viewState.traceView ?? selectedJourney?.recommendedView ?? "graph";

  const flowListRows = useMemo(() => {
    if (!flowQueries || !selectedPage || viewState.mode !== "page-focus" || viewState.pageFocusTab !== "data-flow") {
      return [];
    }
    return buildPageFlowList(flowQueries, selectedPage.id);
  }, [flowQueries, selectedPage, viewState.mode, viewState.pageFocusTab]);

  // The Flows tab shows the list by default; a single flow's trace or the
  // demoted aggregate canvas replace it, and both offer a way back to the list.
  const flowsListActive =
    viewState.mode === "page-focus" &&
    viewState.pageFocusTab === "data-flow" &&
    !viewState.selectedFlowId &&
    viewState.flowsView !== "aggregate";
  const flowTraceActive =
    viewState.mode === "page-focus" &&
    viewState.pageFocusTab === "data-flow" &&
    Boolean(viewState.selectedFlowId);
  const flowsCanvasActive =
    viewState.mode === "page-focus" &&
    viewState.pageFocusTab === "data-flow" &&
    Boolean(viewState.flowsView === "aggregate" || (viewState.selectedFlowId && activeTraceView === "graph"));

  const breadcrumbItems = useMemo(() => {
    if (viewState.mode !== "page-focus" || !selectedPage) return [];
    return [
      {
        id: "pages",
        label: t.crumbPageFocus,
        onClick: () => setViewState((current) => openOverview(current)),
      },
      {
        id: selectedPage.id,
        label: selectedPage.name,
        onClick: viewState.selectedUnitId || viewState.selectedFlowId
          ? () => setViewState((current) => openPageStructure(current, selectedPage.id))
          : undefined,
      },
      ...(selectedUnit ? [{
        id: selectedUnit.id,
        label: selectedUnit.name,
        onClick: viewState.selectedFlowId
          ? () => setViewState((current) => openUnit(current, selectedUnit.id, selectedPage.id))
          : undefined,
      }] : []),
      ...(selectedFlow ? [{
        id: selectedFlow.flow.id,
        label: selectedFlow.subject.path ?? selectedFlow.subject.name,
      }] : []),
    ];
  }, [selectedFlow, selectedPage, selectedUnit, t.crumbPageFocus, viewState.mode, viewState.selectedFlowId, viewState.selectedUnitId]);

  // Restore the node selected in the shared URL once the graph is available.
  useEffect(() => {
    if (!graph || !initialUrlState.selectedNodeId) return;
    const node = graph.nodes.find((entry) => entry.id === initialUrlState.selectedNodeId);
    if (node) setSelectedNode(node);
  }, [graph, initialUrlState]);

  // Keep the URL hash in sync with the shareable state: navigation-level
  // changes (mode, page) push a history entry, the rest replaces in place.
  const urlSyncRef = useRef({
    mode: viewState.mode,
    selectedPageId: viewState.selectedPageId,
    selectedUnitId: viewState.selectedUnitId,
    selectedFlowId: viewState.selectedFlowId,
  });
  useEffect(() => {
    const urlState: UrlState = {
      mode: viewState.mode,
      selectedBusinessAnnotationId: viewState.selectedBusinessAnnotationId,
      selectedPageId: viewState.selectedPageId,
      selectedUnitId: viewState.selectedUnitId,
      inspectedNodeId: viewState.inspectedNodeId,
      impactNodeId: viewState.impactNodeId,
      pageFocusTab: viewState.pageFocusTab,
      pagesView: viewState.pagesView,
      flowsView: viewState.flowsView,
      selectedFlowId: viewState.selectedFlowId,
      traceView: viewState.traceView,
      selectedNodeId: selectedNode?.id,
      query: query || undefined,
    };
    const next = serializeUrlState(urlState);
    if (next === window.location.hash) return;

    // Opening/closing a single flow is a navigation step too, so Back returns
    // from a trace to the Flows list rather than out of the page.
    const navigational =
      urlSyncRef.current.mode !== viewState.mode ||
      urlSyncRef.current.selectedPageId !== viewState.selectedPageId ||
      urlSyncRef.current.selectedUnitId !== viewState.selectedUnitId ||
      urlSyncRef.current.selectedFlowId !== viewState.selectedFlowId;
    urlSyncRef.current = {
      mode: viewState.mode,
      selectedPageId: viewState.selectedPageId,
      selectedUnitId: viewState.selectedUnitId,
      selectedFlowId: viewState.selectedFlowId,
    };

    const url = next || window.location.pathname + window.location.search;
    if (navigational) {
      window.history.pushState(null, "", url);
    } else {
      window.history.replaceState(null, "", url);
    }
  }, [viewState.mode, viewState.selectedBusinessAnnotationId, viewState.selectedPageId, viewState.selectedUnitId, viewState.inspectedNodeId, viewState.impactNodeId, viewState.pageFocusTab, viewState.pagesView, viewState.flowsView, viewState.selectedFlowId, viewState.traceView, selectedNode, query]);

  // Back/forward restores the state encoded in the hash.
  useEffect(() => {
    const onPopState = () => {
      const parsed = parseUrlState(window.location.hash);
      urlSyncRef.current = {
        mode: parsed.mode ?? "pages-overview",
        selectedPageId: parsed.selectedPageId,
        selectedUnitId: parsed.selectedUnitId,
        selectedFlowId: parsed.selectedFlowId,
      };
      setViewState((current) => ({
        ...current,
        mode: parsed.mode ?? "pages-overview",
        selectedBusinessAnnotationId: parsed.selectedBusinessAnnotationId,
        selectedPageId: parsed.selectedPageId,
        selectedUnitId: parsed.selectedUnitId,
        inspectedNodeId: parsed.inspectedNodeId,
        impactNodeId: parsed.impactNodeId,
        pageFocusTab: parsed.pageFocusTab ?? "structure",
        pagesView: parsed.pagesView ?? "table",
        flowsView: parsed.flowsView ?? "list",
        selectedFlowId: parsed.selectedFlowId,
        traceView: parsed.traceView,
      }));
      setQuery(parsed.query ?? "");
      setSelectedViewNode(null);
      setSelectedViewEdge(null);
      setSelectedEdge(null);
      setSelectedDataFlowTargetId(undefined);
      setSelectedNode(
        parsed.selectedNodeId
          ? graph?.nodes.find((entry) => entry.id === parsed.selectedNodeId) ?? null
          : null
      );
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [graph]);

  useEffect(() => {
    if (!selectedViewNode) return;
    if (filteredViewGraph.nodes.some((node) => node.id === selectedViewNode.id)) return;

    const replacement = selectedNode
      ? filteredViewGraph.nodes.find((node) => node.sourceNode?.id === selectedNode.id) ?? null
      : null;

    if (replacement) {
      selectViewNode(replacement);
    } else {
      clearSelection();
    }
  }, [filteredViewGraph.nodes, selectedNode, selectedViewNode]);

  function onSelectionChange(selection: OnSelectionChangeParams) {
    const edgeId = selection.edges[0]?.id;
    const viewEdge = edgeId ? filteredViewGraph.edges.find((edge) => edge.id === edgeId) ?? null : null;

    if (viewEdge) {
      selectViewEdge(viewEdge);
    }
  }

  const onNodeClick: NodeMouseHandler<Node<CardNodeData>> = (_event, node) => {
    const viewNode = node.data.viewNode;

    // Stage headers are pure column labels — not selectable.
    if (viewNode.kind === "stage-header") return;

    if (isDataFlowTargetViewNode(viewNode) && selectDataFlowTargetViewNode(viewNode)) return;

    selectViewNode(viewNode);

    if (viewNode.kind === "page-card" && viewState.mode === "pages-overview") {
      setQuery("");
      setViewState((current) => openPageStructure(current, viewNode.id));
      return;
    }

    // In the Flows canvas (single trace or aggregate) selecting a step just
    // shows its Evidence + Impact in the inspector (PM-013); it does not re-scope
    // the canvas — a single flow is opened from the list, not by clicking nodes.
    if (viewNode.kind === "semantic-card" && viewState.pageFocusTab === "data-flow" && viewNode.dataFlow) {
      return;
    }

    if (viewNode.kind === "semantic-card" && viewState.mode === "page-focus") {
      setViewState((current) => ({
        ...current,
        inspectedNodeId: viewNode.sourceNode?.id ?? viewNode.id,
      }));
    }
  };

  // Focus+context dimming is applied imperatively to the DOM (no React state),
  // so hovering never rebuilds the graph and the canvas can't flicker.
  const onNodeMouseEnter: NodeMouseHandler<Node<CardNodeData>> = (_event, node) =>
    applyHoverFocus(graphShellRef.current, filteredViewGraph, node.id);
  const onNodeMouseLeave = () => applyHoverFocus(graphShellRef.current, filteredViewGraph, null);

  function jumpToNode(node: ProjectMapNode) {
    setPaletteOpen(false);
    setSelectedViewNode(null);
    setSelectedViewEdge(null);
    setSelectedEdge(null);
    setSelectedNode(node);
    if (node.type === "page") {
      setQuery("");
      setViewState((current) => openPageStructure(current, node.id));
      return;
    }
    if (node.type === "component" || node.type === "hook") {
      const pageId = viewState.selectedPageId ?? findPageForNode(node.id);
      if (pageId) {
        setViewState((current) => openUnit(current, node.id, pageId));
      }
    }
  }

  function jumpToPaletteEntry(entry: PaletteEntry) {
    if (entry.kind === "node" || !entry.flowId) {
      jumpToNode(entry.node);
      return;
    }
    const pageId = findPageForNode(entry.node.id) ?? viewState.selectedPageId;
    if (!pageId) {
      jumpToNode(entry.node);
      return;
    }
    setPaletteOpen(false);
    setSelectedNode(null);
    setSelectedViewNode(null);
    setSelectedViewEdge(null);
    setSelectedEdge(null);
    setViewState((current) => openFlowTrace(
      { ...current, selectedPageId: pageId },
      entry.flowId!,
      entry.node.type === "component" || entry.node.type === "hook"
        ? entry.node.id
        : undefined
    ));
  }

  function openBusinessTarget(input: EnrichmentTarget | BusinessLogicTarget) {
    if (!graph) return;
    const richTarget = "target" in input ? input : undefined;
    const target = richTarget?.target ?? input as EnrichmentTarget;
    if (target.type === "node") {
      const node = graph.nodes.find((entry) => entry.id === target.id);
      if (node) jumpToNode(node);
      return;
    }
    if (target.type !== "flow-node" || !flowIndex) return;
    const flow = richTarget?.flowId
      ? flowIndex.flows.find((entry) => entry.id === richTarget.flowId)
      : flowIndex.flows.find((entry) => entry.nodeIds.includes(target.id));
    if (!flow) return;
    const flowNode = flowIndex.nodes.find((entry) => entry.id === target.id);
    const owner = flowNode?.ownerNodeId
      ? graph.nodes.find((entry) => entry.id === flowNode.ownerNodeId)
      : undefined;
    const pageId = richTarget?.pageIds[0]
      ?? selectedPage?.id
      ?? (owner ? findPageForNode(owner.id) : undefined);
    if (!pageId) return;
    setSelectedNode(null);
    setSelectedViewNode(null);
    setSelectedViewEdge(null);
    setSelectedEdge(null);
    setViewState((current) => openFlowTrace(
      { ...current, selectedPageId: pageId },
      flow.id,
      owner && (owner.type === "component" || owner.type === "hook")
        ? owner.id
        : undefined
    ));
  }

  function findPageForNode(nodeId: string) {
    if (!graph || !flowQueries) return undefined;
    return graph.nodes
      .filter((node) => node.type === "page")
      .find((page) => flowQueries.getPageOverview(page.id)?.topologyNodes.some((node) => node.id === nodeId))
      ?.id;
  }

  // A Business-rule tag (e.g. [selectCanDelete]) → select the node it names and
  // open its data-flow trace. Most tags are selectors; fall back through other
  // node types, then do nothing if the identifier isn't a graph node.
  function traceIdentifier(identifier: string) {
    if (!graph) return;
    const byType = (type: ProjectMapNode["type"]) => graph.nodes.find((node) => node.type === type && node.name === identifier);
    const target = byType("selector") ?? byType("action") ?? byType("hook") ?? byType("component");
    if (!target) return;
    setSelectedViewNode(null);
    setSelectedViewEdge(null);
    setSelectedEdge(null);
    setSelectedNode(target);
    traceFocus.request(target.id);
  }

  function selectTraceView(traceView: NonNullable<GraphViewState["traceView"]>) {
    clearSelection();
    setViewState((current) => ({ ...current, traceView }));
  }

  const traceDocumentActive = flowTraceActive && activeTraceView !== "graph";
  const actionsDocumentActive = viewState.mode === "page-focus" && viewState.pageFocusTab === "actions";
  const impactDocumentActive = viewState.mode === "page-focus" && viewState.pageFocusTab === "impact";
  const qualityDocumentActive = viewState.mode === "page-focus" && viewState.pageFocusTab === "quality";
  const detailPanelVisible = !traceDocumentActive && !actionsDocumentActive && !impactDocumentActive &&
    !qualityDocumentActive && Boolean(
    selectedViewNode ||
    selectedNode ||
    selectedEdge ||
    selectedViewEdge ||
    (graph && viewState.mode === "impact" && viewState.impactNodeId)
  );
  const selectedFlowAnnotations = selectedViewNode?.dataFlow
    ? semanticAnnotationIndex.get(`flow-node:${selectedViewNode.id}`) ?? []
    : [];
  const selectedFlowDirectAnnotations = selectedViewNode?.dataFlow
    ? enrichmentAnnotationIndex.get(`flow-node:${selectedViewNode.id}`) ?? []
    : [];
  const selectedFlowOwner = selectedViewNode?.dataFlow && graph
    ? selectedViewNode.sourceNode ??
      graph.nodes.find((node) =>
        node.id === selectedFlowAnnotations[0]?.ownerNodeId
      )
    : undefined;

  return (
    <main className={`app-shell${detailPanelVisible ? "" : " app-shell-wide"}`}>
      <Sidebar
        projectName={graph?.project.name}
        lang={lang}
        setLang={setLang}
        query={query}
        onQueryChange={setQuery}
        onOpenGlobalSearch={() => setPaletteOpen(true)}
        viewState={viewState}
        setViewState={setViewState}
        stats={stats}
        viewNodeCount={filteredViewGraph.nodes.length}
        viewEdgeCount={filteredViewGraph.edges.length}
        unresolvedCount={unresolved.length}
        scanning={scanning}
        scanError={scanError}
        artifactHealth={artifactHealth}
        onRescan={() => void rescan()}
        onShowUnresolved={() => setShowUnresolved(true)}
      />

      <section className="graph-shell" ref={graphShellRef}>
        <GraphBreadcrumb items={breadcrumbItems} />
        {flowTraceActive || flowsCanvasActive ? (
          <div className="flow-canvas-toolbar">
            <button
              type="button"
              className="flow-view-toggle"
              onClick={() => setViewState((current) => selectedUnit && selectedPage
                ? openUnit(current, selectedUnit.id, selectedPage.id)
                : openFlowList(current))}
            >
              <ChevronLeft size={14} aria-hidden="true" />
              {selectedUnit ? t.flowBackToUnit : t.flowBackToList}
            </button>
            <span className="flow-canvas-mode">
              {viewState.selectedFlowId ? t.flowTraceSingle : t.flowTraceAggregate}
            </span>
            {viewState.selectedFlowId && selectedJourney ? (
              <div className="trace-view-switch" role="tablist" aria-label={t.flowTraceSingle}>
                {([
                  ["steps", t.flowStepsTab],
                  ["graph", t.flowGraphTab],
                  ["evidence", t.flowEvidenceTab],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={activeTraceView === value}
                    className={activeTraceView === value ? "active" : ""}
                    onClick={() => selectTraceView(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {error ? (
          <div className="analysis-recovery" role="alert">
            <AlertTriangle size={28} aria-hidden="true" />
            <h1>{t.analysisUnavailable}</h1>
            <p>{t.analysisUnavailableBody}</p>
            {scanError ? <p className="recovery-error">{scanError}</p> : null}
            <button type="button" className="primary-action" onClick={() => void rescan()} disabled={scanning}>
              {scanning ? t.scanningLabel : t.retryAnalysis}
            </button>
            <details>
              <summary>{t.technicalDetails}</summary>
              <code>{error.detail}</code>
            </details>
          </div>
        ) : loadingArtifacts && !graph ? (
          <div className="empty-state">
            <LoaderCircle size={28} aria-hidden="true" className="spin" />
            <strong>{t.loadingAnalysis}</strong>
          </div>
        ) : graph && businessLogicIndex && viewState.mode === "business-logic" ? (
          <div className="dossier-shell business-catalog-shell">
            <BusinessLogicCatalog
              index={businessLogicIndex}
              selectedKey={viewState.selectedBusinessAnnotationId}
              onSelect={(key) => setViewState((current) => ({ ...current, selectedBusinessAnnotationId: key }))}
              onOpenTarget={openBusinessTarget}
              onOpenPage={(pageId) => setViewState((current) => openPageOverview({ ...current, selectedPageId: pageId }))}
              onOpenEvidence={(evidence, title) => void openEvidenceUsage(evidence, title)}
              renderOwnerActions={(entry) => entry.owner ? (
                <NodeActionsSlot
                  node={entry.owner}
                  graph={graph}
                  enrichment={enrichmentIndex.get(entry.owner.id)}
                  annotations={enrichmentAnnotationIndex.get(`node:${entry.owner.id}`)}
                />
              ) : null}
            />
          </div>
        ) : graph && viewState.mode === "pages-overview" && viewState.pagesView === "table" ? (
          <div className="dossier-shell">
            <ExplorerHome
              onFindPage={() => document.getElementById("global-search")?.focus()}
              onFindUnit={() => setPaletteOpen(true)}
              onCheckImpact={() => setPaletteOpen(true)}
            >
              <PagesDashboard
                rows={buildPagesDashboard(graph, viewState, enrichmentIndex, flowQueries ?? undefined, query).rows}
                onSelectPage={(pageId) => {
                  setQuery("");
                  setViewState((current) => openPageStructure(current, pageId));
                }}
              />
            </ExplorerHome>
          </div>
        ) : graph && flowQueries && selectedPage && viewState.mode === "page-focus" &&
          viewState.pageFocusTab === "structure" && selectedUnit && symbolContract && symbolOverview ? (
          <div className="dossier-shell">
            <UnitScreen
              contract={symbolContract}
              overview={symbolOverview}
              enrichment={enrichmentIndex.get(selectedUnit.id)}
              nodeActions={
                <NodeActionsSlot
                  node={selectedUnit}
                  graph={graph}
                  enrichment={enrichmentIndex.get(selectedUnit.id)}
                  annotations={enrichmentAnnotationIndex.get(`node:${selectedUnit.id}`)}
                />
              }
              renderValueDetails={(row, displayMode) => (
                <ValueDetailsSlot
                  ownerNode={selectedUnit}
                  graph={graph}
                  flowNodeId={row.flowNodeId}
                  valueLabel={row.name}
                  displayMode={displayMode === "overview" ? "compact" : "expanded"}
                  annotations={semanticAnnotationIndex.get(`flow-node:${row.flowNodeId}`)}
                />
              )}
              hasValueDetails={(row) => hasValueDetails({
                ownerNode: selectedUnit,
                graph,
                flowNodeId: row.flowNodeId,
                valueLabel: row.name,
                annotations: semanticAnnotationIndex.get(`flow-node:${row.flowNodeId}`),
              })}
              renderValueActions={(row) => (
                <ValueActionsSlot
                  ownerNode={selectedUnit}
                  graph={graph}
                  flowNodeId={row.flowNodeId}
                  valueLabel={row.name}
                  annotations={enrichmentAnnotationIndex.get(`flow-node:${row.flowNodeId}`)}
                />
              )}
              onOpenFlow={(flowId) => setViewState((current) => openFlowTrace(current, flowId, selectedUnit.id))}
              onOpenTransformationCode={openTransformationCode}
              onOpenPipelineNodeCode={openPipelineNodeCode}
              onOpenSource={() => void openNodeSource(selectedUnit)}
            />
          </div>
        ) : graph && flowQueries && selectedPage && viewState.mode === "page-focus" &&
          viewState.pageFocusTab === "structure" && pageStructure && pageSummary && pageIssues ? (
          <div className="dossier-shell">
            <PageStructure
              structure={pageStructure}
              summary={pageSummary}
              issues={pageIssues}
              enrichmentByNodeId={enrichmentIndex}
              renderNodeActions={(unitId) => {
                const unit = graph.nodes.find((node) => node.id === unitId);
                return unit ? (
                  <NodeActionsSlot
                    node={unit}
                    graph={graph}
                    enrichment={enrichmentIndex.get(unit.id)}
                    annotations={enrichmentAnnotationIndex.get(`node:${unit.id}`)}
                  />
                ) : null;
              }}
              onOpenUnit={(unitId) => setViewState((current) => openUnit(current, unitId, selectedPage.id))}
              onOpenFlow={(flowId) => setViewState((current) => openFlowTrace(current, flowId))}
              onOpenEvidence={(evidence, title) => void openEvidenceUsage(evidence, title)}
              onOpenSource={(unitId) => {
                const unit = graph.nodes.find((node) => node.id === unitId);
                if (unit) void openNodeSource(unit);
              }}
            />
          </div>
        ) : graph && selectedPage && viewState.mode === "page-focus" && viewState.pageFocusTab === "dossier" ? (
          <div className="dossier-shell">
            <PageDossier
              graph={graph}
              page={selectedPage}
              flowQueries={flowQueries ?? undefined}
              enrichmentByNodeId={enrichmentIndex}
              businessContext={pageBusinessContext}
              onOpenBusinessTarget={openBusinessTarget}
              nodeActions={(
                <NodeActionsSlot
                  node={selectedPage}
                  graph={graph}
                  enrichment={enrichmentIndex.get(selectedPage.id)}
                  annotations={enrichmentAnnotationIndex.get(`node:${selectedPage.id}`)}
                />
              )}
              onSelectNode={(node) => { setSelectedViewNode(null); setSelectedViewEdge(null); setSelectedEdge(null); setSelectedNode(node); }}
              onOpenNodeSource={(node) => void openNodeSource(node)}
              onOpenEvidence={(evidence, title) => void openEvidenceUsage(evidence, title)}
              onTraceTag={traceIdentifier}
            />
          </div>
        ) : graph && selectedPage && pageActions && viewState.mode === "page-focus" &&
          viewState.pageFocusTab === "actions" ? (
          <div className="dossier-shell">
            <PageActionsScreen
              summary={pageActions}
              onOpenFlow={(flowId) => setViewState((current) => openFlowTrace(current, flowId))}
              onOpenEvidence={(evidence, title) => void openEvidenceUsage(evidence, title)}
              onOpenImpact={showImpactTarget}
            />
          </div>
        ) : graph && selectedPage && pageImpact && viewState.mode === "page-focus" &&
          viewState.pageFocusTab === "impact" ? (
          <div className="dossier-shell">
            <PageImpactScreen
              summary={pageImpact}
              onOpenFlow={(flowId) => setViewState((current) => openFlowTrace(current, flowId))}
              onOpenEvidence={(evidence, title) => void openEvidenceUsage(evidence, title)}
              onOpenImpactGraph={showImpactTarget}
              onOpenPage={(pageId) => setViewState((current) => openPageStructure(current, pageId))}
              onOpenSymbol={(targetId) => {
                const target = graph.nodes.find((node) => node.id === targetId);
                if (!target) return;
                const local = flowQueries?.getPageOverview(selectedPage.id)?.topologyNodes
                  .some((node) => node.id === target.id);
                if (local && (target.type === "component" || target.type === "hook")) {
                  setViewState((current) => openUnit(current, target.id, selectedPage.id));
                } else {
                  void openNodeSource(target);
                }
              }}
            />
          </div>
        ) : graph && selectedPage && pageQuality && viewState.mode === "page-focus" &&
          viewState.pageFocusTab === "quality" ? (
          <div className="dossier-shell">
            <PageQualityScreen
              summary={pageQuality}
              topologyNodeIds={pageTopologyNodeIds}
              artifactHealth={artifactHealth}
              onOpenFlow={(flowId) => setViewState((current) => openFlowTrace(current, flowId))}
              onOpenEvidence={(evidence, title) => void openEvidenceUsage(evidence, title)}
              onOpenSymbol={(targetId) => {
                const target = graph.nodes.find((node) => node.id === targetId);
                if (!target) return;
                const local = pageTopologyNodeIds.includes(target.id);
                if (local && (target.type === "component" || target.type === "hook")) {
                  setViewState((current) => openUnit(current, target.id, selectedPage.id));
                } else {
                  void openNodeSource(target);
                }
              }}
            />
          </div>
        ) : graph && selectedPage && flowsListActive ? (
          <div className="dossier-shell">
            <FlowList
              rows={flowListRows}
              query={query}
              onOpenFlow={(flowId) => setViewState((current) => openFlowTrace(current, flowId))}
              onShowAggregate={() => setViewState((current) => openFlowAggregate(current))}
            />
          </div>
        ) : graph && selectedJourney && flowTraceActive && activeTraceView !== "graph" ? (
          <div className="dossier-shell">
            <ValueJourneyScreen
              journey={selectedJourney}
              view={activeTraceView}
              onOpenEvidence={(evidence, title) => void openEvidenceUsage(evidence, title)}
              onOpenStepCode={openStepCode}
              renderStepDetails={(step) => {
                const owner = step.ownerNodeId
                  ? graph.nodes.find((node) => node.id === step.ownerNodeId)
                  : undefined;
                return owner ? (
                  <ValueDetailsSlot
                    ownerNode={owner}
                    graph={graph}
                    flowNodeId={step.id}
                    valueLabel={step.path ?? step.name}
                    annotations={semanticAnnotationIndex.get(`flow-node:${step.id}`)}
                  />
                ) : null;
              }}
            />
          </div>
        ) : (
          <ReactFlow
            nodes={flowGraph.nodes}
            edges={flowGraph.edges}
            nodeTypes={NODE_TYPES}
            fitView
            onInit={(instance) => { reactFlowRef.current = instance; }}
            minZoom={0.15}
            maxZoom={1.8}
            onNodeClick={onNodeClick}
            onNodeMouseEnter={onNodeMouseEnter}
            onNodeMouseLeave={onNodeMouseLeave}
            onPaneClick={clearSelection}
            onSelectionChange={onSelectionChange}
          >
            <Background color="#d6d7d9" gap={22} />
            <Controls position="bottom-left" />
            {flowGraph.nodes.length > 8 ? <MiniMap pannable zoomable nodeStrokeWidth={3} /> : null}
          </ReactFlow>
        )}
      </section>

      {detailPanelVisible ? <aside className="detail-panel">
        {selectedViewNode?.dataFlow ? (
          <ViewNodeDetails
            node={selectedViewNode}
            annotations={selectedFlowAnnotations}
            actions={selectedFlowOwner && graph ? (
              <ValueActionsSlot
                ownerNode={selectedFlowOwner}
                graph={graph}
                flowNodeId={selectedViewNode.id}
                valueLabel={selectedViewNode.label}
                annotations={selectedFlowDirectAnnotations}
              />
            ) : undefined}
            onShowImpact={() => showImpactTarget(selectedViewNode.id)}
          />
        ) : selectedNode && graph ? (
          <NodeDetails
            graph={graph}
            node={selectedNode}
            viewNode={selectedViewNode}
            viewState={viewState}
            incoming={incomingEdges}
            outgoing={outgoingEdges}
            facts={facts}
            enrichment={enrichmentIndex.get(selectedNode.id) ?? []}
            selectedDataFlowTargetId={selectedDataFlowTargetId}
            onSelectDataFlowTarget={setSelectedDataFlowTargetId}
            onOpenDataFlowTarget={openDataFlowTarget}
            onViewNodeSource={openNodeSource}
            onViewEdgeUsage={openEdgeUsage}
            onViewEvidenceUsage={openEvidenceUsage}
            onShowImpact={showImpact}
            onTraceTag={traceIdentifier}
          />
        ) : graph && viewState.mode === "impact" && viewState.impactNodeId ? (
          <ImpactSummary
            graph={graph}
            flowQueries={flowQueries ?? undefined}
            targetId={viewState.impactNodeId}
            onSelectNode={setSelectedNode}
          />
        ) : selectedEdge ? (
          <EdgeDetails edge={selectedEdge} onViewEdgeUsage={openEdgeUsage} />
        ) : selectedViewNode ? (
          <ViewNodeDetails node={selectedViewNode} />
        ) : selectedViewEdge ? (
          <ViewEdgeDetails edge={selectedViewEdge} />
        ) : (
          <div className="empty-detail">
            <CircleDot size={20} aria-hidden="true" />
            <span>{t.noSelection}</span>
          </div>
        )}
      </aside> : null}

      {sourceModal ? (
        <SourceCodeModal {...sourceModal} onClose={() => setSourceModal(null)} />
      ) : null}

      {paletteOpen && graph ? (
        <CommandPalette
          entries={paletteEntries}
          onSelect={jumpToPaletteEntry}
          onClose={() => setPaletteOpen(false)}
        />
      ) : null}

      {showUnresolved ? (
        <UnresolvedPanel
          items={unresolved}
          onClose={() => setShowUnresolved(false)}
          onOpenSource={(fact) => void openEvidenceUsage(
            { file: fact.sourceFile, line: fact.location?.line },
            fact.name ?? fact.target ?? t.unresolvedTitle
          )}
        />
      ) : null}

      <GlobalWidgetsSlot />
    </main>
  );

  async function openNodeSource(node: ProjectMapNode) {
    try {
      const source = await fetchSource(`/api/source/node/${encodeURIComponent(node.id)}`);
      setSourceModal(sourceModalFromResponse(source, node.name));
    } catch (sourceError) {
      setSourceModal({
        title: node.name,
        file: node.file,
        language: "plaintext",
        content: "",
        error: sourceError instanceof Error ? sourceError.message : String(sourceError),
        onClose: () => setSourceModal(null),
      });
    }
  }

  async function openEdgeUsage(edge: ProjectMapEdge) {
    try {
      const source = await fetchSource(`/api/source/edge/${encodeURIComponent(edge.id)}`);
      setSourceModal(sourceModalFromResponse(source, `${t.btnViewUsage}: ${edge.type}`));
    } catch (sourceError) {
      setSourceModal({
        title: `${t.btnViewUsage}: ${edge.type}`,
        language: "plaintext",
        content: "",
        error: sourceError instanceof Error ? sourceError.message : String(sourceError),
        onClose: () => setSourceModal(null),
      });
    }
  }

  async function openEvidenceUsage(
    evidence: SourceLocation,
    title: string,
    options?: { context?: "function"; compact?: boolean }
  ) {
    try {
      const response = await fetch("/api/source/evidence", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          file: evidence.file,
          line: evidence.line,
          code: undefined,
          context: options?.context,
        }),
      });
      const body = await response.json() as SourceResponse | { error?: string; message?: string };
      if (!response.ok) {
        const message = "message" in body && body.message ? body.message : t.errCannotRead;
        throw new Error(message);
      }
      setSourceModal({
        ...sourceModalFromResponse(body as SourceResponse, title),
        compact: options?.compact,
        focusLine: evidence.line,
      });
    } catch (sourceError) {
      setSourceModal({
        title,
        file: evidence.file,
        language: "plaintext",
        content: "",
        error: sourceError instanceof Error ? sourceError.message : String(sourceError),
        onClose: () => setSourceModal(null),
      });
    }
  }

  function openTransformationCode(value: SymbolOverviewValue) {
    const transformation = value.transformation;
    const code = transformation?.code ?? transformation?.expression;
    if (!transformation || !code) return;
    const title = t.symbolTransformationCodeTitle.replace("{value}", value.name);
    setSourceModal({
      title,
      file: transformation.file,
      language: sourceLanguage(transformation.file),
      content: code,
      startLine: transformation.line,
      endLine: transformation.endLine,
      focusLine: transformation.expressionLine ?? transformation.line,
      compact: true,
      onClose: () => setSourceModal(null),
    });
  }

  function openStepCode(evidence: FlowEvidence, stepName: string) {
    if (!evidence.code) return;
    const startLine = evidence.codeStartLine ?? evidence.line;
    const endLine = startLine
      ? startLine + evidence.code.split("\n").length - 1
      : undefined;
    setSourceModal({
      title: t.flowStepCodeTitle.replace("{step}", stepName),
      file: evidence.file,
      language: sourceLanguage(evidence.file),
      content: evidence.code,
      startLine,
      endLine,
      focusLine: evidence.line,
      compact: true,
      onClose: () => setSourceModal(null),
    });
  }

  async function openPipelineNodeCode(node: SymbolPipelineNode) {
    const source = node.source;
    if (!source) return;
    const stepTitle = t.flowStepCodeTitle.replace("{step}", node.name);

    if (source.kind === "graph-node-context") {
      await openGraphNodeContext(source.graphNodeId, stepTitle);
      return;
    }

    if (source.kind === "thunk-call") {
      const dispatchEdges = graph?.edges.filter((edge) =>
        edge.type === "dispatchesAction" && edge.to === source.thunkNodeId
      ) ?? [];
      const dispatchEdge = dispatchEdges.find((edge) => edge.from === selectedUnit?.id)
        ?? dispatchEdges.find((edge) => pageTopologyNodeIds.includes(edge.from))
        ?? dispatchEdges[0];
      const dispatchEvidence = dispatchEdge?.evidence.find((entry) => Boolean(entry.code))
        ?? dispatchEdge?.evidence[0];
      if (dispatchEvidence) {
        await openEvidenceUsage(
          dispatchEvidence,
          stepTitle,
          { context: "function", compact: true }
        );
        return;
      }

      const thunkNode = graph?.nodes.find((entry) => entry.id === source.thunkNodeId);
      if (thunkNode) {
        await openNodeSource(thunkNode);
        return;
      }

      await openFlowContext(source.fallbackFlowNodeId, stepTitle);
      return;
    }

    if (source.kind === "transformation") {
      const value = symbolOverview?.values.find((entry) => entry.flowNodeId === source.flowNodeId);
      const transformation = value?.transformation;
      const focusLine = transformation?.expressionLine ?? transformation?.line;
      if (value && transformation?.file && focusLine) {
        await openEvidenceUsage(
          { file: transformation.file, line: focusLine },
          t.symbolTransformationCodeTitle.replace("{value}", value.name),
          { context: "function", compact: true }
        );
        return;
      }
      if (value && (transformation?.code ?? transformation?.expression)) {
        openTransformationCode(value);
        return;
      }
      await openFlowContext(source.flowNodeId, stepTitle);
      return;
    }

    if (source.kind === "state-write") {
      const writeEdges = flowIndex?.edges.filter((edge) =>
        edge.to === source.flowNodeId && edge.relation === "writes"
      ) ?? [];
      const handlerEvidence = writeEdges
        .flatMap((edge) => flowIndex?.nodes.find((entry) => entry.id === edge.from)?.evidence ?? [])
        .find((entry) => Boolean(entry.code));
      if (handlerEvidence) {
        openStepCode(handlerEvidence, node.name);
        return;
      }
      const writeEvidence = writeEdges.flatMap((edge) => edge.evidence)[0];
      if (writeEvidence) {
        await openEvidenceUsage(writeEvidence, stepTitle, { context: "function", compact: true });
        return;
      }
      await openFlowContext(source.flowNodeId, stepTitle);
      return;
    }

    if (source.kind === "lifecycle-handler") {
      const handlerEvidence = flowNodeEvidence(source.flowNodeId).find((entry) => Boolean(entry.code));
      if (handlerEvidence) {
        openStepCode(handlerEvidence, node.name);
        return;
      }
      await openFlowContext(source.flowNodeId, stepTitle);
      return;
    }

    if (source.kind === "selector-definition") {
      const selectorEvidence = flowNodeEvidence(source.flowNodeId);
      const definitionEvidence = selectorEvidence.find((entry) =>
        isSelectorDeclaration(entry.code, node.name)
      ) ?? selectorEvidence[0];
      if (definitionEvidence) {
        await openEvidenceUsage(definitionEvidence, stepTitle, { context: "function", compact: true });
        return;
      }
      if (source.graphNodeId) {
        await openGraphNodeContext(source.graphNodeId, stepTitle);
        return;
      }
      await openFlowContext(source.flowNodeId, stepTitle);
      return;
    }

    if (source.kind === "api-call" || source.kind === "flow-context") {
      await openFlowContext(source.flowNodeId, stepTitle);
    }
  }

  function flowNodeEvidence(flowNodeId: string): FlowEvidence[] {
    return flowIndex?.nodes.find((entry) => entry.id === flowNodeId)?.evidence ?? [];
  }

  function isSelectorDeclaration(code: string | undefined, selectorName: string) {
    if (!code) return false;
    return code.includes(`const ${selectorName}`) ||
      code.includes(`let ${selectorName}`) ||
      code.includes(`var ${selectorName}`) ||
      code.includes(`function ${selectorName}`) ||
      code.includes(`${selectorName} =`);
  }

  function flowEvidenceWithIncoming(flowNodeId: string): FlowEvidence[] {
    return [
      ...flowNodeEvidence(flowNodeId),
      ...(flowIndex?.edges
        .filter((edge) => edge.to === flowNodeId)
        .flatMap((edge) => edge.evidence) ?? []),
    ];
  }

  async function openFlowContext(flowNodeId: string, title: string) {
    const evidence = flowEvidenceWithIncoming(flowNodeId)[0];
    if (evidence) {
      await openEvidenceUsage(evidence, title, { context: "function", compact: true });
      return;
    }

    const flowNode = flowIndex?.nodes.find((entry) => entry.id === flowNodeId);
    if (flowNode?.ownerNodeId) {
      await openGraphNodeContext(flowNode.ownerNodeId, title);
      return;
    }
    showPipelineSourceError(title);
  }

  async function openGraphNodeContext(graphNodeId: string, title: string) {
    const declarationEvidence = graph?.edges
      .filter((edge) => edge.from === graphNodeId && edge.type === "definedIn")
      .flatMap((edge) => edge.evidence)[0];
    if (declarationEvidence) {
      await openEvidenceUsage(declarationEvidence, title, { context: "function", compact: true });
      return;
    }

    const graphNode = graph?.nodes.find((entry) => entry.id === graphNodeId);
    if (graphNode) {
      await openNodeSource(graphNode);
      return;
    }
    showPipelineSourceError(title);
  }

  function showPipelineSourceError(title: string) {
    setSourceModal({
      title,
      language: "plaintext",
      content: "",
      error: t.errCannotRead,
      onClose: () => setSourceModal(null),
    });
  }

  function showImpact(node: ProjectMapNode) {
    showImpactTarget(node.id);
  }

  function showImpactTarget(targetId: string) {
    setViewState((current) => openImpact(current, targetId));
    // Clear selection so the side panel shows the impact roll-up, not the target.
    setSelectedNode(null);
    setSelectedViewNode(null);
    setSelectedViewEdge(null);
    setSelectedEdge(null);
  }

  function openDataFlowTarget(targetNodeId: string) {
    if (!graph) return;
    const targetNode = graph.nodes.find((node) => node.id === targetNodeId);
    if (!targetNode) return;
    setSelectedViewNode(null);
    setSelectedNode(targetNode);
    setSelectedViewEdge(null);
    setSelectedEdge(null);
    setSelectedDataFlowTargetId(undefined);
  }

  function selectDataFlowTargetViewNode(viewNode: ViewGraphNode) {
    if (!graph || !viewState.inspectedNodeId) return false;
    const inspectedNode = graph.nodes.find((entry) => entry.id === viewState.inspectedNodeId) ?? null;
    if (!inspectedNode) return false;

    setSelectedViewNode(viewNode);
    setSelectedNode(inspectedNode);
    setSelectedViewEdge(null);
    setSelectedEdge(null);
    setSelectedDataFlowTargetId(dataFlowTargetIdFromViewNode(viewNode));
    return true;
  }

  function selectViewNode(viewNode: ViewGraphNode) {
    setSelectedViewNode(viewNode);
    setSelectedNode(viewNode.sourceNode ?? null);
    setSelectedViewEdge(null);
    setSelectedEdge(null);
    setSelectedDataFlowTargetId(undefined);
  }

  function selectViewEdge(viewEdge: ViewGraphEdge) {
    setSelectedViewNode(null);
    setSelectedNode(null);
    setSelectedViewEdge(viewEdge);
    setSelectedEdge(viewEdge.sourceEdge ?? null);
    setSelectedDataFlowTargetId(undefined);
  }

  function clearSelection() {
    setSelectedViewNode(null);
    setSelectedNode(null);
    setSelectedViewEdge(null);
    setSelectedEdge(null);
    setSelectedDataFlowTargetId(undefined);
  }
}

function sourceLanguage(file: string | undefined): string {
  if (!file) return "typescript";
  if (/\.tsx?$/.test(file)) return "typescript";
  if (/\.jsx?$/.test(file)) return "javascript";
  if (/\.json$/.test(file)) return "json";
  return "plaintext";
}
