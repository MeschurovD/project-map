import { useCallback, useEffect, useState } from "react";
import { BookOpenCheck } from "lucide-react";
import { fetchJson } from "../../../ui/apiClient.js";
import { subscribeEnrichmentChanges } from "../../../ui/enrichmentEvents.js";
import type { DocsCoverageResponse } from "../../shared/apiTypes.js";
import { DocsCoverageModal } from "./DocsCoverageModal.js";

export function DocsCoverageWidget() {
  const [coverage, setCoverage] = useState<DocsCoverageResponse | null>(null);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => {
    fetchJson<DocsCoverageResponse>("/api/docs/coverage")
      .then(setCoverage)
      .catch(() => setCoverage(null));
  }, []);

  useEffect(() => {
    load();
    return subscribeEnrichmentChanges(load);
  }, [load]);

  if (!coverage || coverage.summary.totalNodes === 0) return null;
  const percent = Math.round(
    (coverage.summary.documentedNodes / coverage.summary.totalNodes) * 100
  );
  const problems =
    coverage.summary.invalidDocuments + coverage.summary.orphanedDocuments;

  return (
    <>
      <button
        type="button"
        className="sidebar-widget docs-coverage-widget"
        title="Валидная документация с canonical owner"
        onClick={() => setOpen(true)}
      >
        <BookOpenCheck size={16} aria-hidden="true" />
        <span>
          docs: {coverage.summary.documentedNodes}/{coverage.summary.totalNodes} ({percent}%)
        </span>
        {problems > 0 ? (
          <span className="docs-coverage-problems" title="Invalid / orphaned documents">
            {problems}
          </span>
        ) : null}
      </button>
      {open ? (
        <DocsCoverageModal coverage={coverage} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}
