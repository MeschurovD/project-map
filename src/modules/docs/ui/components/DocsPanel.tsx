import { useEffect, useState } from "react";
import { BadgeCheck, BookOpen, FileText, RefreshCw } from "lucide-react";
import type { ProjectMapNode } from "../../../../graph/types.js";
import { fetchJson, postJson } from "../../../ui/apiClient.js";
import { notifyEnrichmentChanged } from "../../../ui/enrichmentEvents.js";
import { DocsModal } from "./DocsModal.js";
import { GenerateDocsModal } from "./GenerateDocsModal.js";
import { useDocsQueue } from "../queue/docsQueueStore.js";
import type { DocsMode, DocsReadResponse, DocsStatusResponse } from "../../shared/apiTypes.js";

export function DocsPanel(props: { node: ProjectMapNode }) {
  const [status, setStatus] = useState<DocsStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [docs, setDocs] = useState<{ path: string; content: string } | null>(null);
  const [generateMode, setGenerateMode] = useState<DocsMode | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const { isRunning: queueRunning } = useDocsQueue();

  useEffect(() => {
    void refreshStatus();
  }, [props.node.id]);

  return (
    <section className="semantic-section docs-panel">
      <h3><BookOpen size={15} aria-hidden="true" /> Документация</h3>
      {loading ? <p className="muted-row">Проверяем документацию...</p> : null}
      {error ? <p className="source-error">{error}</p> : null}
      {status?.status === "unsupported" ? (
        <div className="docs-status-block">
          <strong>Документация недоступна для этого узла</strong>
          <span>Причина: node не связан с исходным файлом</span>
        </div>
      ) : null}
      {status?.status === "missing" ? (
        <div className="docs-status-block">
          <strong>Документация отсутствует</strong>
          <span>Ожидаемый файл:</span>
          <code>{status.expectedPath}</code>
          <button type="button" onClick={() => setGenerateMode("create")} disabled={queueRunning}>
            <FileText size={15} aria-hidden="true" />
            <span>Сгенерировать</span>
          </button>
        </div>
      ) : null}
      {status?.status === "exists" || status?.status === "stale" ? (
        <div className="docs-status-block">
          <strong>
            {status.status === "stale" ? "Документация устарела (код изменился)" : "Документация найдена"}
          </strong>
          <code>{status.path}</code>
          <small>
            {formatBytes(status.sizeBytes)} · {new Date(status.updatedAt).toLocaleString()}
            {status.format === "legacy" ? " · легаси-формат" : null}
            {status.reviewed ? " · проверено" : null}
          </small>
          <div className="docs-button-row">
            <button type="button" onClick={() => void openDocs()}>
              <BookOpen size={15} aria-hidden="true" />
              <span>Посмотреть</span>
            </button>
            <button
              type="button"
              onClick={() => setGenerateMode(
                status.format === "structured" ? "migrate" : "regenerate"
              )}
              disabled={queueRunning}
            >
              <RefreshCw size={15} aria-hidden="true" />
              <span>
                {status.format === "structured"
                  ? "Мигрировать в docs v2"
                  : "Перегенерировать"}
              </span>
            </button>
            {status.format === "structured" || status.format === "structured-v2" ? (
              <button type="button" onClick={() => void setReviewed(!status.reviewed)} disabled={reviewing}>
                <BadgeCheck size={15} aria-hidden="true" />
                <span>{status.reviewed ? "Снять отметку «проверено»" : "Отметить проверенной"}</span>
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {docs ? (
        <DocsModal title={`Docs: ${props.node.name}`} path={docs.path} content={docs.content} onClose={() => setDocs(null)} />
      ) : null}
      {generateMode ? (
        <GenerateDocsModal
          node={props.node}
          mode={generateMode}
          onClose={() => setGenerateMode(null)}
          onSuccess={() => {
            notifyEnrichmentChanged();
            void refreshStatus();
          }}
          onOpenDocs={() => {
            setGenerateMode(null);
            void openDocs();
          }}
        />
      ) : null}
    </section>
  );

  async function refreshStatus() {
    setLoading(true);
    setError(null);
    try {
      setStatus(await fetchJson<DocsStatusResponse>(`/api/docs/node/${encodeURIComponent(props.node.id)}/status`));
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : String(statusError));
    } finally {
      setLoading(false);
    }
  }

  async function setReviewed(reviewed: boolean) {
    setError(null);
    setReviewing(true);
    try {
      setStatus(await postJson<DocsStatusResponse>(`/api/docs/node/${encodeURIComponent(props.node.id)}/reviewed`, { reviewed }));
      notifyEnrichmentChanged();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : String(reviewError));
    } finally {
      setReviewing(false);
    }
  }

  async function openDocs() {
    setError(null);
    const response = await fetchJson<DocsReadResponse>(`/api/docs/node/${encodeURIComponent(props.node.id)}`);
    if (response.status !== "exists") {
      await refreshStatus();
      return;
    }
    setDocs({ path: response.path, content: response.content });
  }
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return `${Math.round(bytes / 1024)} KB`;
}
