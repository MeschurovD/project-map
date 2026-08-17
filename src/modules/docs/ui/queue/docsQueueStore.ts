import { useSyncExternalStore } from "react";
import type { StartGenerationJobResponse } from "../../../../generation/jobs/apiTypes.js";
import { fetchJson, postJson } from "../../../ui/apiClient.js";
import { notifyEnrichmentChanged } from "../../../ui/enrichmentEvents.js";
import { pollGenerationJob } from "../../../ui/pollGenerationJob.js";
import type {
  DocsGenerationScope,
  DocsJobResponse,
  DocsMode,
  DocsStaleListResponse,
} from "../../shared/apiTypes.js";

export type DocsQueueItemStatus = "queued" | "running" | "success" | "error";

export type DocsQueueItem = {
  id: string;
  nodeId: string;
  nodeName: string;
  mode: DocsMode;
  scope?: DocsGenerationScope;
  /** Omitted = let the server pick its default context (used by batch regen). */
  selectedContextIds?: string[];
  userComment: string;
  status: DocsQueueItemStatus;
  jobId?: string;
  error?: string;
  logs?: string[];
};

export type DocsQueueInput = Pick<
  DocsQueueItem,
  "nodeId" | "nodeName" | "mode" | "scope" | "selectedContextIds" | "userComment"
>;

type DocsQueueState = {
  items: DocsQueueItem[];
  isRunning: boolean;
};

const buildJobUrl = (jobId: string) => `/api/docs/jobs/${encodeURIComponent(jobId)}`;

let state: DocsQueueState = { items: [], isRunning: false };
const listeners = new Set<() => void>();

function setState(next: DocsQueueState) {
  state = next;
  listeners.forEach((listener) => listener());
}

function setItems(mutate: (items: DocsQueueItem[]) => DocsQueueItem[], patch?: Partial<DocsQueueState>) {
  setState({ ...state, items: mutate(state.items), ...patch });
}

function patchItem(items: DocsQueueItem[], id: string, patch: Partial<DocsQueueItem>) {
  return items.map((item) => (item.id === id ? { ...item, ...patch } : item));
}

/**
 * Client-side, docs-only generation queue. Items are processed FIFO: each one
 * fires the regular `/generate` endpoint (a fresh OpenCode run with its own
 * context) and is polled to completion before the next starts. The queue stops
 * on the first error and refuses to run two passes concurrently.
 */
export const docsQueueStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  getSnapshot(): DocsQueueState {
    return state;
  },

  enqueue(input: DocsQueueInput) {
    const item: DocsQueueItem = {
      ...input,
      id: `docs-queue-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      status: "queued",
    };
    setItems((items) => [...items, item]);
  },

  /**
   * Enqueue every valid owner-matched stale v2 document, skipping nodes already
   * queued or running. The server deliberately excludes v1 migration,
   * legacy, invalid and orphaned documents from this batch.
   */
  async enqueueStaleV2Docs(): Promise<number> {
    const { nodes } = await fetchJson<DocsStaleListResponse>("/api/docs/stale");
    const pending = new Set(
      state.items
        .filter((item) => item.status === "queued" || item.status === "running")
        .map((item) => item.nodeId)
    );

    const fresh = nodes.filter((node) => !pending.has(node.nodeId));
    for (const node of fresh) {
      docsQueueStore.enqueue({ nodeId: node.nodeId, nodeName: node.nodeName, mode: "regenerate", userComment: "" });
    }
    return fresh.length;
  },

  remove(id: string) {
    setItems((items) => items.filter((item) => item.id !== id));
  },

  clearFinished() {
    setItems((items) => items.filter((item) => item.status === "queued" || item.status === "running"));
  },

  async start() {
    if (state.isRunning) return;
    setState({ ...state, isRunning: true });

    try {
      for (;;) {
        // Re-read each pass so items enqueued mid-run are picked up.
        const next = state.items.find((item) => item.status === "queued");
        if (!next) break;

        setItems((items) => patchItem(items, next.id, { status: "running", error: undefined, logs: ["Job created"] }));

        try {
          const started = await postJson<StartGenerationJobResponse>(
            `/api/docs/node/${encodeURIComponent(next.nodeId)}/generate`,
            {
              selectedContextIds: next.selectedContextIds,
              userComment: next.userComment,
              mode: next.mode,
              scope: next.scope,
            },
          );
          setItems((items) => patchItem(items, next.id, { jobId: started.jobId }));

          const job = await pollGenerationJob<DocsJobResponse>({
            jobId: started.jobId,
            buildJobUrl,
            onJob: (polled) => setItems((items) => patchItem(items, next.id, { logs: polled.logs })),
          });

          if (job.status === "error") {
            setItems((items) => patchItem(items, next.id, { status: "error", error: job.error ?? "OpenCode generation failed" }));
            break; // stop the queue on the first failure
          }

          setItems((items) => patchItem(items, next.id, { status: "success" }));
          notifyEnrichmentChanged();
        } catch (error) {
          setItems((items) => patchItem(items, next.id, {
            status: "error",
            error: error instanceof Error ? error.message : String(error),
          }));
          break; // stop the queue on the first failure
        }
      }
    } finally {
      setState({ ...state, isRunning: false });
    }
  },
};

export function useDocsQueue(): DocsQueueState {
  return useSyncExternalStore(docsQueueStore.subscribe, docsQueueStore.getSnapshot);
}
