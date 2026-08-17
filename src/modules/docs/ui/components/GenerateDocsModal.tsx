import { CheckCircle2, ListChecks, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { StartGenerationJobResponse } from "../../../../generation/jobs/apiTypes.js";
import type { ProjectMapNode } from "../../../../graph/types.js";
import { fetchJson, postJson } from "../../../ui/apiClient.js";
import { GenerationWorkflowModal, type GenerationWorkflowRequest } from "../../../ui/components/GenerationWorkflowModal.js";
import { docsQueueStore, useDocsQueue } from "../queue/docsQueueStore.js";
import type {
  DocsContextResponse,
  DocsContextValue,
  DocsGenerationScope,
  DocsJobResponse,
  DocsMode,
  DocsPromptResponse,
} from "../../shared/apiTypes.js";

type StartDocsJobResponse = StartGenerationJobResponse;

export function GenerateDocsModal(props: {
  node: ProjectMapNode;
  mode: DocsMode;
  scope?: DocsGenerationScope;
  onClose: () => void;
  onSuccess: () => void;
  onOpenDocs: () => void;
}) {
  const { isRunning } = useDocsQueue();
  const supportsValueBatch = !props.scope &&
    props.mode !== "migrate" &&
    (props.node.type === "component" || props.node.type === "hook");
  const [batchEnabled, setBatchEnabled] = useState(false);
  const [includeOwner, setIncludeOwner] = useState(props.mode !== "regenerate");
  const [values, setValues] = useState<DocsContextValue[]>([]);
  const [selectedValueIds, setSelectedValueIds] = useState<Set<string>>(new Set());
  const lastRequest = useRef<GenerationWorkflowRequest>({ selectedContextIds: [], userComment: "" });
  const selectedValues = useMemo(
    () => values.filter((value) => selectedValueIds.has(value.id)),
    [selectedValueIds, values]
  );
  const canGenerateValuesOnly = props.mode === "regenerate";
  const generateOwner = !batchEnabled || !canGenerateValuesOnly || includeOwner;
  const valuesOnly = batchEnabled && !generateOwner;

  useEffect(() => {
    setBatchEnabled(false);
    setIncludeOwner(props.mode !== "regenerate");
    setValues([]);
    setSelectedValueIds(new Set());
  }, [props.node.id, props.mode, props.scope]);

  return (
    <GenerationWorkflowModal<DocsContextResponse, DocsPromptResponse, DocsJobResponse, StartDocsJobResponse>
      resetKey={`${props.node.id}:${props.mode}`}
      title={`${scopeLabel(props.scope, props.mode)} for ${props.node.name}`}
      ariaLabel={`${scopeLabel(props.scope, props.mode)} for ${props.node.name}`}
      targetPath={(context) => context.docsPath}
      loadingTargetLabel="Loading docs path..."
      contextItems={(context) => context.suggestedContext.map((item) => ({
        id: item.id,
        label: item.label,
        detail: item.file ?? item.reason,
        selected: item.selected,
      }))}
      onContextLoaded={(context) => {
        setValues(context.values);
        setSelectedValueIds(new Set(
          context.values.filter(needsValueDocumentation).map((value) => value.id)
        ));
      }}
      details={supportsValueBatch ? () => (
        <DocsValueBatchSelector
          enabled={batchEnabled}
          values={values}
          selectedIds={selectedValueIds}
          canGenerateValuesOnly={canGenerateValuesOnly}
          includeOwner={generateOwner}
          onEnabledChange={(enabled) => {
            setBatchEnabled(enabled);
            if (enabled && selectedValueIds.size === 0) {
              setSelectedValueIds(new Set(values.filter(needsValueDocumentation).map((value) => value.id)));
            }
          }}
          onIncludeOwnerChange={setIncludeOwner}
          onSelectedIdsChange={setSelectedValueIds}
        />
      ) : undefined}
      loadContext={() => fetchJson<DocsContextResponse>(
        `/api/docs/node/${encodeURIComponent(props.node.id)}/context${contextQuery(props.scope)}`
      )}
      buildPrompt={(request) => postDocsPrompt(
        props.node.id,
        props.mode,
        valuesOnly && selectedValues[0] ? valueScope(selectedValues[0]) : props.scope,
        request
      )}
      startJob={(request) => {
        lastRequest.current = request;
        return postJson<StartDocsJobResponse>(`/api/docs/node/${encodeURIComponent(props.node.id)}/generate`, {
          selectedContextIds: request.selectedContextIds,
          userComment: request.userComment,
          mode: props.mode,
          scope: props.scope,
        });
      }}
      onGenerate={valuesOnly ? (request) => {
        enqueueValues(selectedValues, request);
        props.onClose();
        void docsQueueStore.start();
      } : undefined}
      generateDisabled={valuesOnly && selectedValues.length === 0}
      createPendingJob={(job, context) => ({
        jobId: job.jobId,
        nodeId: props.node.id,
        docsPath: context?.docsPath ?? "",
        status: job.status,
        startedAt: new Date().toISOString(),
        logs: ["Job created"],
      })}
      buildJobUrl={(jobId) => `/api/docs/jobs/${encodeURIComponent(jobId)}`}
      labels={{
        loadingContext: "Loading context...",
        contextTitle: "Context",
        commentTitle: valuesOnly
          ? "Что уточнить у значений?"
          : props.mode === "migrate"
          ? "Что сохранить или уточнить?"
          : props.mode === "regenerate"
            ? "Что изменить?"
            : "Комментарий",
        commentPlaceholder: valuesOnly
          ? "Например: опиши бизнес-смысл, ограничения и важные состояния выбранных значений."
          : props.mode === "migrate"
          ? "Например: сохрани проверенные бизнес-правила и уточни роли."
          : "Сделай акцент на props, loading state или важных сценариях.",
        previewPrompt: "Preview prompt",
        copyPrompt: "Copy prompt",
        generate: batchEnabled
          ? selectedValues.length > 0
            ? generateOwner
              ? `${props.mode === "create" ? "Сгенерировать" : "Перегенерировать"} документацию + ${valueCountLabel(selectedValues.length)}`
              : `Сгенерировать ${valueCountLabel(selectedValues.length)}`
            : generateOwner
              ? `${props.mode === "create" ? "Сгенерировать" : "Перегенерировать"} основную документацию`
              : "Выберите значения"
          : "Generate with OpenCode",
        promptPreview: "Prompt preview",
        jobStatus: (status) => `Job status: ${status}`,
        openResult: "Open documentation",
        generationFailed: "OpenCode generation failed",
      }}
      generateIcon={props.mode !== "create" ? <RefreshCw size={15} aria-hidden="true" /> : undefined}
      addToQueueLabel="Добавить в очередь"
      addToQueueDisabled={valuesOnly && selectedValues.length === 0}
      externalBusy={isRunning}
      onAddToQueue={(request) => {
        if (generateOwner) {
          docsQueueStore.enqueue({
            nodeId: props.node.id,
            nodeName: props.node.name,
            mode: props.mode,
            selectedContextIds: request.selectedContextIds,
            userComment: request.userComment,
            scope: props.scope,
          });
        }
        if (batchEnabled) enqueueValues(selectedValues, request);
        props.onClose();
      }}
      onClose={props.onClose}
      onSuccess={() => {
        props.onSuccess();
        if (!batchEnabled || selectedValues.length === 0) return;
        enqueueValues(selectedValues, lastRequest.current);
        void docsQueueStore.start();
      }}
      onOpenResult={props.onOpenDocs}
    />
  );

  function enqueueValues(
    selected: DocsContextValue[],
    request: { selectedContextIds?: string[]; userComment: string }
  ) {
    for (const value of selected) {
      docsQueueStore.enqueue({
        nodeId: props.node.id,
        nodeName: `${props.node.name} · ${value.label}`,
        mode: "regenerate",
        selectedContextIds: request.selectedContextIds,
        userComment: request.userComment,
        scope: valueScope(value),
      });
    }
  }
}

function DocsValueBatchSelector(props: {
  enabled: boolean;
  values: DocsContextValue[];
  selectedIds: Set<string>;
  canGenerateValuesOnly: boolean;
  includeOwner: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onIncludeOwnerChange: (includeOwner: boolean) => void;
  onSelectedIdsChange: (ids: Set<string>) => void;
}) {
  const incomplete = props.values.filter(needsValueDocumentation);
  return (
    <div className="docs-value-batch">
      <label className="docs-value-batch-toggle">
        <input
          type="checkbox"
          checked={props.enabled}
          onChange={(event) => props.onEnabledChange(event.target.checked)}
        />
        <ListChecks size={18} aria-hidden="true" />
        <span>
          <strong>Последовательно документировать значения</strong>
          <small>Выбранные значения будут обработаны отдельными jobs строго по одному.</small>
        </span>
      </label>
      {props.enabled ? (
        <div className="docs-value-batch-body">
          {props.canGenerateValuesOnly ? (
            <fieldset className="docs-value-batch-mode">
              <legend>Что генерировать</legend>
              <label>
                <input
                  type="radio"
                  name="docs-value-batch-mode"
                  checked={!props.includeOwner}
                  onChange={() => props.onIncludeOwnerChange(false)}
                />
                <span>
                  <strong>Только выбранные значения</strong>
                  <small>Основная документация останется без изменений. Preview покажет prompt первого выбранного значения.</small>
                </span>
              </label>
              <label>
                <input
                  type="radio"
                  name="docs-value-batch-mode"
                  checked={props.includeOwner}
                  onChange={() => props.onIncludeOwnerChange(true)}
                />
                <span>
                  <strong>Основная документация + значения</strong>
                  <small>Сначала будет перегенерирован owner document, затем выбранные значения.</small>
                </span>
              </label>
            </fieldset>
          ) : (
            <div className="docs-value-batch-owner-required">
              <strong>Сначала будет создана основная документация</strong>
              <small>После неё последовательно запустятся выбранные значения.</small>
            </div>
          )}
          <div className="docs-value-batch-summary">
            <span>{props.values.length} canonical values</span>
            <strong>{props.selectedIds.size} выбрано</strong>
            <span>{incomplete.length} требуют документации</span>
          </div>
          <div className="docs-value-batch-actions">
            <button type="button" onClick={() => props.onSelectedIdsChange(new Set(incomplete.map((value) => value.id)))}>
              Выбрать неполные
            </button>
            <button type="button" onClick={() => props.onSelectedIdsChange(new Set(props.values.map((value) => value.id)))}>
              Выбрать все
            </button>
            <button type="button" onClick={() => props.onSelectedIdsChange(new Set())}>
              Снять выбор
            </button>
          </div>
          {props.values.length === 0 ? (
            <p className="muted-row">FlowIndex не содержит canonical values для этого узла.</p>
          ) : (
            <div className="docs-value-batch-list">
              {props.values.map((value) => (
                <label
                  key={value.id}
                  className={value.documented
                    ? value.hasSummary ? "is-documented" : "is-incomplete"
                    : undefined}
                >
                  <input
                    type="checkbox"
                    checked={props.selectedIds.has(value.id)}
                    onChange={() => props.onSelectedIdsChange(toggleValue(props.selectedIds, value.id))}
                  />
                  <span className="docs-value-batch-name">
                    <strong>{value.label}</strong>
                    <small>{value.suggestedCategory} · {value.kind} · {value.confidence}</small>
                  </span>
                  {value.documented && value.hasSummary ? (
                    <span className="docs-value-batch-status documented">
                      <CheckCircle2 size={13} aria-hidden="true" />
                      Есть документация
                      <small>{value.businessRuleCount} бизнес-правил · {value.annotationKinds.join(", ")}</small>
                    </span>
                  ) : value.documented ? (
                    <span className="docs-value-batch-status incomplete">
                      Есть подробное · нет краткого описания
                      <small>{value.businessRuleCount} бизнес-правил · {value.annotationKinds.join(", ")}</small>
                    </span>
                  ) : (
                    <span className="docs-value-batch-status missing">
                      Не документировано · нет value-meaning
                      {value.annotationKinds.length > 0
                        ? <small>{value.businessRuleCount} бизнес-правил · есть: {value.annotationKinds.join(", ")}</small>
                        : <small>0 бизнес-правил</small>}
                    </span>
                  )}
                </label>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function valueScope(value: DocsContextValue): DocsGenerationScope {
  return {
    type: "target",
    target: { type: "flow-node", id: value.id },
    createIfMissing: true,
    ensureValueMeaning: true,
    includeBusinessLogic: true,
  };
}

function needsValueDocumentation(value: DocsContextValue) {
  return !value.documented || !value.hasSummary;
}

function valueCountLabel(count: number) {
  const mod100 = count % 100;
  const mod10 = count % 10;
  const noun = mod100 >= 11 && mod100 <= 14
    ? "значений"
    : mod10 === 1
      ? "значение"
      : mod10 >= 2 && mod10 <= 4
        ? "значения"
        : "значений";
  return `${count} ${noun}`;
}

function toggleValue(current: Set<string>, id: string) {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function postDocsPrompt(
  nodeId: string,
  mode: DocsMode,
  scope: DocsGenerationScope | undefined,
  request: GenerationWorkflowRequest
) {
  return postJson<DocsPromptResponse>(`/api/docs/node/${encodeURIComponent(nodeId)}/prompt`, {
    selectedContextIds: request.selectedContextIds,
    userComment: request.userComment,
    mode,
    scope,
  });
}

function scopeLabel(scope: DocsGenerationScope | undefined, mode: DocsMode) {
  if (scope?.type === "annotation") return "Regenerate docs block";
  if (scope?.type === "target") return "Regenerate target docs";
  if (mode === "migrate") return "Migrate docs v1 → v2";
  return mode === "regenerate" ? "Regenerate docs" : "Generate docs";
}

function contextQuery(scope: DocsGenerationScope | undefined) {
  return scope?.type === "target" && scope.target.type === "flow-node"
    ? `?flowNodeId=${encodeURIComponent(scope.target.id)}`
    : "";
}
