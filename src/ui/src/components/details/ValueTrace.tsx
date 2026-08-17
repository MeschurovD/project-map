import type { SourceLocation } from "../../../../analyzers/value-flow/types.js";
import type { TraceNode } from "../../../data-flow/buildValueTrace.js";
import { useT, type T } from "../../i18n.js";

// Renders a value-origin trace tree: each node is a step up the data flow with
// its evidence snippet (click to open the source). Unresolved steps are shown
// muted — an honest "the trace stops here", not a gap hidden.
export function ValueTrace(props: {
  nodes: TraceNode[];
  onViewEvidence: (evidence: SourceLocation, title: string) => void;
}) {
  const t = useT();
  if (props.nodes.length === 0) return <p className="muted-row">{t.traceEmpty}</p>;

  return (
    <ul className="value-trace">
      {props.nodes.map((node) => (
        <TraceRow key={node.id} node={node} onViewEvidence={props.onViewEvidence} t={t} />
      ))}
    </ul>
  );
}

function TraceRow(props: {
  node: TraceNode;
  onViewEvidence: (evidence: SourceLocation, title: string) => void;
  t: T;
}) {
  const { node, t } = props;

  return (
    <li className={`trace-node trace-${node.kind}`}>
      <div className="trace-head">
        {node.relation ? <span className="trace-rel">{traceRelation(node.relation, t)}</span> : null}
        <span className="trace-title">{node.kind === "unresolved" ? traceMessage(node.title, t) : node.title}</span>
        {node.detail ? <span className="trace-detail">{node.detail}</span> : null}
      </div>
      {node.evidence?.code ? (
        <button
          type="button"
          className="trace-evidence"
          onClick={() => props.onViewEvidence({ file: node.evidence?.file, line: node.evidence?.line }, node.title)}
          title={node.evidence.file ? `${node.evidence.file}:${node.evidence.line ?? ""}` : undefined}
        >
          <code>{node.evidence.code}</code>
        </button>
      ) : null}
      {node.children.length > 0 ? (
        <ul>
          {node.children.map((child) => (
            <TraceRow key={child.id} node={child} onViewEvidence={props.onViewEvidence} t={t} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function traceRelation(relation: string, t: T) {
  const map: Record<string, string> = {
    "from selector": t.trFromSelector,
    "from hook": t.trFromHook,
    reads: t.trReads,
    "reads in hook": t.trReadsInHook,
    "written by": t.trWrittenBy,
    "derived from": t.trDerivedFrom,
    "bound as": t.trBoundAs,
    "calls api": t.relCallsApi,
    feeds: t.trFeeds,
    // Reverse-trace usage kinds (how a value is consumed downstream).
    conditionalRender: t.usageControlsRender,
    ternaryCondition: t.usageChoosesRender,
    prop: t.usageProp,
    eventHandler: t.usageEventHandler,
    hookArgument: t.usageHookArgument,
    actionArgument: t.usageActionArgument,
    functionArgument: t.usageFunctionArgument,
    renderedExpression: t.usageRenderedExpression,
  };
  return map[relation] ?? relation;
}

function traceMessage(message: string, t: T) {
  const map: Record<string, string> = {
    "no producing selector or hook found": t.trNoProducer,
    "hook internals not traced": t.trHookInternals,
    "exact derivation inside hook not captured": t.trHookApprox,
    "no state read recorded for this selector": t.trNoStateRead,
    "no slice writer found for this state path": t.trNoWriter,
    "thunk → API call not traced": t.trThunkApi,
    "no consumers found": t.trNoConsumers,
    "bound but no tracked usage": t.trBoundNoUsage,
    "cycle — already shown above": t.trCycle,
    "trace depth limit reached": t.trDepth,
  };
  return map[message] ?? message;
}
