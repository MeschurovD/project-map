import type { FlowQueries } from "../../flow/queries.js";
import type { ValueFlow } from "../../flow/types.js";

// One row of the Flows list: the plan-17 §2.3 shape "value → final consumer →
// source summary", plus the completeness badge and gap count. Built purely from
// the canonical FlowQueries so the list agrees with the trace it opens.
export type FlowListRow = {
  id: string;
  subjectNodeId: string;
  subjectName: string;
  subjectPath?: string;
  /** Final consumer names, e.g. "UserCard.name" (or "UserCard.name +2"). */
  consumerLabel: string;
  /** Source summary, e.g. "GET /api/users/${userId}" (or "… +1"). */
  sourceLabel: string;
  completeness: ValueFlow["completeness"];
  gapCount: number;
};

/**
 * The page's flows as list rows, in the query layer's own order (complete-ish
 * subjects sorted by name). Resolves consumer/source names through the flow
 * detail so the list can show them without the UI touching raw flow nodes.
 */
export function buildPageFlowList(queries: FlowQueries, pageId: string): FlowListRow[] {
  return queries.listPageFlows(pageId).map((summary) => {
    const detail = queries.getValueFlow(summary.id);
    return {
      id: summary.id,
      subjectNodeId: summary.subjectNodeId,
      subjectName: summary.subjectName,
      subjectPath: summary.subjectPath,
      consumerLabel: joinNames(detail?.consumers.map((node) => node.name) ?? []),
      sourceLabel: joinNames(detail?.sources.map((node) => node.name) ?? []),
      completeness: summary.completeness,
      gapCount: summary.gapCount,
    };
  });
}

/** Filter rows by a free-text query over subject, consumer and source labels. */
export function filterFlowListRows(rows: FlowListRow[], query: string): FlowListRow[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return rows;
  return rows.filter((row) =>
    `${row.subjectName} ${row.subjectPath ?? ""} ${row.consumerLabel} ${row.sourceLabel}`
      .toLowerCase()
      .includes(normalized)
  );
}

function joinNames(names: string[]): string {
  const unique = [...new Set(names.filter(Boolean))];
  if (unique.length === 0) return "—";
  if (unique.length === 1) return unique[0]!;
  return `${unique[0]} +${unique.length - 1}`;
}
