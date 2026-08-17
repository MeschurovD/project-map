import { CircleOff, Layers } from "lucide-react";
import type { FlowListRow } from "../../graph-view/buildPageFlowList.js";
import { filterFlowListRows } from "../../graph-view/buildPageFlowList.js";
import { useT } from "../i18n.js";

// The default Flows presentation (plan 17 §2.3): the page's flows as a scrollable
// list of "value → consumer → source summary" rows with a completeness badge and
// gap count. Clicking a row opens that single flow's left→right trace. From here
// the aggregate page-wide canvas is one explicit, secondary control away.
export function FlowList(props: {
  rows: FlowListRow[];
  query: string;
  onOpenFlow: (flowId: string) => void;
  onShowAggregate: () => void;
}) {
  const t = useT();
  const rows = filterFlowListRows(props.rows, props.query);

  return (
    <div className="flow-list-shell">
      <div className="flow-list-toolbar">
        <span className="flow-list-title">{t.flowListTitle} · {rows.length}</span>
        <button type="button" className="flow-view-toggle" onClick={props.onShowAggregate}>
          <Layers size={14} aria-hidden="true" /> {t.flowAggregateView}
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state flow-list-empty">
          <CircleOff size={24} aria-hidden="true" />
          <strong>{t.flowListEmpty}</strong>
        </div>
      ) : (
        <table className="flow-list">
          <thead>
            <tr>
              <th className="col-text">{t.flowColSubject}</th>
              <th className="col-text">{t.flowColConsumer}</th>
              <th className="col-text">{t.flowColSource}</th>
              <th className="col-num">{t.flowColComplete}</th>
              <th className="col-num">{t.flowColGaps}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="col-text">
                  <button
                    type="button"
                    className="flow-row-name"
                    onClick={() => props.onOpenFlow(row.id)}
                    data-flow-row={row.subjectName}
                  >
                    {row.subjectName}
                  </button>
                </td>
                <td className="col-text muted">{row.consumerLabel}</td>
                <td className="col-text muted">{row.sourceLabel}</td>
                <td className="col-num">
                  <CompletenessBadge value={row.completeness} completeLabel={t.flowBadgeComplete} partialLabel={t.flowBadgePartial} />
                </td>
                <td className={`col-num flow-gaps ${row.gapCount > 0 ? "has-gaps" : "no-gaps"}`}>{row.gapCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function CompletenessBadge(props: { value: FlowListRow["completeness"]; completeLabel: string; partialLabel: string }) {
  const complete = props.value === "complete";
  return (
    <span className={`flow-badge flow-badge-${complete ? "complete" : "partial"}`}>
      {complete ? props.completeLabel : props.partialLabel}
    </span>
  );
}
