import { createContext, useContext, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowRight,
  Box,
  Braces,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Component,
  Database,
  FileCode2,
  Filter,
  GitBranch,
  GitMerge,
  Globe2,
  SquareFunction,
  UsersRound,
  Variable,
  Zap,
} from "lucide-react";
import type {
  SymbolFlowStory,
  SymbolOverview,
  SymbolOverviewValue,
} from "../../../flow/buildSymbolOverview.js";
import { useT, type T } from "../i18n.js";
import {
  symbolOwnerPipelineNode,
  symbolOriginTopology,
  symbolPipelineNodes,
  symbolStepLabel,
  symbolValuePipelineNode,
  uniquePipelineNodes,
  type SymbolOriginOperation,
  type SymbolOriginTopology,
  type SymbolPipelineNode,
} from "../symbolPresentation.js";

type OpenPipelineNodeCode = (node: SymbolPipelineNode) => void | Promise<void>;

const PipelineNodeCodeContext = createContext<OpenPipelineNodeCode | undefined>(undefined);

export function SymbolOverviewScreen(props: {
  overview: SymbolOverview;
  onOpenFlow: (flowId: string) => void;
  onOpenTransformationCode: (value: SymbolOverviewValue) => void | Promise<void>;
  onOpenPipelineNodeCode: OpenPipelineNodeCode;
  renderValueDocumentation?: (value: SymbolOverviewValue) => ReactNode;
}) {
  const t = useT();
  const stats = props.overview.stats;
  const allTraced = stats.resultsCount > 0 && stats.tracedResultsCount === stats.resultsCount;

  return (
    <PipelineNodeCodeContext.Provider value={props.onOpenPipelineNodeCode}>
      <div className="symbol-overview-screen" data-symbol-tab="overview">
        <div className="symbol-fact-line">
          <strong>{behaviorLabel(props.overview, t)}</strong>
          <span>{stats.dependenciesCount} {t.symbolDependencies}</span>
          <span>{stats.resultsCount} {t.symbolResults}</span>
          <span>{stats.consumersCount} {t.symbolUsagePlaces}</span>
          <span className={allTraced ? "is-complete" : "is-partial"}>
            {allTraced
              ? t.symbolAllTraced
              : t.symbolTracedOf
                .replace("{traced}", String(stats.tracedResultsCount))
                .replace("{total}", String(stats.resultsCount))}
          </span>
        </div>

        <section className="symbol-story-section">
          <div className="symbol-section-heading">
            <div>
              <span>{t.symbolAnalysisAnswer}</span>
              <h2>{props.overview.symbolType === "hook" ? t.symbolMainFlows : t.symbolUiComposition}</h2>
              <p>{props.overview.symbolType === "hook" ? t.symbolMainFlowsHint : t.symbolUiCompositionHint}</p>
            </div>
            <strong>{props.overview.stories.length}</strong>
          </div>
          {props.overview.stories.length > 0 ? (
            <div className="symbol-story-list">
              {props.overview.stories.map((story) => (
                <FlowStoryCard
                  key={story.id}
                  story={story}
                  symbolId={props.overview.symbolId}
                  symbolName={props.overview.symbolName}
                  symbolType={props.overview.symbolType}
                  onOpenFlow={props.onOpenFlow}
                  onOpenTransformationCode={props.onOpenTransformationCode}
                  renderValueDocumentation={props.renderValueDocumentation}
                  t={t}
                />
              ))}
            </div>
          ) : (
            <div className="product-empty"><strong>{t.symbolNoStories}</strong></div>
          )}
        </section>
      </div>
    </PipelineNodeCodeContext.Provider>
  );
}

