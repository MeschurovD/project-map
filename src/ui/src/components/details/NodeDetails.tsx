import { FileCode2, Radar } from "lucide-react";
import type { ProjectMapEdge, ProjectMapGraph, ProjectMapNode } from "../../../../graph/types.js";
import type { MergedNodeEnrichment } from "../../../../modules/enrichmentTypes.js";
import type { ProjectFact } from "../../../../scanner/facts.js";
import type { SourceLocation } from "../../../../analyzers/value-flow/types.js";
import { collectDirectPageComposition } from "../../../graph-view/collectDirectPageComposition.js";
import { collectNodeInternals } from "../../../graph-view/collectNodeInternals.js";
import type { GraphViewState, ViewGraphNode } from "../../../graph-view/viewTypes.js";
import { useT } from "../../i18n.js";
import { canViewNodeSource } from "../../source/sourceClient.js";
import { NodeDetailsSlot } from "../../slots/NodeDetailsSlot.js";
import { KeyValues } from "../primitives.js";
import { NodeList } from "../NodeList.js";
import { SourceViewerButton } from "../source/SourceViewerButton.js";
import { DataFlowDetails } from "./DataFlowDetails.js";
import { EnrichmentMarkdown } from "./EnrichmentMarkdown.js";
import { DebugEdges, PageFocusEvidence } from "./EdgeViews.js";

export function NodeDetails(props: {
  graph: ProjectMapGraph;
  node: ProjectMapNode;
  viewNode: ViewGraphNode | null;
  viewState: GraphViewState;
  incoming: ProjectMapEdge[];
  outgoing: ProjectMapEdge[];
  facts: ProjectFact[];
  enrichment?: MergedNodeEnrichment[];
  selectedDataFlowTargetId?: string;
  onSelectDataFlowTarget: (targetId: string | undefined) => void;
  onOpenDataFlowTarget: (targetNodeId: string) => void;
  onViewNodeSource: (node: ProjectMapNode) => void;
  onViewEdgeUsage: (edge: ProjectMapEdge) => void;
  onViewEvidenceUsage: (evidence: SourceLocation, title: string) => void;
  onShowImpact: (node: ProjectMapNode) => void;
  onTraceTag?: (tag: string) => void;
}) {
  const t = useT();

  if (props.node.type === "page") {
    return (
      <PageNodeDetails
        graph={props.graph}
        node={props.node}
        incoming={props.incoming}
        outgoing={props.outgoing}
        enrichment={props.enrichment}
        onViewNodeSource={props.onViewNodeSource}
        onViewEdgeUsage={props.onViewEdgeUsage}
        onTraceTag={props.onTraceTag}
      />
    );
  }

  const internals = collectNodeInternals(props.graph, props.node.id, {
    showFiles: props.viewState.showFiles,
    showImports: props.viewState.showImports,
    showUnknown: props.viewState.showUnknown,
  });
  const containedNodes = props.node.type === "entity" ? collectContainedSemanticNodes(props.graph, props.node) : [];

  return (
    <div className="detail-stack">
      <div className="detail-title">
        <FileCode2 size={18} aria-hidden="true" />
        <div>
          <h2>{props.node.name}</h2>
          <span>{props.node.type}</span>
        </div>
      </div>
      <KeyValues
        values={[
          [t.keyFile, props.node.file],
          [t.keyLayer, props.node.fsd?.layer],
          [t.keySlice, props.node.fsd?.slice],
          [t.keySegment, props.node.fsd?.segment],
          [t.keyId, props.node.id],
        ]}
      />
      <SourceActions
        canViewSource={canViewNodeSource(props.graph, props.node)}
        onViewSource={() => props.onViewNodeSource(props.node)}
        onShowImpact={() => props.onShowImpact(props.node)}
      />
      <EnrichmentDetails enrichment={props.enrichment} onTraceTag={props.onTraceTag} />
      <NodeDetailsSlot node={props.node} graph={props.graph} />
      <PageFocusEvidence
        graph={props.graph}
        edges={props.viewNode?.reasonEdges ?? []}
        onViewEdgeUsage={props.onViewEdgeUsage}
      />
      <DataFlowDetails
        graph={props.graph}
        node={props.node}
        facts={props.facts}
        selectedDataFlowTargetId={props.selectedDataFlowTargetId}
        onSelectDataFlowTarget={props.onSelectDataFlowTarget}
        onOpenDataFlowTarget={props.onOpenDataFlowTarget}
        onViewEvidenceUsage={props.onViewEvidenceUsage}
      />
      <SummaryGrid
        metrics={[
          [t.sumRenders, internals.renderedComponents.length],
          [t.sumHooks, internals.hooks.length],
          [t.sumSelectors, internals.selectors.length],
          [t.sumActions, internals.actions.length],
          [t.sumApi, internals.apiCalls.length],
          [t.sumDeps, internals.fsdDependencies.length],
        ]}
      />
      <NodeList title={t.listWidgets} nodes={internals.renderedComponents} graph={props.graph} onViewNodeSource={props.onViewNodeSource} />
      <NodeList title={t.listHooks} nodes={internals.hooks} graph={props.graph} onViewNodeSource={props.onViewNodeSource} />
      <NodeList title={t.listSelectors} nodes={internals.selectors} graph={props.graph} onViewNodeSource={props.onViewNodeSource} />
      <NodeList title={t.listActions} nodes={internals.actions} graph={props.graph} onViewNodeSource={props.onViewNodeSource} />
      <NodeList title={t.listApiCalls} nodes={internals.apiCalls} graph={props.graph} onViewNodeSource={props.onViewNodeSource} />
      <NodeList title={t.listFsdDeps} nodes={internals.fsdDependencies} graph={props.graph} onViewNodeSource={props.onViewNodeSource} />
      <NodeList title={t.listContains} nodes={containedNodes} graph={props.graph} onViewNodeSource={props.onViewNodeSource} />
      <NodeList title={t.listUsedBy} nodes={internals.usedBy} graph={props.graph} onViewNodeSource={props.onViewNodeSource} />
      <DebugEdges incoming={props.incoming} outgoing={props.outgoing} onViewEdgeUsage={props.onViewEdgeUsage} />
    </div>
  );
}

