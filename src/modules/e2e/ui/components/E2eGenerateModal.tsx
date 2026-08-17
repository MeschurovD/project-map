import { RefreshCw } from "lucide-react";
import type { StartGenerationJobResponse } from "../../../../generation/jobs/apiTypes.js";
import type { ProjectMapNode } from "../../../../graph/types.js";
import { fetchJson, postJson } from "../../../ui/apiClient.js";
import { GenerationWorkflowModal, type GenerationWorkflowRequest } from "../../../ui/components/GenerationWorkflowModal.js";
import type { E2eContextResponse, E2eGenerationTarget, E2eJobResponse, E2ePromptResponse } from "../../shared/apiTypes.js";

export function E2eGenerateModal(props: {
  node: ProjectMapNode;
  target: E2eGenerationTarget;
  mode: "create" | "regenerate";
  onClose: () => void;
  onSuccess: () => void;
  onOpenResult: () => void;
}) {
  const isSpec = props.target === "po-spec";
  const title = `${props.mode === "regenerate" ? "Regenerate" : "Generate"} ${isSpec ? "PO spec" : "Page Object"}`;

  return (
    <GenerationWorkflowModal<E2eContextResponse, E2ePromptResponse, E2eJobResponse, StartGenerationJobResponse>
      resetKey={`${props.node.id}:${props.target}:${props.mode}`}
      title={title}
      ariaLabel={`${title} for ${props.node.name}`}
      targetPath={(context) => context.targetPath}
      loadingTargetLabel="Loading target path..."
      contextItems={(context) => context.suggestedContext.map((item) => ({
        id: item.id,
        label: item.label,
        detail: item.file ?? item.reason,
        selected: item.selected,
      }))}
      details={(context) => (
        <>
          <dl>
            <dt>Component</dt>
            <dd>{context.node.name}</dd>
            <dt>Source file</dt>
            <dd>{context.node.file ?? "No source file"}</dd>
            <dt>{isSpec ? "PO spec will be created" : "Page Object will be created"}</dt>
            <dd>{context.targetPath}</dd>
          </dl>
          {isSpec ? (
            <div>
              <strong>Цель spec</strong>
              <p>Создать тестовый файл, который проверяет, что Page Object корректно работает с компонентом.</p>
              <ul>
                <li>mount/render component in test environment;</li>
                <li>use generated Page Object;</li>
                <li>verify important locators, basic interactions, and visible states;</li>
                <li>not test business flow deeply.</li>
              </ul>
            </div>
          ) : null}
        </>
      )}
      loadContext={() => fetchJson<E2eContextResponse>(`/api/e2e/node/${encodeURIComponent(props.node.id)}/context?target=${props.target}`)}
      buildPrompt={(request) => postE2ePrompt(props.node.id, props.target, request)}
      startJob={(request) => postJson<StartGenerationJobResponse>(`/api/e2e/node/${encodeURIComponent(props.node.id)}/generate`, {
        target: props.target,
        selectedContextIds: request.selectedContextIds,
        userComment: request.userComment,
      })}
      createPendingJob={(job, context) => ({
        jobId: job.jobId,
        nodeId: props.node.id,
        target: props.target,
        targetPath: context?.targetPath ?? "",
        status: job.status,
        startedAt: new Date().toISOString(),
        logs: ["Job created"],
      })}
      buildJobUrl={(jobId) => `/api/e2e/jobs/${encodeURIComponent(jobId)}`}
      labels={{
        loadingContext: "Loading context...",
        contextTitle: "Context",
        commentTitle: "User comment",
        commentPlaceholder: isSpec
          ? "Например: проверь empty/loading state или конкретное действие Page Object."
          : "Например: сфокусируйся на публичных действиях компонента и стабильных локаторах.",
        previewPrompt: "Preview prompt",
        copyPrompt: "Copy prompt",
        generate: "Generate with OpenCode",
        promptPreview: "Prompt preview",
        jobStatus: (status) => `Job status: ${status}`,
        openResult: isSpec ? "Open PO spec" : "Open Page Object",
        generationFailed: "OpenCode generation failed",
      }}
      generateIcon={props.mode === "regenerate" ? <RefreshCw size={15} aria-hidden="true" /> : undefined}
      onClose={props.onClose}
      onSuccess={props.onSuccess}
      onOpenResult={props.onOpenResult}
    />
  );
}

function postE2ePrompt(nodeId: string, target: E2eGenerationTarget, request: GenerationWorkflowRequest) {
  return postJson<E2ePromptResponse>(`/api/e2e/node/${encodeURIComponent(nodeId)}/prompt`, {
    target,
    selectedContextIds: request.selectedContextIds,
    userComment: request.userComment,
  });
}