function FlowStoryCard(props: {
  story: SymbolFlowStory;
  symbolId: string;
  symbolName: string;
  symbolType: SymbolOverview["symbolType"];
  onOpenFlow: (flowId: string) => void;
  onOpenTransformationCode: (value: SymbolOverviewValue) => void | Promise<void>;
  renderValueDocumentation?: (value: SymbolOverviewValue) => ReactNode;
  t: T;
}) {
  const targetConsumers = props.story.downstreamConsumers.length > 0
    ? props.story.downstreamConsumers
    : props.story.directConsumers;
  return (
    <article className="symbol-story-card">
      <header>
        <div>
          <small>{props.t.symbolFlowTo}</small>
          <h3>{props.story.consumerName ?? props.t.symbolConsumerUnknown}</h3>
        </div>
        <span className={props.story.traced ? "is-complete" : "is-partial"}>
          {props.story.traced ? <CheckCircle2 size={14} aria-hidden="true" /> : <CircleAlert size={14} aria-hidden="true" />}
          {props.story.traced ? props.t.symbolTraceComplete : props.t.symbolTracePartial}
        </span>
      </header>
      <div className="symbol-story-values">
        {props.story.outputs.map((output) => (
          <StoryValueCard
            key={output.id}
            value={output}
            story={props.story}
            symbolId={props.symbolId}
            symbolName={props.symbolName}
            symbolType={props.symbolType}
            onOpenFlow={props.onOpenFlow}
            onOpenTransformationCode={props.onOpenTransformationCode}
            renderValueDocumentation={props.renderValueDocumentation}
            t={props.t}
          />
        ))}
      </div>
      <footer>
        <span>{props.story.outputs.length} {props.t.symbolResults}</span>
        <span>{targetConsumers.length} {props.t.symbolUsagePlaces}</span>
        {props.story.issueCount > 0 ? <span className="has-issues">{props.story.issueCount} {props.t.traceIssuesLabel}</span> : null}
      </footer>
    </article>
  );
}

