import { useState } from "react";
import { Play, RefreshCw, Trash2, X } from "lucide-react";
import { docsQueueStore, useDocsQueue, type DocsQueueItem } from "./docsQueueStore.js";

export function DocsQueueModal(props: { onClose: () => void }) {
  const { items, isRunning } = useDocsQueue();
  const [note, setNote] = useState<string | null>(null);
  const hasQueued = items.some((item) => item.status === "queued");
  const hasFinished = items.some((item) => item.status === "success" || item.status === "error");
  const runningItem = items.find((item) => item.status === "running");

  async function regenerateStale() {
    setNote(null);
    try {
      const count = await docsQueueStore.enqueueStaleV2Docs();
      if (count === 0) {
        setNote("Устаревшая документация не найдена");
        return;
      }
      setNote(`Добавлено в очередь: ${count}`);
      void docsQueueStore.start();
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="source-modal-backdrop" role="presentation" onMouseDown={props.onClose}>
      <section
        className="source-modal docs-queue-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Очередь генерации docs"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="source-modal-header">
          <div>
            <h2>Очередь генерации docs</h2>
            <span>{items.length} в очереди{isRunning ? " · выполняется" : ""}</span>
          </div>
          <div className="source-modal-actions">
            <button type="button" onClick={() => void regenerateStale()} disabled={isRunning}>
              <RefreshCw size={15} aria-hidden="true" />
              <span>Перегенерировать stale v2</span>
            </button>
            <button type="button" onClick={() => void docsQueueStore.start()} disabled={isRunning || !hasQueued}>
              <Play size={15} aria-hidden="true" />
              <span>Старт очереди</span>
            </button>
            <button type="button" onClick={() => docsQueueStore.clearFinished()} disabled={!hasFinished}>
              <span>Очистить завершённые</span>
            </button>
            <button type="button" onClick={props.onClose}>
              <X size={15} aria-hidden="true" />
              <span>Close</span>
            </button>
          </div>
        </header>

        <div className="docs-queue-body">
          {note ? <p className="muted-row">{note}</p> : null}
          {items.length === 0 ? (
            <p className="muted-row">Очередь пуста. Добавьте компоненты/хуки через окно генерации.</p>
          ) : null}

          <ol className="docs-queue-list">
            {items.map((item) => (
              <li key={item.id} className={`docs-queue-item docs-queue-item--${item.status}`}>
                <div className="docs-queue-item-head">
                  <strong>{item.nodeName}</strong>
                  <span className="docs-queue-status">{statusLabel(item.status)}</span>
                  {item.status === "queued" ? (
                    <button
                      type="button"
                      className="docs-queue-remove"
                      onClick={() => docsQueueStore.remove(item.id)}
                      aria-label="Удалить из очереди"
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
                <small>
                  {item.mode === "migrate"
                    ? "Миграция v1 → v2"
                    : item.mode === "regenerate"
                      ? "Перегенерация"
                      : "Генерация"}
                  {item.userComment ? ` · ${item.userComment}` : ""}
                </small>
                {item.error ? <p className="source-error">{item.error}</p> : null}
              </li>
            ))}
          </ol>

          {runningItem?.logs?.length ? (
            <section className="generation-workflow-section">
              <h3>Логи: {runningItem.nodeName}</h3>
              <pre className="generation-job-logs">{runningItem.logs.join("\n")}</pre>
            </section>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function statusLabel(status: DocsQueueItem["status"]) {
  switch (status) {
    case "queued":
      return "в очереди";
    case "running":
      return "выполняется…";
    case "success":
      return "готово";
    case "error":
      return "ошибка";
  }
}
