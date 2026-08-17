import { useEffect, useState } from "react";
import {
  BadgeCheck,
  BookOpen,
  Copy,
  FileText,
  RefreshCw,
  X,
} from "lucide-react";
import type { ProjectMapNode } from "../../../../graph/types.js";
import type {
  EnrichmentTarget,
  MergedEnrichmentAnnotation,
} from "../../../enrichmentTypes.js";
import { notifyEnrichmentChanged } from "../../../ui/enrichmentEvents.js";
import { fetchJson, postJson } from "../../../ui/apiClient.js";
import { EnrichmentMarkdown } from "../../../../ui/src/components/details/EnrichmentMarkdown.js";
import type {
  DocsMode,
  DocsGenerationScope,
  DocsReadResponse,
  DocsStatusResponse,
} from "../../shared/apiTypes.js";
import { GenerateDocsModal } from "./GenerateDocsModal.js";

export function DocumentationModal(props: {
  node: ProjectMapNode;
  annotations?: MergedEnrichmentAnnotation[];
  target?: EnrichmentTarget;
  targetLabel?: string;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<DocsStatusResponse | null>(null);
  const [document, setDocument] = useState<{ path: string; content: string } | null>(null);
  const [generation, setGeneration] = useState<{
    mode: DocsMode;
    scope?: DocsGenerationScope;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    "documentation" | "document" | "generate"
  >("documentation");

  useEffect(() => {
    setActiveTab("documentation");
    void refresh();
  }, [props.node.id]);

  if (generation) {
    return (
      <GenerateDocsModal
        node={props.node}
        mode={generation.mode}
        scope={generation.scope}
        onClose={() => setGeneration(null)}
        onSuccess={() => {
          notifyEnrichmentChanged();
          void refresh();
        }}
        onOpenDocs={() => {
          setGeneration(null);
          void refresh();
        }}
      />
    );
  }

  const path = document?.path ??
    (status?.status === "missing" ? status.expectedPath : undefined) ??
    (status?.status === "exists" || status?.status === "stale" ? status.path : undefined);

  return (
    <div className="source-modal-backdrop" role="presentation" onMouseDown={props.onClose}>
      <section
        className="source-modal documentation-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Документация: ${props.targetLabel ?? props.node.name}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="source-modal-header">
          <div>
            <h2>Документация: {props.targetLabel ?? props.node.name}</h2>
            <span>{path ?? props.node.id}</span>
          </div>
          <div className="source-modal-actions">
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(document?.content ?? "")}
              disabled={!document?.content}
            >
              <Copy size={15} aria-hidden="true" />
              <span>Copy</span>
            </button>
            <button type="button" onClick={props.onClose}>
              <X size={15} aria-hidden="true" />
              <span>Close</span>
            </button>
          </div>
        </header>

        <div className="documentation-modal-body">
          {loading ? <p className="muted-row">Проверяем документацию...</p> : null}
          {error ? <p className="source-error">{error}</p> : null}

          {status?.status === "unsupported" ? (
            <div className="docs-status-block">
              <strong>Документация недоступна для этого узла</strong>
              <span>{status.reason}</span>
            </div>
          ) : null}

          {status?.status === "missing" ? (
            <div className="documentation-empty">
              <FileText size={26} aria-hidden="true" />
              <strong>Документация отсутствует</strong>
              <span>Ожидаемый файл:</span>
              <code>{status.expectedPath}</code>
              <button type="button" onClick={() => setGeneration({ mode: "create" })}>
                <FileText size={15} aria-hidden="true" />
                <span>Сгенерировать</span>
              </button>
            </div>
          ) : null}

          {status?.status === "exists" || status?.status === "stale" ? (
            <>
              <nav className="documentation-tabs" aria-label="Разделы документации">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "documentation"}
                  className={activeTab === "documentation" ? "active" : undefined}
                  onClick={() => setActiveTab("documentation")}
                >
                  Документация
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "document"}
                  className={activeTab === "document" ? "active" : undefined}
                  onClick={() => setActiveTab("document")}
                >
                  Полный документ
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "generate"}
                  className={activeTab === "generate" ? "active" : undefined}
                  onClick={() => setActiveTab("generate")}
                >
                  Сгенерировать
                </button>
              </nav>

              {activeTab === "documentation" ? (
                <div className="documentation-tab-panel" role="tabpanel">
                  {props.target &&
                  status.format === "structured-v2" &&
                  (!props.annotations || props.annotations.length === 0) ? (
                    <section className="documentation-empty documentation-target-empty">
                      <FileText size={24} aria-hidden="true" />
                      <strong>Это значение ещё не документировано</strong>
                      <span>{props.targetLabel ?? props.target.id}</span>
                      <button
                        type="button"
                        onClick={() => setGeneration({
                          mode: "regenerate",
                          scope: {
                            type: "target",
                            target: props.target!,
                            createIfMissing: true,
                            includeBusinessLogic: true,
                          },
                        })}
                      >
                        <FileText size={15} aria-hidden="true" />
                        <span>Документировать значение</span>
                      </button>
                    </section>
                  ) : null}
                  {props.annotations && props.annotations.length > 0 ? (
                    <section className="documentation-annotations">
                      <div className="documentation-annotations-heading">
                        <div>
                          <span>Документация выбранного блока</span>
                          <strong>{props.node.name}</strong>
                        </div>
                        <small>{props.annotations.length} typed annotations</small>
                        {props.target ? (
                          <button
                            type="button"
                            onClick={() => setGeneration({
                              mode: "regenerate",
                              scope: {
                                type: "target",
                                target: props.target!,
                                includeBusinessLogic: true,
                              },
                            })}
                          >
                            <RefreshCw size={14} aria-hidden="true" />
                            <span>Уточнить документацию значения</span>
                          </button>
                        ) : null}
                      </div>
                      <div className="documentation-annotation-list">
                        {props.annotations.map((annotation) => (
                          <article
                            key={`${annotation.moduleId}:${annotation.id}`}
                            className="documentation-annotation"
                          >
                            <header>
                              <strong>{annotationKindLabel(annotation.kind)}</strong>
                              {annotation.review ? (
                                <span className={`enrichment-badge enrichment-badge-${
                                  annotation.review === "reviewed" ? "ok" : "info"
                                }`}>
                                  {annotation.review}
                                </span>
                              ) : null}
                              {annotation.stale ? (
                                <span className="enrichment-badge enrichment-badge-warn">stale</span>
                              ) : null}
                            </header>
                            <EnrichmentMarkdown markdown={annotation.markdown} />
                            {status.format === "structured-v2" ? (
                              <div className="docs-button-row">
                                <button
                                  type="button"
                                  onClick={() => void setReviewed(
                                    annotation.review !== "reviewed",
                                    [sourceAnnotationId(annotation)]
                                  )}
                                  disabled={reviewing}
                                >
                                  <BadgeCheck size={14} aria-hidden="true" />
                                  <span>
                                    {annotation.review === "reviewed"
                                      ? "Снять review блока"
                                      : "Отметить блок проверенным"}
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setGeneration({
                                    mode: "regenerate",
                                    scope: {
                                      type: "annotation",
                                      annotationIds: [sourceAnnotationId(annotation)],
                                    },
                                  })}
                                >
                                  <RefreshCw size={14} aria-hidden="true" />
                                  <span>Уточнить этот блок</span>
                                </button>
                              </div>
                            ) : null}
                          </article>
                        ))}
                      </div>
                    </section>
                  ) : !props.target ? (
                    <section className="documentation-empty documentation-no-annotations">
                      <BookOpen size={24} aria-hidden="true" />
                      <strong>Typed annotations отсутствуют</strong>
                      <span>Исходный Markdown доступен во вкладке «Полный документ».</span>
                    </section>
                  ) : null}
                  <div className="documentation-toolbar">
                    <div className="documentation-status">
                      <BookOpen size={15} aria-hidden="true" />
                      <strong>
                        {status.status === "stale" ? "Документация устарела" : "Документация загружена"}
                      </strong>
                      {status.reviewed ? (
                        <span className="enrichment-badge enrichment-badge-ok">reviewed</span>
                      ) : (
                        <span className="enrichment-badge enrichment-badge-info">generated</span>
                      )}
                      {status.status === "stale" ? (
                        <span className="enrichment-badge enrichment-badge-warn">stale</span>
                      ) : null}
                    </div>
                    {status.format === "structured" || status.format === "structured-v2" ? (
                      <div className="docs-button-row">
                        <button
                          type="button"
                          onClick={() => void setReviewed(!status.reviewed)}
                          disabled={reviewing}
                        >
                          <BadgeCheck size={15} aria-hidden="true" />
                          <span>{status.reviewed ? "Снять review" : "Отметить проверенной"}</span>
                        </button>
                      </div>
                    ) : null}
                  </div>
                  {status.status === "stale" && status.staleReasons?.length ? (
                    <div className="documentation-stale-reasons" role="status">
                      <strong>Почему документация устарела</strong>
                      <ul>
                        {status.staleReasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {activeTab === "document" ? (
                <div className="documentation-tab-panel documentation-full-document" role="tabpanel">
                  <pre className="documentation-source"><code>{document?.content ?? ""}</code></pre>
                </div>
              ) : null}

              {activeTab === "generate" ? (
                <div className="documentation-tab-panel documentation-generate" role="tabpanel">
                  <RefreshCw size={26} aria-hidden="true" />
                  <strong>
                    {status.format === "structured"
                      ? "Миграция structured docs v1"
                      : "Перегенерация owner document"}
                  </strong>
                  <p>
                    {status.format === "structured"
                      ? "Исходный v1 останется на месте, новый документ будет записан в owner-specific docs v2 path."
                      : "Можно уточнить требования, проверить контекст и preview prompt до запуска."}
                  </p>
                  <button
                    type="button"
                    onClick={() => setGeneration({
                      mode: status.format === "structured" ? "migrate" : "regenerate",
                    })}
                  >
                    <RefreshCw size={15} aria-hidden="true" />
                    <span>
                      {status.format === "structured"
                        ? "Мигрировать в docs v2"
                        : "Перегенерировать с уточнением"}
                    </span>
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </section>
    </div>
  );

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const nextStatus = await fetchJson<DocsStatusResponse>(
        `/api/docs/node/${encodeURIComponent(props.node.id)}/status`
      );
      setStatus(nextStatus);
      if (nextStatus.status !== "exists" && nextStatus.status !== "stale") {
        setDocument(null);
        return;
      }

      const response = await fetchJson<DocsReadResponse>(
        `/api/docs/node/${encodeURIComponent(props.node.id)}`
      );
      if (response.status === "exists") {
        setDocument({ path: response.path, content: response.content });
      }
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    } finally {
      setLoading(false);
    }
  }

  async function setReviewed(reviewed: boolean, annotationIds?: string[]) {
    setReviewing(true);
    setError(null);
    try {
      const nextStatus = await postJson<DocsStatusResponse>(
        `/api/docs/node/${encodeURIComponent(props.node.id)}/reviewed`,
        { reviewed, annotationIds }
      );
      setStatus(nextStatus);
      notifyEnrichmentChanged();
      void refresh();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : String(reviewError));
    } finally {
      setReviewing(false);
    }
  }
}

function sourceAnnotationId(annotation: MergedEnrichmentAnnotation) {
  const prefix = annotation.documentId ? `${annotation.documentId}:` : "";
  return prefix && annotation.id.startsWith(prefix)
    ? annotation.id.slice(prefix.length)
    : annotation.id;
}

function annotationKindLabel(kind: string) {
  return ({
    summary: "Назначение",
    contract: "Контракт",
    "business-rule": "Бизнес-правило",
    scenario: "Сценарий",
    "user-flow": "Пользовательский поток",
    "role-rule": "Роли / permissions",
    "value-meaning": "Значение данных",
    gotcha: "Неочевидное поведение",
    "open-question": "Открытый вопрос",
  } as Record<string, string>)[kind] ?? kind;
}