function StoryValueCard(props: {
  value: SymbolOverviewValue;
  story: SymbolFlowStory;
  symbolId: string;
  symbolName: string;
  symbolType: SymbolOverview["symbolType"];
  onOpenFlow: (flowId: string) => void;
  onOpenTransformationCode: (value: SymbolOverviewValue) => void | Promise<void>;
  renderValueDocumentation?: (value: SymbolOverviewValue) => ReactNode;
  t: T;
}) {
  const [originExpanded, setOriginExpanded] = useState(false);
  const storyConsumers = props.value.downstreamConsumers.filter((consumer) =>
    (consumer.ownerNodeId ?? consumer.id) === (props.story.consumerId ?? "unresolved")
  );
  const downstream = storyConsumers.length > 0 ? storyConsumers : props.value.downstreamConsumers;
  const ownerPipelineNode = symbolOwnerPipelineNode(
    props.symbolId,
    props.symbolType,
    props.symbolName
  );
  const valuePipelineNode = symbolValuePipelineNode(props.value);
  const originTopology = symbolOriginTopology(
    props.value.origin,
    props.value.originEdges,
    { targetName: props.value.name }
  );
  const shortOriginNodes = uniquePipelineNodes(props.value.originSummary.flatMap(symbolPipelineNodes));
  const terminalNodes = [ownerPipelineNode, valuePipelineNode];
  return (
    <article className="symbol-story-value" data-symbol-story-value={props.value.name}>
      <header>
        <div className="symbol-value-heading">
          <div className="symbol-value-title-line">
            <strong>{props.value.name}</strong>
            {props.value.valueType ? (
              <code title={props.value.valueType}>{compactTypeLabel(props.value.valueType)}</code>
            ) : null}
          </div>
          <span className="symbol-value-role-line">
            <span className={`symbol-value-role-tag role-${props.value.role}`}>
              {valueRoleLabel(props.value, props.t)}
            </span>
            {props.value.transformation?.code ?? props.value.transformation?.expression ? (
              <button
                type="button"
                onClick={() => void props.onOpenTransformationCode(props.value)}
              >
                <FileCode2 size={11} aria-hidden="true" />
                {props.t.symbolTransformationCode}
              </button>
            ) : null}
          </span>
        </div>
        <span className={props.value.traced ? "is-complete" : "is-partial"}>
          {props.value.traced
            ? <CheckCircle2 size={12} aria-hidden="true" />
            : <CircleAlert size={12} aria-hidden="true" />}
          {props.value.traced ? props.t.symbolTraceComplete : props.t.symbolTracePartial}
        </span>
      </header>
      {props.renderValueDocumentation ? (
        <div
          className="symbol-story-value-documentation"
          data-symbol-overview-value-docs={props.value.name}
        >
          {props.renderValueDocumentation(props.value)}
        </div>
      ) : null}
      <div className="symbol-story-value-body">
        <OriginPipeline
          label={props.t.symbolValueOrigin}
          topology={originTopology}
          fallbackShortNodes={shortOriginNodes}
          terminalNodes={terminalNodes}
          expanded={originExpanded}
          onToggle={() => setOriginExpanded((expanded) => !expanded)}
          t={props.t}
        />
        <div className="symbol-value-details-grid">
          <ValueTransformation value={props.value} t={props.t} />
          <div className="symbol-value-consumers">
            <div className="symbol-value-panel-heading">
              <span><UsersRound size={16} aria-hidden="true" /></span>
              <strong>{props.t.symbolTabConsumers}</strong>
            </div>
            <div className="symbol-value-consumer-groups">
              <ValuePipeline
                label={props.t.symbolDirectConsumers}
                nodes={uniquePipelineNodes(props.value.directConsumers.flatMap(symbolPipelineNodes))}
                empty={props.t.symbolNoDirectConsumers}
              />
              <ValuePipeline
                label={props.t.symbolDownstreamConsumers}
                nodes={uniquePipelineNodes(downstream.flatMap(symbolPipelineNodes))}
                empty={props.t.symbolNoDownstreamConsumers}
              />
            </div>
          </div>
        </div>
      </div>
      <footer>
        <span className={props.value.issueCount > 0 ? "has-issues" : "is-complete"}>
          {props.value.issueCount > 0
            ? <CircleAlert size={14} aria-hidden="true" />
            : <CheckCircle2 size={14} aria-hidden="true" />}
          {props.value.issueCount > 0
            ? `${props.value.issueCount} ${props.t.traceIssuesLabel}`
            : props.t.symbolValueNoIssues}
        </span>
        <button type="button" onClick={() => props.onOpenFlow(props.value.flowId)}>
          {props.t.unitTrace} <ArrowRight size={14} aria-hidden="true" />
        </button>
      </footer>
    </article>
  );
}

function ValueTransformation(props: { value: SymbolOverviewValue; t: T }) {
  const transformation = props.value.transformation;
  const inputs = transformation?.inputPaths.length
    ? transformation.inputPaths
    : transformation?.kind === "constant" && transformation.expression
      ? [transformation.expression]
      : props.value.inputs.map((step) => symbolStepLabel(step, props.t));
  const result = transformation
    ? transformationLabel(transformation.kind, transformation.operation, props.t)
    : props.t.symbolValueNoTransformation;

  return (
    <div className="symbol-value-transformation">
      <div className="symbol-value-panel-heading">
        <span><Box size={16} aria-hidden="true" /></span>
        <strong>{props.t.symbolValueTransformation}</strong>
      </div>
      <div className="symbol-value-transformation-content">
        {inputs.map((input, index) => (
          <span key={`${input}:${index}`}>
            {index > 0 ? <b aria-hidden="true">+</b> : null}
            <strong>{input}</strong>
          </span>
        ))}
        {inputs.length > 0 ? <ArrowRight size={11} aria-hidden="true" /> : null}
        <em title={transformation?.expression}>{result}</em>
      </div>
    </div>
  );
}

