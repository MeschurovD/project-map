import { useEffect, useState } from "react";
import { Beaker, Eye, FileText, FlaskConical, RefreshCw } from "lucide-react";
import type { ProjectMapNode } from "../../../../graph/types.js";
import { fetchJson } from "../../../ui/apiClient.js";
import type { E2eFileStatus, E2eGenerationTarget, E2eReadResponse, E2eStatusResponse } from "../../shared/apiTypes.js";
import { E2eFileModal } from "./E2eFileModal.js";
import { E2eGenerateModal } from "./E2eGenerateModal.js";

type GenerateState = {
  target: E2eGenerationTarget;
  mode: "create" | "regenerate";
} | null;

export function E2ePanel(props: { node: ProjectMapNode }) {
  const [status, setStatus] = useState<E2eStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<{ title: string; path: string; content: string } | null>(null);
  const [generate, setGenerate] = useState<GenerateState>(null);

  useEffect(() => {
    void refreshStatus();
  }, [props.node.id]);

  return (
    <section className="semantic-section docs-panel">
      <h3><FlaskConical size={15} aria-hidden="true" /> E2E / Page Object</h3>
      {loading ? <p className="muted-row">Проверяем Page Object coverage...</p> : null}
      {error ? <p className="source-error">{error}</p> : null}

      {status?.status === "unsupported" ? (
        <div className="docs-status-block">
          <strong>Page Object недоступен</strong>
          <span>{status.reason}</span>
        </div>
      ) : null}

      {status?.status === "component" ? (
        <>
          <FileCoverageBlock
            title="Page Object"
            status={status.pageObject}
            missingLabel="Сгенерировать Page Object"
            regenerateLabel="Перегенерировать"
            viewLabel="Посмотреть"
            onView={() => void openFile("page-object")}
            onGenerate={() => setGenerate({ target: "page-object", mode: "create" })}
            onRegenerate={() => setGenerate({ target: "page-object", mode: "regenerate" })}
          />

          <FileCoverageBlock
            title="PO test coverage"
            status={status.poSpec}
            missingLabel="Сгенерировать spec для PO"
            regenerateLabel="Перегенерировать spec"
            viewLabel="Посмотреть spec"
            onView={() => void openFile("po-spec")}
            onGenerate={() => setGenerate({ target: "po-spec", mode: "create" })}
            onRegenerate={() => setGenerate({ target: "po-spec", mode: "regenerate" })}
          />

          <BusinessFlowBlock />
        </>
      ) : null}

      {status?.status === "page" ? (
        <>
          <section className="docs-status-block">
            <strong>Page E2E coverage</strong>
            <span>Dependent components:</span>
            {status.dependentPageObjects.length ? (
              <ul className="e2e-dependency-list">
                {status.dependentPageObjects.map((dependency) => (
                  <li key={dependency.nodeId}>
                    <span>{dependency.name}</span>
                    <small>{dependency.status === "exists" ? "PO найден" : "PO отсутствует"} · {dependency.pageObjectPath}</small>
                  </li>
                ))}
              </ul>
            ) : (
              <small>Зависимые component Page Objects не найдены.</small>
            )}
            <strong>Coverage: {status.coverage.existing} / {status.coverage.total} Page Objects exist</strong>
            <div className="docs-button-row">
              <button type="button" disabled>Сгенерировать недостающие PO</button>
              <button type="button" disabled>Сгенерировать page e2e spec</button>
            </div>
          </section>
          <BusinessFlowBlock />
        </>
      ) : null}

      {file ? <E2eFileModal title={file.title} path={file.path} content={file.content} onClose={() => setFile(null)} /> : null}
      {generate ? (
        <E2eGenerateModal
          node={props.node}
          target={generate.target}
          mode={generate.mode}
          onClose={() => setGenerate(null)}
          onSuccess={() => void refreshStatus()}
          onOpenResult={() => {
            const target = generate.target;
            setGenerate(null);
            void openFile(target);
          }}
        />
      ) : null}
    </section>
  );

  async function refreshStatus() {
    setLoading(true);
    setError(null);
    try {
      setStatus(await fetchJson<E2eStatusResponse>(`/api/e2e/node/${encodeURIComponent(props.node.id)}/status`));
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : String(statusError));
    } finally {
      setLoading(false);
    }
  }

  async function openFile(target: E2eGenerationTarget) {
    setError(null);
    const action = target === "page-object" ? "page-object" : "po-spec";
    const response = await fetchJson<E2eReadResponse>(`/api/e2e/node/${encodeURIComponent(props.node.id)}/${action}`);
    if (response.status !== "exists") {
      await refreshStatus();
      return;
    }
    setFile({
      title: target === "page-object" ? `Page Object: ${props.node.name}` : `PO spec: ${props.node.name}`,
      path: response.path,
      content: response.content,
    });
  }
}

function FileCoverageBlock(props: {
  title: string;
  status: E2eFileStatus;
  missingLabel: string;
  regenerateLabel: string;
  viewLabel: string;
  onView: () => void;
  onGenerate: () => void;
  onRegenerate: () => void;
}) {
  return (
    <section className="docs-status-block">
      <strong>{props.title}</strong>
      <span>Статус: {props.status.status === "exists" ? "найден" : "отсутствует"}</span>
      <span>{props.status.status === "exists" ? "Файл:" : "Ожидаемый файл:"}</span>
      <code>{props.status.path ?? props.status.expectedPath}</code>
      {props.status.status === "exists" && props.status.sizeBytes !== undefined && props.status.updatedAt ? (
        <small>{formatBytes(props.status.sizeBytes)} · {new Date(props.status.updatedAt).toLocaleString()}</small>
      ) : null}
      <div className="docs-button-row">
        {props.status.status === "exists" ? (
          <>
            <button type="button" onClick={props.onView}>
              <Eye size={15} aria-hidden="true" />
              <span>{props.viewLabel}</span>
            </button>
            <button type="button" onClick={props.onRegenerate}>
              <RefreshCw size={15} aria-hidden="true" />
              <span>{props.regenerateLabel}</span>
            </button>
          </>
        ) : (
          <button type="button" onClick={props.onGenerate}>
            <FileText size={15} aria-hidden="true" />
            <span>{props.missingLabel}</span>
          </button>
        )}
      </div>
    </section>
  );
}

function BusinessFlowBlock() {
  return (
    <section className="docs-status-block">
      <strong>Business flow</strong>
      <span>Доступно для features/widgets/pages. Статус: experimental / not implemented.</span>
      <button type="button" disabled>
        <Beaker size={15} aria-hidden="true" />
        <span>Сгенерировать business flow</span>
      </button>
      <small>Будет добавлено после MVP Page Object coverage.</small>
    </section>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return `${Math.round(bytes / 1024)} KB`;
}
