import { useState } from "react";
import { CircleOff } from "lucide-react";
import type { DashboardRow } from "../../graph-view/buildPagesDashboard.js";
import { useT, type T } from "../i18n.js";

type SortKey = keyof Pick<DashboardRow,
  "name" | "widgets" | "features" | "entities" | "hooks" | "redux" | "components" |
  "flowsCount" | "sourceCoveragePct" | "originGapCount" | "docsPct" | "e2ePct"
>;

// Pages overview as a sortable table: dependency counts and docs/e2e coverage
// per page, so a lead can sort to find the heaviest, least-tested or
// least-documented pages.
export function PagesDashboard(props: { rows: DashboardRow[]; onSelectPage: (pageId: string) => void }) {
  const t = useT();
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "name", dir: "asc" });

  const columns: Array<{ key: SortKey; label: string }> = [
    { key: "name", label: t.dashPage },
    { key: "components", label: t.dashComponents },
    { key: "flowsCount", label: t.dashFlows },
    { key: "sourceCoveragePct", label: t.dashSourceCoverage },
    { key: "originGapCount", label: t.dashGaps },
  ];

  const sorted = [...props.rows].sort((left, right) => compareRows(left, right, sort.key) * (sort.dir === "asc" ? 1 : -1));

  function toggleSort(key: SortKey) {
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "name" ? "asc" : "desc" }
    );
  }

  // Honest empty state: a filter (or an empty project) that matches no page
  // shows a "no pages match" line rather than a bare header with no rows.
  if (sorted.length === 0) {
    return (
      <div className="pages-dashboard-shell">
        <div className="empty-state pages-dashboard-empty">
          <CircleOff size={24} aria-hidden="true" />
          <strong>{t.dashNoMatch}</strong>
        </div>
      </div>
    );
  }

  return (
    <div className="pages-dashboard-shell">
      <table className="pages-dashboard">
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className={`${column.key === "name" ? "col-text" : "col-num"}${sort.key === column.key ? " sorted" : ""}`}
                onClick={() => toggleSort(column.key)}
              >
                {column.label}{sort.key === column.key ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.pageId}>
              <td className="col-text">
                <button type="button" className="dashboard-page-name" onClick={() => props.onSelectPage(row.pageId)}>
                  {row.name}
                </button>
              </td>
              <td className="col-num">{row.components}</td>
              <MetricCell value={row.flowsCount} />
              <SourceCoverageCell
                value={row.sourceCoveragePct}
                resolved={row.sourceResolvedCount}
                total={row.flowsCount}
                t={t}
              />
              <GapCell value={row.originGapCount} t={t} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MetricCell(props: { value: number | null }) {
  return <td className={props.value === null ? "col-num muted" : "col-num"}>{props.value ?? "—"}</td>;
}

function SourceCoverageCell(props: {
  value: number | null;
  resolved: number | null;
  total: number | null;
  t: T;
}) {
  if (props.value === null) return <td className="col-num muted">—</td>;
  const tone = props.value === 100 ? "ok" : props.value >= 50 ? "info" : "warn";
  return (
    <td
      className={`col-num flow-quality quality-${tone}`}
      title={`${props.t.dashSourceCoverage}: ${props.resolved ?? 0} / ${props.total ?? 0} · ${props.value}%`}
    >
      {props.resolved ?? 0}/{props.total ?? 0} · {props.value}%
    </td>
  );
}

function GapCell(props: { value: number | null; t: T }) {
  if (props.value === null) return <td className="col-num muted">—</td>;
  return (
    <td
      className={`col-num flow-gaps ${props.value > 0 ? "has-gaps" : "no-gaps"}`}
      title={`${props.t.dashGaps}: ${props.value}`}
    >
      {props.value}
    </td>
  );
}

function compareRows(left: DashboardRow, right: DashboardRow, key: SortKey): number {
  if (key === "name") return left.name.localeCompare(right.name);
  // Numeric columns; null coverage sorts last regardless of direction sign.
  const a = left[key];
  const b = right[key];
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return (a as number) - (b as number);
}