function ValuePipeline(props: {
  label: string;
  nodes: SymbolPipelineNode[];
  empty?: string;
  primary?: boolean;
}) {
  return (
    <div className={`symbol-value-pipeline${props.primary ? " is-primary" : ""}`}>
      <div className="symbol-value-journey-heading">
        <small>{props.label}</small>
      </div>
      <PipelineTrack nodes={props.nodes} empty={props.empty} />
    </div>
  );
}

function OriginPipeline(props: {
  label: string;
  topology: SymbolOriginTopology;
  fallbackShortNodes: SymbolPipelineNode[];
  terminalNodes: SymbolPipelineNode[];
  expanded: boolean;
  onToggle: () => void;
  t: T;
}) {
  const hasOperationTopology = props.topology.operations.length > 0;
  const canExpand = hasOperationTopology || props.topology.unassigned.length > props.fallbackShortNodes.length;
  return (
    <div className="symbol-value-pipeline is-primary" data-origin-expanded={props.expanded}>
      <div className="symbol-value-journey-heading">
        <span className="symbol-value-panel-heading">
          <span><GitBranch size={16} aria-hidden="true" /></span>
          <strong>{props.label}</strong>
        </span>
        {canExpand ? (
          <button type="button" aria-expanded={props.expanded} onClick={props.onToggle}>
            {props.expanded ? props.t.symbolHideFullOrigin : props.t.symbolShowFullOrigin}
            {props.expanded
              ? <ChevronUp size={11} aria-hidden="true" />
              : <ChevronDown size={11} aria-hidden="true" />}
          </button>
        ) : null}
      </div>
      {props.expanded ? (
        <OriginTopologyView
          topology={props.topology}
          terminalNodes={props.terminalNodes}
          t={props.t}
        />
      ) : (
        <OriginShortView
          topology={props.topology}
          fallbackNodes={props.fallbackShortNodes}
          terminalNodes={props.terminalNodes}
          t={props.t}
        />
      )}
    </div>
  );
}

function OriginShortView(props: {
  topology: SymbolOriginTopology;
  fallbackNodes: SymbolPipelineNode[];
  terminalNodes: SymbolPipelineNode[];
  t: T;
}) {
  if (props.topology.operations.length === 0) {
    return <PipelineTrack nodes={uniquePipelineNodes([...props.fallbackNodes, ...props.terminalNodes])} />;
  }
  return (
    <div className="symbol-origin-short">
      <div className="symbol-origin-short-branches">
        {props.topology.operations.map((operation) => (
          <PipelineNodeCard key={operation.id} node={operation.thunk} expanded />
        ))}
      </div>
      <div className="symbol-origin-short-merge">
        {props.topology.operations.length > 1
          ? <GitMerge size={14} aria-hidden="true" />
          : <ArrowRight size={13} aria-hidden="true" />}
        {props.topology.operations.length > 1 ? (
          <span>{props.t.symbolOriginParallel.replace("{count}", String(props.topology.operations.length))}</span>
        ) : null}
      </div>
      <PipelineTrack nodes={props.terminalNodes} expandedCards />
    </div>
  );
}

function OriginTopologyView(props: {
  topology: SymbolOriginTopology;
  terminalNodes: SymbolPipelineNode[];
  t: T;
}) {
  return (
    <div className="symbol-origin-topology" data-origin-topology="branches">
      {props.topology.operations.length > 0 ? (
        <div className="symbol-origin-operation-grid">
          {props.topology.operations.map((operation, index) => (
            <OriginOperationCard
              key={operation.id}
              operation={operation}
              index={index}
              t={props.t}
            />
          ))}
        </div>
      ) : null}
      {props.topology.unassigned.length > 0 ? (
        <section className="symbol-origin-unassigned">
          <header><strong>{props.t.symbolOriginOther}</strong></header>
          <div>
            {props.topology.unassigned.map((node) => <PipelineNodeCard key={node.id} node={node} expanded />)}
          </div>
        </section>
      ) : null}
      <div className="symbol-origin-terminal">
        <div>
          {props.topology.operations.length > 1 ? <GitMerge size={14} aria-hidden="true" /> : <ArrowDown size={13} aria-hidden="true" />}
          <span>{props.topology.operations.length > 1
            ? props.t.symbolOriginMerge
            : props.t.symbolOriginResult}</span>
        </div>
        <PipelineTrack nodes={props.terminalNodes} expandedCards />
      </div>
    </div>
  );
}