function PageNodeDetails(props: {
  graph: ProjectMapGraph;
  node: ProjectMapNode;
  incoming: ProjectMapEdge[];
  outgoing: ProjectMapEdge[];
  enrichment?: MergedNodeEnrichment[];
  onViewNodeSource: (node: ProjectMapNode) => void;
  onViewEdgeUsage: (edge: ProjectMapEdge) => void;
  onTraceTag?: (tag: string) => void;
}) {
  const t = useT();
  const composition = collectDirectPageComposition(props.graph, props.node.id);

  return (
    <div className="detail-stack">
      <div className="detail-title">
        <FileCode2 size={18} aria-hidden="true" />
        <div>
          <h2>{props.node.name}</h2>
          <span>{props.node.type}</span>
        </div>
      </div>
      <KeyValues
        values={[
          [t.keyFile, props.node.file],
          [t.keyLayer, props.node.fsd?.layer],
          [t.keySlice, props.node.fsd?.slice],
          [t.keyId, props.node.id],
        ]}
      />
      <SourceActions
        canViewSource={canViewNodeSource(props.graph, props.node)}
        onViewSource={() => props.onViewNodeSource(props.node)}
      />
      <EnrichmentDetails enrichment={props.enrichment} onTraceTag={props.onTraceTag} />
      <NodeDetailsSlot node={props.node} graph={props.graph} />
      <section className="semantic-section">
        <h3>{t.secComposition}</h3>
        <SummaryGrid
          metrics={[
            [t.sumWidgets, composition.widgets.length],
            [t.sumFeatures, composition.features.length],
            [t.sumSelectors, composition.selectors.length],
            [t.sumHooks, composition.hooks.length],
          ]}
        />
      </section>
      <NodeList title={t.listWidgets} nodes={composition.widgets} graph={props.graph} onViewNodeSource={props.onViewNodeSource} />
      <NodeList title={t.listFeatures} nodes={composition.features} graph={props.graph} onViewNodeSource={props.onViewNodeSource} />
      <NodeList title={t.listEntities} nodes={composition.entities} graph={props.graph} onViewNodeSource={props.onViewNodeSource} />
      <NodeList title={t.listSelectors} nodes={composition.selectors} graph={props.graph} onViewNodeSource={props.onViewNodeSource} />
      <NodeList title={t.listHooks} nodes={composition.hooks} graph={props.graph} onViewNodeSource={props.onViewNodeSource} />
      <DebugEdges incoming={props.incoming} outgoing={props.outgoing} onViewEdgeUsage={props.onViewEdgeUsage} />
    </div>
  );
}

