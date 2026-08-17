import { useEffect, useState } from "react";
import { FlaskConical } from "lucide-react";
import { fetchJson } from "../../../ui/apiClient.js";
import type { E2eCoverageSummaryResponse } from "../../shared/apiTypes.js";

/** Sidebar row: how many pages are fully covered by page objects. */
export function E2eCoverageWidget() {
  const [summary, setSummary] = useState<E2eCoverageSummaryResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchJson<E2eCoverageSummaryResponse>("/api/e2e/summary")
      .then((response) => {
        if (!cancelled) setSummary(response);
      })
      .catch(() => {
        // No summary row when the endpoint is unavailable; the sidebar stays clean.
        if (!cancelled) setSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!summary || summary.totalPages === 0) return null;
  const percent = Math.round((summary.coveredPages / summary.totalPages) * 100);

  return (
    <div className="sidebar-widget" title="Страницы, у которых существуют все Page Object файлы">
      <FlaskConical size={16} aria-hidden="true" />
      <span>e2e: {summary.coveredPages}/{summary.totalPages} страниц ({percent}%)</span>
    </div>
  );
}