function OriginOperationCard(props: {
  operation: SymbolOriginOperation;
  index: number;
  t: T;
}) {
  return (
    <section className="symbol-origin-operation" data-origin-operation={props.operation.thunk.name}>
      <header>
        <span>{props.index + 1}</span>
        <strong>{props.t.symbolOriginSource} {props.index + 1}</strong>
      </header>
      <div className="symbol-origin-operation-thunk">
        <PipelineNodeCard node={props.operation.thunk} expanded />
      </div>
      {props.operation.lifecycles.length > 0 ? (
        <>
          <div className="symbol-origin-source-arrow"><ArrowDown size={14} aria-hidden="true" /></div>
          <div className="symbol-origin-lifecycles">
            {props.operation.lifecycles.length > 1 ? <small>{props.t.symbolOriginLifecycles}</small> : null}
            <div>
              {props.operation.lifecycles.map((lifecycle) => (
                <section key={lifecycle.id} className="symbol-origin-lifecycle" data-origin-lifecycle={lifecycle.action.name}>
                  {lifecycle.apis.length > 0 ? (
                    <div className="symbol-origin-lifecycle-inputs">
                      <div className={`symbol-origin-api-branches${lifecycle.apis.length > 1 ? " is-parallel" : ""}`}>
                        {lifecycle.apis.map((api) => (
                          <span className="symbol-origin-api-branch" key={api.id}>
                            <PipelineNodeCard node={api} expanded />
                          </span>
                        ))}
                      </div>
                      <OriginMergeMarker count={lifecycle.apis.length} />
                    </div>
                  ) : null}
                  <PipelineNodeCard node={lifecycle.action} expanded />
                  {lifecycle.stateBranches.length > 0 ? (
                    <>
                      <ArrowDown className="symbol-origin-lifecycle-arrow" size={13} aria-hidden="true" />
                      <div className="symbol-origin-state-branches">
                        {lifecycle.stateBranches.map((branch) => (
                          <PipelineTrack
                            key={branch.state.id}
                            nodes={[branch.state, ...branch.selectors]}
                            direction="vertical"
                            expandedCards
                          />
                        ))}
                      </div>
                    </>
                  ) : null}
                </section>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}

function OriginMergeMarker(props: { count: number }) {
  return (
    <div className="symbol-origin-operation-merge">
      {props.count > 1 ? <GitMerge size={13} aria-hidden="true" /> : <ArrowDown size={13} aria-hidden="true" />}
    </div>
  );
}

function PipelineTrack(props: {
  nodes: SymbolPipelineNode[];
  empty?: string;
  direction?: "horizontal" | "vertical";
  expandedCards?: boolean;
}) {
  const vertical = props.direction === "vertical";
  return (
    <div className={`symbol-value-pipeline-track${vertical ? " is-vertical" : ""}`}>
      {props.nodes.length > 0
        ? props.nodes.map((node, index) => (
          <span className="symbol-value-pipeline-item" key={`${node.id}:${index}`}>
            {index > 0
              ? vertical
                ? <ArrowDown className="symbol-value-pipeline-arrow" size={12} aria-hidden="true" />
                : <ArrowRight className="symbol-value-pipeline-arrow" size={12} aria-hidden="true" />
              : null}
            <PipelineNodeCard node={node} expanded={props.expandedCards} />
          </span>
        ))
        : <span>{props.empty ?? "—"}</span>}
    </div>
  );
}

function PipelineNodeCard(props: { node: SymbolPipelineNode; expanded?: boolean }) {
  const onOpenCode = useContext(PipelineNodeCodeContext);
  const content = (
    <>
      <em>{props.node.type}</em>
      <strong>{props.node.name}</strong>
    </>
  );
  const className = `symbol-value-pipeline-node type-${props.node.type.toLowerCase()}${props.expanded ? " is-expanded" : ""}`;
  const renderedContent = props.expanded ? (
    <>
      <span className="symbol-value-pipeline-icon">{pipelineNodeIcon(props.node.type)}</span>
      <span className="symbol-value-pipeline-copy">{content}</span>
    </>
  ) : content;

  return onOpenCode && props.node.source ? (
    <button
      type="button"
      className={className}
      data-pipeline-type={props.node.type}
      title={props.node.fullName}
      aria-label={`${props.node.type}: ${props.node.fullName}`}
      onClick={() => void onOpenCode(props.node)}
    >
      {renderedContent}
    </button>
  ) : (
    <span
      className={className}
      data-pipeline-type={props.node.type}
      title={props.node.fullName}
      aria-label={`${props.node.type}: ${props.node.fullName}`}
    >
      {renderedContent}
    </span>
  );
}

function pipelineNodeIcon(type: SymbolPipelineNode["type"]) {
  const props = { size: 18, strokeWidth: 1.8, "aria-hidden": true as const };
  if (type === "API") return <Globe2 {...props} />;
  if (type === "THUNK") return <Zap {...props} />;
  if (type === "ACTION") return <Box {...props} />;
  if (type === "STATE") return <Database {...props} />;
  if (type === "SELECTOR") return <Filter {...props} />;
  if (type === "HOOK" || type === "FUNCTION") return <SquareFunction {...props} />;
  if (type === "COMPONENT" || type === "PROP") return <Component {...props} />;
  if (type === "COMPUTED") return <Braces {...props} />;
  if (type === "BOUNDARY") return <Globe2 {...props} />;
  if (type === "GAP") return <CircleAlert {...props} />;
  return <Variable {...props} />;
}

function behaviorLabel(overview: SymbolOverview, t: T) {
  if (overview.behavior === "read-only") return overview.symbolType === "hook"
    ? t.symbolReadOnlyHook
    : t.symbolNoEffects;
  return t.symbolWithEffects;
}

function valueRoleLabel(value: SymbolOverviewValue, t: T) {
  return {
    "pass-through": t.symbolRolePassThrough,
    derived: t.symbolRoleDerived,
    combined: t.symbolRoleCombined,
    constant: t.symbolRoleConstant,
    unknown: t.symbolRoleUnknown,
  }[value.role];
}

function transformationLabel(
  kind: NonNullable<SymbolOverviewValue["transformation"]>["kind"],
  operation: string | undefined,
  t: T
) {
  if (kind === "direct") return t.symbolTransformationDirect;
  if (kind === "constant") return t.symbolTransformationConstant;
  if (kind === "property-read") return t.symbolTransformationProperty;
  if (kind === "find") return t.symbolTransformationFind;
  if (kind === "filter") return t.symbolTransformationFilter;
  if (kind === "map") return t.symbolTransformationMap;
  if (kind === "reduce") return t.symbolTransformationReduce;
  if (kind === "fallback") return t.symbolTransformationFallback;
  if (kind === "condition") return t.symbolTransformationCondition;
  if (kind === "object") return t.symbolTransformationObject;
  if (kind === "array") return t.symbolTransformationArray;
  if (kind === "call" && operation) return t.symbolTransformationCall.replace("{operation}", operation);
  return t.symbolTransformationExpression;
}

function compactTypeLabel(value: string): string {
  return value.length > 80 ? `${value.slice(0, 77)}…` : value;
}
