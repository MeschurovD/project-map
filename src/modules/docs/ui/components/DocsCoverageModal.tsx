import { useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, X } from "lucide-react";
import type {
  DocsAuditDocument,
  DocsCoverageNode,
  DocsCoverageResponse,
} from "../../shared/apiTypes.js";
import { docsQueueStore } from "../queue/docsQueueStore.js";

export function DocsCoverageModal(props: {
  coverage: DocsCoverageResponse;
  onClose: () => void;
}) {
  const [batchNote, setBatchNote] = useState<string | null>(null);
  const [batchStarting, setBatchStarting] = useState(false);
  const problemDocuments = props.coverage.documents.filter(
    (document) => document.invalid || document.orphaned
  );
  const uncoveredNodes = props.coverage.nodes.filter((node) => !node.documented);
  const staleNodes = props.coverage.nodes.filter(
    (node) => node.documented && !node.fresh
  );
  const staleV2Nodes = staleNodes.filter(
    (node) => node.documentFormat === "structured-v2"
  );

  return (
    <div className="source-modal-backdrop" role="presentation" onMouseDown={props.onClose}>
      <section
        className="source-modal docs-coverage-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Docs coverage"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="source-modal-header">
          <div>
            <h2>Docs coverage</h2>
            <span>Покрытие считается только по валидному canonical owner.</span>
          </div>
          <div className="source-modal-actions">
            <button
              type="button"
              onClick={() => void regenerateStaleV2()}
              disabled={batchStarting || staleV2Nodes.length === 0}
            >
              <RefreshCw size={15} aria-hidden="true" />
              <span>Перегенерировать stale v2 · {staleV2Nodes.length}</span>
            </button>
            <button type="button" onClick={props.onClose}>
              <X size={15} aria-hidden="true" />
              <span>Close</span>
            </button>
          </div>
        </header>

        <div className="docs-coverage-body">
          <CoverageMetrics coverage={props.coverage} />
          {batchNote ? <p className="muted-row">{batchNote}</p> : null}

          <CoverageSection
            title={`Не покрыто · ${uncoveredNodes.length}`}
            empty="Все documentable nodes покрыты."
          >
            {uncoveredNodes.map((node) => (
              <NodeRow key={node.nodeId} node={node} />
            ))}
          </CoverageSection>

          <CoverageSection
            title={`Устарело · ${staleNodes.length}`}
            empty="Устаревших документов нет."
          >
            {staleNodes.map((node) => (
              <NodeRow key={node.nodeId} node={node} />
            ))}
          </CoverageSection>

          <CoverageSection
            title={`Invalid / orphaned · ${problemDocuments.length}`}
            empty="Ошибок адресации и формата нет."
          >
            {problemDocuments.map((document) => (
              <DocumentRow key={document.path} document={document} />
            ))}
          </CoverageSection>
        </div>
      </section>
    </div>
  );

  async function regenerateStaleV2() {
    setBatchStarting(true);
    setBatchNote(null);
    try {
      const count = await docsQueueStore.enqueueStaleV2Docs();
      if (count === 0) {
        setBatchNote("Валидные stale docs v2 не найдены.");
        return;
      }
      setBatchNote(`Добавлено в очередь: ${count}. Batch запущен.`);
      void docsQueueStore.start();
    } catch (error) {
      setBatchNote(error instanceof Error ? error.message : String(error));
    } finally {
      setBatchStarting(false);
    }
  }
}

function CoverageMetrics(props: { coverage: DocsCoverageResponse }) {
  const { summary } = props.coverage;
  return (
    <div className="docs-coverage-metrics">
      <Metric label="Documented" value={`${summary.documentedNodes}/${summary.totalNodes}`} />
      <Metric label="Fresh" value={summary.freshNodes} />
      <Metric label="Reviewed" value={summary.reviewedNodes} />
      <Metric label="Invalid" value={summary.invalidDocuments} tone="warning" />
      <Metric label="Orphaned" value={summary.orphanedDocuments} tone="warning" />
    </div>
  );
}

function Metric(props: {
  label: string;
  value: string | number;
  tone?: "warning";
}) {
  return (
    <div className={`metric${props.tone ? ` docs-coverage-metric--${props.tone}` : ""}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function CoverageSection(props: {
  title: string;
  empty: string;
  children: React.ReactNode[];
}) {
  return (
    <section className="docs-coverage-section">
      <h3>{props.title}</h3>
      {props.children.length > 0 ? (
        <div className="docs-coverage-list">{props.children}</div>
      ) : (
        <p className="docs-coverage-ok">
          <CheckCircle2 size={15} aria-hidden="true" />
          <span>{props.empty}</span>
        </p>
      )}
    </section>
  );
}

function NodeRow(props: { node: DocsCoverageNode }) {
  return (
    <article className="docs-coverage-row">
      <div>
        <strong>{props.node.nodeName}</strong>
        <span>{props.node.nodeType} · {props.node.nodeId}</span>
      </div>
      <code>{props.node.documentPath ?? props.node.expectedPath}</code>
      <IssueList issues={props.node.issues} fallback="Документ отсутствует." />
    </article>
  );
}

function DocumentRow(props: { document: DocsAuditDocument }) {
  return (
    <article className="docs-coverage-row docs-coverage-row--warning">
      <div>
        <strong>
          <AlertTriangle size={14} aria-hidden="true" />
          {props.document.ownerNodeName ?? props.document.ownerNodeId ?? "Без owner"}
        </strong>
        <span>{props.document.format}</span>
      </div>
      <code>{props.document.path}</code>
      <IssueList issues={props.document.issues} />
    </article>
  );
}

function IssueList(props: {
  issues: Array<{ code: string; message: string }>;
  fallback?: string;
}) {
  if (props.issues.length === 0) {
    return props.fallback ? <p>{props.fallback}</p> : null;
  }
  return (
    <ul>
      {props.issues.map((issue, index) => (
        <li key={`${issue.code}:${index}`}>{issue.message}</li>
      ))}
    </ul>
  );
}
