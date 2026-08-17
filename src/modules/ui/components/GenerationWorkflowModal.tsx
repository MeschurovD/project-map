import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Copy, FileText, ListPlus, Play, X } from "lucide-react";
import { useGenerationJobPolling, type PollableGenerationJob } from "../useGenerationJobPolling.js";

export type GenerationWorkflowContextItem = {
  id: string;
  label: string;
  detail: string;
  selected: boolean;
};

export type GenerationWorkflowRequest = {
  selectedContextIds: string[];
  userComment: string;
};

export type GenerationWorkflowPrompt = {
  prompt: string;
};

export type GenerationWorkflowJob = PollableGenerationJob & {
  logs: string[];
};

export type GenerationWorkflowState =
  | "loading-context"
  | "editing-context"
  | "loading-prompt"
  | "prompt-ready"
  | "starting-job"
  | "job-running"
  | "job-success"
  | "job-error";

export function GenerationWorkflowModal<TContext, TPrompt extends GenerationWorkflowPrompt, TJob extends GenerationWorkflowJob, TStartJobResponse>(props: {
  resetKey: string;
  title: string;
  ariaLabel: string;
  targetPath: (context: TContext) => string | null;
  loadingTargetLabel: string;
  contextItems: (context: TContext) => GenerationWorkflowContextItem[];
  details?: (context: TContext) => ReactNode;
  loadContext: () => Promise<TContext>;
  onContextLoaded?: (context: TContext) => void;
  buildPrompt: (request: GenerationWorkflowRequest) => Promise<TPrompt>;
  startJob: (request: GenerationWorkflowRequest) => Promise<TStartJobResponse>;
  /** Overrides the primary action when generation is coordinated outside one direct job. */
  onGenerate?: (request: GenerationWorkflowRequest) => void | Promise<void>;
  generateDisabled?: boolean;
  createPendingJob: (response: TStartJobResponse, context: TContext | null) => TJob;
  buildJobUrl: (jobId: string) => string;
  labels: {
    loadingContext: string;
    contextTitle: string;
    commentTitle: string;
    commentPlaceholder: string;
    previewPrompt: string;
    copyPrompt: string;
    generate: string;
    promptPreview: string;
    jobStatus: (status: TJob["status"]) => string;
    openResult: string;
    generationFailed: string;
  };
  generateIcon?: ReactNode;
  /** When set, renders an "add to queue" button that emits the current request. */
  onAddToQueue?: (request: GenerationWorkflowRequest) => void;
  addToQueueLabel?: string;
  addToQueueDisabled?: boolean;
  /** External busy flag (e.g. a queue is running): disables one-off generation. */
  externalBusy?: boolean;
  onClose: () => void;
  onSuccess: () => void;
  onOpenResult: () => void;
}) {
  const [state, setState] = useState<GenerationWorkflowState>("loading-context");
  const [context, setContext] = useState<TContext | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [userComment, setUserComment] = useState("");
  const [prompt, setPrompt] = useState<TPrompt | null>(null);
  const [job, setJob] = useState<TJob | null>(null);
  const [error, setError] = useState<string | null>(null);

  const contextItems = useMemo(() => context ? props.contextItems(context) : [], [context, props]);
  const selectedContextIds = useMemo(() => Array.from(selectedIds), [selectedIds]);
  const isGenerating = state === "job-running" || state === "starting-job";

  useEffect(() => {
    let cancelled = false;
    setState("loading-context");
    setContext(null);
    setPrompt(null);
    setJob(null);
    setError(null);

    props.loadContext()
      .then((nextContext) => {
        if (cancelled) return;
        const nextItems = props.contextItems(nextContext);
        setContext(nextContext);
        props.onContextLoaded?.(nextContext);
        setSelectedIds(new Set(nextItems.filter((item) => item.selected).map((item) => item.id)));
        setState("editing-context");
      })
      .catch((contextError) => {
        if (cancelled) return;
        setError(errorMessage(contextError));
        setState("job-error");
      });

    return () => {
      cancelled = true;
    };
  }, [props.resetKey]);

  useGenerationJobPolling<TJob>({
    job,
    enabled: state === "job-running",
    buildJobUrl: props.buildJobUrl,
    onJob: setJob,
    onSuccess: () => {
      setState("job-success");
      props.onSuccess();
    },
    onError: (nextJob) => {
      setState("job-error");
      setError(nextJob.error ?? props.labels.generationFailed);
    },
    onRequestError: (jobError) => {
      setState("job-error");
      setError(errorMessage(jobError));
    },
  });

  return (
    <div className="source-modal-backdrop" role="presentation" onMouseDown={props.onClose}>
      <section
        className="source-modal generation-workflow-modal"
        role="dialog"
        aria-modal="true"
        aria-label={props.ariaLabel}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="source-modal-header">
          <div>
            <h2>{props.title}</h2>
            <span>{context ? props.targetPath(context) : props.loadingTargetLabel}</span>
          </div>
          <div className="source-modal-actions">
            <button type="button" onClick={props.onClose}>
              <X size={15} aria-hidden="true" />
              <span>Close</span>
            </button>
          </div>
        </header>

        <div className="generation-workflow-body">
          {state === "loading-context" ? <p className="muted-row">{props.labels.loadingContext}</p> : null}
          {context ? (
            <>
              {props.details ? (
                <section className="generation-workflow-details">
                  {props.details(context)}
                </section>
              ) : null}

              <section className="generation-workflow-section">
                <h3>{props.labels.contextTitle}</h3>
                <div className="generation-context-list">
                  {contextItems.map((item) => (
                    <label key={item.id} className="generation-context-item">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(item.id)}
                        onChange={() => setSelectedIds((current) => toggleSet(current, item.id))}
                        disabled={isGenerating}
                      />
                      <span>
                        <strong>{item.label}</strong>
                        <small>{item.detail}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </section>

              <section className="generation-workflow-section">
                <h3>{props.labels.commentTitle}</h3>
                <textarea
                  value={userComment}
                  onChange={(event) => setUserComment(event.target.value)}
                  placeholder={props.labels.commentPlaceholder}
                  disabled={isGenerating}
                />
              </section>

              <div className="generation-action-row">
                <button type="button" onClick={() => void buildPrompt()} disabled={state === "loading-prompt" || state === "job-running"}>
                  <FileText size={15} aria-hidden="true" />
                  <span>{props.labels.previewPrompt}</span>
                </button>
                <button type="button" onClick={() => void copyPrompt()} disabled={!prompt?.prompt}>
                  <Copy size={15} aria-hidden="true" />
                  <span>{props.labels.copyPrompt}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void generate()}
                  disabled={isGenerating || props.externalBusy || props.generateDisabled}
                >
                  {props.generateIcon ?? <Play size={15} aria-hidden="true" />}
                  <span>{props.labels.generate}</span>
                </button>
                {props.onAddToQueue ? (
                  <button
                    type="button"
                    onClick={() => props.onAddToQueue!({ selectedContextIds, userComment })}
                    disabled={isGenerating || props.addToQueueDisabled}
                  >
                    <ListPlus size={15} aria-hidden="true" />
                    <span>{props.addToQueueLabel ?? "Add to queue"}</span>
                  </button>
                ) : null}
              </div>

              {prompt ? (
                <section className="generation-workflow-section">
                  <h3>{props.labels.promptPreview}</h3>
                  <pre className="generation-prompt-preview">{prompt.prompt}</pre>
                </section>
              ) : null}
            </>
          ) : null}

          {job ? (
            <section className="generation-workflow-section">
              <h3>{props.labels.jobStatus(job.status)}</h3>
              <pre className="generation-job-logs">{job.logs.join("\n")}</pre>
              {state === "job-success" ? (
                <button type="button" onClick={props.onOpenResult}>{props.labels.openResult}</button>
              ) : null}
            </section>
          ) : null}

          {error ? <p className="source-error">{error}</p> : null}
        </div>
      </section>
    </div>
  );

  async function buildPrompt() {
    try {
      setState("loading-prompt");
      setError(null);
      const nextPrompt = await props.buildPrompt({ selectedContextIds, userComment });
      setPrompt(nextPrompt);
      setState("prompt-ready");
    } catch (promptError) {
      setState("job-error");
      setError(errorMessage(promptError));
    }
  }

  async function copyPrompt() {
    try {
      const currentPrompt = prompt ?? await props.buildPrompt({ selectedContextIds, userComment });
      setPrompt(currentPrompt);
      await navigator.clipboard.writeText(currentPrompt.prompt);
      setState("prompt-ready");
    } catch (copyError) {
      setState("job-error");
      setError(errorMessage(copyError));
    }
  }

  async function generate() {
    try {
      setState("starting-job");
      setError(null);
      if (props.onGenerate) {
        await props.onGenerate({ selectedContextIds, userComment });
        return;
      }
      const nextJob = await props.startJob({ selectedContextIds, userComment });
      setJob(props.createPendingJob(nextJob, context));
      setState("job-running");
    } catch (jobError) {
      setState("job-error");
      setError(errorMessage(jobError));
    }
  }
}

function toggleSet<T>(set: Set<T>, value: T) {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