// Module overlay for the selected node: badges, summaries and extra sections
// from GET /api/enrichment. Section markdown is rendered as lists/paragraphs
// with identifier tags as chips (see EnrichmentMarkdown).
function EnrichmentDetails(props: { enrichment?: MergedNodeEnrichment[]; onTraceTag?: (tag: string) => void }) {
  const t = useT();
  const entries = props.enrichment ?? [];
  const badges = entries.flatMap((entry) =>
    (entry.badges ?? []).map((badge) => ({ ...badge, moduleId: entry.moduleId }))
  );
  const summaries = entries.filter((entry) => entry.summary);
  const sections = entries.flatMap((entry) =>
    (entry.sections ?? []).map((section) => ({ ...section, moduleId: entry.moduleId }))
  );

  if (badges.length === 0 && summaries.length === 0 && sections.length === 0) return null;

  return (
    <section className="semantic-section enrichment-details">
      <h3>{t.secModuleInsights}</h3>
      {badges.length > 0 ? (
        <div className="enrichment-badges">
          {badges.map((badge) => (
            <span
              key={`${badge.moduleId}:${badge.id}`}
              className={`enrichment-badge enrichment-badge-${badge.tone ?? "info"}`}
              title={badge.moduleId}
            >
              {badge.label}
            </span>
          ))}
        </div>
      ) : null}
      {summaries.map((entry) => (
        <p key={entry.moduleId} className="enrichment-summary">{entry.summary}</p>
      ))}
      {sections.map((section) => (
        <details key={`${section.moduleId}:${section.id}`} className="enrichment-section">
          <summary>{section.title}</summary>
          <EnrichmentMarkdown markdown={section.markdown} onTagClick={props.onTraceTag} />
        </details>
      ))}
    </section>
  );
}

function SourceActions(props: {
  canViewSource: boolean;
  onViewSource: () => void;
  onShowImpact?: () => void;
}) {
  const t = useT();
  return (
    <div className="source-actions">
      <SourceViewerButton
        disabled={!props.canViewSource}
        title={props.canViewSource ? undefined : t.tipNoSourceFile}
        onClick={props.onViewSource}
      />
      {props.onShowImpact ? (
        <button type="button" onClick={props.onShowImpact}>
          <Radar size={15} aria-hidden="true" />
          <span>{t.btnImpact}</span>
        </button>
      ) : null}
    </div>
  );
}

function SummaryGrid(props: { metrics: Array<[string, number]> }) {
  const visibleMetrics = props.metrics.filter(([, value]) => value > 0);
  if (visibleMetrics.length === 0) return null;

  return (
    <div className="summary-grid">
      {visibleMetrics.map(([label, value]) => (
        <div key={label} className="summary-metric">
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function collectContainedSemanticNodes(graph: ProjectMapGraph, node: ProjectMapNode) {
  const semanticTypes = new Set<ProjectMapNode["type"]>([
    "component",
    "hook",
    "selector",
    "action",
    "api",
    "slice-model",
  ]);
  const layer = node.fsd?.layer;
  const slice = node.fsd?.slice ?? node.name;

  if (!layer || !slice) return [];

  return graph.nodes
    .filter((candidate) =>
      candidate.id !== node.id &&
      semanticTypes.has(candidate.type) &&
      candidate.fsd?.layer === layer &&
      (candidate.fsd?.slice === slice || candidate.id.includes(`:${slice}`))
    )
    .sort((left, right) => left.name.localeCompare(right.name));
}
