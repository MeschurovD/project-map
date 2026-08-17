import { useState } from "react";
import { ListChecks } from "lucide-react";
import { useDocsQueue } from "./docsQueueStore.js";
import { DocsQueueModal } from "./DocsQueueModal.js";

export function DocsQueueWidget() {
  const { items, isRunning } = useDocsQueue();
  const [open, setOpen] = useState(false);

  const pending = items.filter((item) => item.status === "queued" || item.status === "running").length;

  if (items.length === 0 && !open) return null;

  return (
    <>
      <button
        type="button"
        className={`docs-queue-fab${isRunning ? " docs-queue-fab--running" : ""}`}
        onClick={() => setOpen(true)}
        aria-label="Открыть очередь генерации docs"
      >
        <ListChecks size={16} aria-hidden="true" />
        <span>Очередь docs</span>
        {items.length > 0 ? (
          <span className="docs-queue-badge">{pending > 0 ? pending : items.length}</span>
        ) : null}
      </button>
      {open ? <DocsQueueModal onClose={() => setOpen(false)} /> : null}
    </>
  );
}
