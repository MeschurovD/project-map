import { useEffect, useState } from "react";
import type { EdgeType, ProjectMapEdge, ProjectMapGraph, ProjectMapNode } from "../../../../graph/types.js";
import type { ProjectFact } from "../../../../scanner/facts.js";
import type { SourceLocation } from "../../../../analyzers/value-flow/types.js";
import { groupUsagesByTarget } from "../../../data-flow/groupUsagesByTarget.js";
import { hookReturnUsagesToDataFlowUsages } from "../../../data-flow/hookUsageViewModel.js";
import type { DataFlowTargetGroup } from "../../../data-flow/valueFlowTypes.js";
import {
  hookBindingFacts,
  hookDeclarationShapeFacts,
  hookReturnUsageFacts,
  localVariableUsageFacts,
  selectorBindingFacts,
  selectorStateReadFacts,
} from "../../../data-flow/valueFlowTypes.js";
import { buildComponentSemanticSummary, type ComponentOverviewLine, type ComponentSummarySectionKey } from "../../../data-flow/buildComponentSemanticSummary.js";
import { buildValueImpact, buildValueTrace } from "../../../data-flow/buildValueTrace.js";
import { useTraceFocusFor } from "../../traceFocus.js";
import { ValueTrace } from "./ValueTrace.js";
import { useT, type T } from "../../i18n.js";
import { TargetGroupCard } from "../data-flow/TargetGroupCard.js";
import { SourceViewerButton } from "../source/SourceViewerButton.js";
import { NodeList } from "../NodeList.js";

export function DataFlowDetails(props: {
  graph: ProjectMapGraph;
  node: ProjectMapNode;
  facts: ProjectFact[];
  selectedDataFlowTargetId?: string;
  onSelectDataFlowTarget: (targetId: string | undefined) => void;
  onOpenDataFlowTarget: (targetNodeId: string) => void;
  onViewEvidenceUsage: (evidence: SourceLocation, title: string) => void;
}) {
  if (props.node.type === "selector") {
    return <SelectorDataFlowDetails {...props} />;
  }
  if (props.node.type === "hook") {
    return <HookDataFlowDetails {...props} />;
  }
  if (props.node.type === "component") {
    return <ComponentDataFlowDetails {...props} />;
  }
  return null;
}

function SelectorDataFlowDetails(props: {
  graph: ProjectMapGraph;
  node: ProjectMapNode;
  facts: ProjectFact[];
  onViewEvidenceUsage: (evidence: SourceLocation, title: string) => void;
}) {
  const t = useT();
  const [traceDir, setTraceDir] = useState<"sources" | "impact">("sources");
  const reads = selectorStateReadFacts(props.facts).filter((fact) => fact.selectorName === props.node.name);
  const bindings = uniqueSelectorBindings(selectorBindingFacts(props.facts).filter((fact) => fact.selectorName === props.node.name));
  const usages = localVariableUsageFacts(props.facts);
  const hasFacts = reads.length > 0 || bindings.length > 0;
  if (!hasFacts) return null;
  const usageRows = bindings.flatMap((binding) =>
    usages
      .filter((usage) => usage.owner === binding.owner && usage.variableName === binding.localName)
      .map((usage) => ({
        label: usageSummary(usage.usageKind, usage.targetName, usage.propName, t),
        detail: binding.localName,
        location: usage.location,
        code: usage.code,
      }))
  );

  return (
    <section className="semantic-section">
      <h3>{t.secDataFlow}</h3>
      <DataFlowExplanation
        title={t.dfWhatThisDoes}
        lines={selectorExplanationLines(props.node.name, reads, bindings, usageRows, t)}
      />
      <FactList title={t.dfReadsOrDerivesFrom} rows={selectorInputRows(reads).map((read) => ({
        label: read.label,
        detail: "confidence" in read ? read.confidence : undefined,
        location: "location" in read ? read.location : undefined,
        code: "code" in read ? read.code : undefined,
      }))} onViewEvidenceUsage={props.onViewEvidenceUsage} />
      <FactList title={t.dfBoundAs} rows={bindings.map((binding) => ({
        label: binding.localName,
        detail: binding.owner,
        location: binding.location,
        code: binding.code,
      }))} onViewEvidenceUsage={props.onViewEvidenceUsage} />
      <FactList title={t.dfUsedFor} rows={usageRows} onViewEvidenceUsage={props.onViewEvidenceUsage} />
      <div className="data-flow-explanation">
        <h4>{t.dfTrace}</h4>
        <div className="trace-direction">
          <button type="button" className={traceDir === "sources" ? "active" : ""} onClick={() => setTraceDir("sources")}>{t.trSources}</button>
          <button type="button" className={traceDir === "impact" ? "active" : ""} onClick={() => setTraceDir("impact")}>{t.trImpact}</button>
        </div>
        <ValueTrace
          nodes={traceDir === "sources" ? buildValueTrace(props.facts, props.node) : buildValueImpact(props.facts, props.node)}
          onViewEvidence={props.onViewEvidenceUsage}
        />
      </div>
    </section>
  );
}

function HookDataFlowDetails(props: {
  graph: ProjectMapGraph;
  node: ProjectMapNode;
  facts: ProjectFact[];
  selectedDataFlowTargetId?: string;
  onSelectDataFlowTarget: (targetId: string | undefined) => void;
  onOpenDataFlowTarget: (targetNodeId: string) => void;
  onViewEvidenceUsage: (evidence: SourceLocation, title: string) => void;
}) {
  const t = useT();
  const [mode, setMode] = useState<"summary" | "by-target" | "by-value" | "raw">("by-target");
  const declarations = hookDeclarationShapeFacts(props.facts).filter((fact) => fact.hookName === props.node.name);
  const bindings = hookBindingFacts(props.facts).filter((fact) => fact.hookName === props.node.name);
  const usages = hookReturnUsageFacts(props.facts).filter((fact) => fact.hookName === props.node.name);
  const targetGroups = groupUsagesByTarget(hookReturnUsagesToDataFlowUsages(usages, props.graph));
  const visibleTargetGroups = props.selectedDataFlowTargetId
    ? targetGroups.filter((group) => group.id === props.selectedDataFlowTargetId)
    : targetGroups;
  const internalEdges = props.graph.edges.filter((edge) =>
    edge.from === props.node.id &&
    (edge.type === "usesSelector" || edge.type === "dispatchesAction" || edge.type === "callsApi")
  );
  const hasFacts = declarations.length > 0 || bindings.length > 0 || usages.length > 0 || internalEdges.length > 0;
  if (!hasFacts) return null;

  return (
    <section className="semantic-section">
      <h3>{t.secDataFlow}</h3>
      <SegmentedControl
        options={[
          ["summary", t.dfSummary],
          ["by-target", t.dfByTarget],
          ["by-value", t.dfByValue],
          ["raw", t.dfRawFacts],
        ]}
        value={mode}
        onChange={(nextMode) => setMode(nextMode as "summary" | "by-target" | "by-value" | "raw")}
      />
      {props.selectedDataFlowTargetId ? (
        <button className="inline-reset-button" type="button" onClick={() => props.onSelectDataFlowTarget(undefined)}>
          {t.dfAllTargets}
        </button>
      ) : null}
      {mode === "summary" ? (
        <>
          <DataFlowExplanation
            title={t.dfWhatThisDoes}
            lines={hookExplanationLines(props.node.name, declarations, bindings, targetGroups, internalEdges, t)}
          />
          <FactList title={t.dfConsumers} rows={targetGroups.map((group) => ({
            label: group.targetName,
            detail: `${t.dfReceives} ${group.stats.total} ${group.stats.total === 1 ? t.dfValue : t.dfValues}`,
          }))} onViewEvidenceUsage={props.onViewEvidenceUsage} />
        </>
      ) : null}
      {mode === "by-target" ? (
        <div className="target-group-list">
          {visibleTargetGroups.map((group) => (
            <TargetGroupCard
              key={group.id}
              group={group}
              selected={group.id === props.selectedDataFlowTargetId}
              onSelectTarget={props.onSelectDataFlowTarget}
              onOpenTarget={props.onOpenDataFlowTarget}
              onViewUsage={(usage) => {
                if (!usage.evidence) return;
                props.onViewEvidenceUsage(usage.evidence, `${usage.sourceName} -> ${usage.targetName ?? usage.usageKind}`);
              }}
            />
          ))}
        </div>
      ) : null}
      {mode === "by-value" ? (
        <FactList title={t.dfReturnUsages} rows={hookValueRows(usages, t)} onViewEvidenceUsage={props.onViewEvidenceUsage} />
      ) : null}
      {mode === "raw" ? (
        <>
          <FactList title={t.dfArguments} rows={declarations.flatMap((fact) => fact.params.map((param) => ({
            label: param,
            detail: fact.file,
            location: fact.location,
          })))} onViewEvidenceUsage={props.onViewEvidenceUsage} />
          <FactList title={t.dfReturns} rows={hookReturnRows(declarations, bindings)} onViewEvidenceUsage={props.onViewEvidenceUsage} />
          <FactList title={t.dfReturnUsages} rows={hookValueRows(usages, t)} onViewEvidenceUsage={props.onViewEvidenceUsage} />
          <NodeList
            title={t.listInternals}
            nodes={internalEdges.flatMap((edge) => props.graph.nodes.find((node) => node.id === edge.to) ?? [])}
            graph={props.graph}
            onViewNodeSource={() => undefined}
          />
        </>
      ) : null}
    </section>
  );
}

function ComponentDataFlowDetails(props: {
  graph: ProjectMapGraph;
  node: ProjectMapNode;
  facts: ProjectFact[];
  onViewEvidenceUsage: (evidence: SourceLocation, title: string) => void;
}) {
  const t = useT();
  const [mode, setMode] = useState<"summary" | "graph" | "raw" | "trace">("summary");
  // Clicking a Business-rule tag that resolves to this component opens the trace.
  const traceFocusNonce = useTraceFocusFor(props.node.id);
  useEffect(() => {
    if (traceFocusNonce) setMode("trace");
  }, [traceFocusNonce]);
  const selectorBindings = selectorBindingFacts(props.facts).filter((fact) => fact.ownerNodeId === props.node.id);
  const hookBindings = hookBindingFacts(props.facts).filter((fact) => fact.ownerNodeId === props.node.id);
  const usages = localVariableUsageFacts(props.facts);
  const hookUsages = hookReturnUsageFacts(props.facts).filter((fact) => fact.ownerNodeId === props.node.id);
  const summary = buildComponentSemanticSummary(props.graph, props.facts, props.node);
  if (selectorBindings.length === 0 && hookBindings.length === 0 && summary.sections.length === 0) return null;

  return (
    <section className="semantic-section">
      <h3>{t.secDataFlow}</h3>
      <SegmentedControl
        options={[
          ["summary", t.dfSummary],
          ["trace", t.dfTrace],
          ["graph", t.dfGraph],
          ["raw", t.dfRawFacts],
        ]}
        value={mode}
        onChange={(nextMode) => setMode(nextMode as "summary" | "graph" | "raw" | "trace")}
      />
      {mode === "trace" ? (
        <ValueTrace nodes={buildValueTrace(props.facts, props.node)} onViewEvidence={props.onViewEvidenceUsage} />
      ) : null}
      {mode === "summary" ? (
        <>
          <DataFlowExplanation
            title={t.dfOverview}
            lines={summary.overviewLines.map((line) => translateComponentOverviewLine(line, t))}
          />
          {summary.sections.map((section) => (
            <FactList
              key={section.titleKey}
              title={componentSummarySectionTitle(section.titleKey, t)}
              rows={section.rows.map((row) => ({
                ...row,
                label: translateComponentSummaryLabel(row.label, t),
                detail: translateComponentSummaryDetail(row.detail, t),
              }))}
              onViewEvidenceUsage={props.onViewEvidenceUsage}
            />
          ))}
        </>
      ) : null}
      {mode === "graph" ? (
        <>
          <DataFlowExplanation
            title={t.dfWhatThisDoes}
            lines={componentExplanationLines(props.node.name, selectorBindings, hookBindings, hookUsages, t)}
          />
          <FactList title={t.dfSelectorValues} rows={uniqueSelectorBindings(selectorBindings).map((binding) => {
            const usage = usages.find((entry) => entry.owner === binding.owner && entry.variableName === binding.localName);
            return {
              label: `${binding.selectorName} -> ${binding.localName}`,
              detail: usage ? usageSummary(usage.usageKind, usage.targetName, usage.propName, t) : undefined,
              location: usage?.location ?? binding.location,
              code: usage?.code ?? binding.code,
            };
          })} onViewEvidenceUsage={props.onViewEvidenceUsage} />
          <FactList title={t.dfHookValues} rows={hookBindings.map((binding) => ({
            label: `${binding.hookName} -> ${hookBindingSummary(binding)}`,
            detail: binding.arguments.join(", "),
            location: binding.location,
            code: binding.code,
          }))} onViewEvidenceUsage={props.onViewEvidenceUsage} />
          <FactList title={t.dfReturnUsages} rows={hookUsages.map((usage) => ({
            label: `${usage.localName} -> ${usageSummary(usage.usageKind, usage.targetName, usage.propName, t)}`,
            detail: usage.hookName,
            location: usage.location,
            code: usage.code,
          }))} onViewEvidenceUsage={props.onViewEvidenceUsage} />
        </>
      ) : null}
      {mode === "raw" ? (
        <FactList
          title={t.dfRawFacts}
          rows={summary.rawRows}
          onViewEvidenceUsage={props.onViewEvidenceUsage}
        />
      ) : null}
    </section>
  );
}

function SegmentedControl(props: {
  options: Array<[string, string]>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="segmented-control">
      {props.options.map(([value, label]) => (
        <button
          key={value}
          className={props.value === value ? "active" : ""}
          type="button"
          onClick={() => props.onChange(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function DataFlowExplanation(props: { title: string; lines: string[] }) {
  if (props.lines.length === 0) return null;

  return (
    <div className="data-flow-explanation">
      <h4>{props.title}</h4>
      <ul>
        {props.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

function FactList(props: {
  title: string;
  rows: Array<{
    label: string;
    detail?: string;
    location?: SourceLocation;
    code?: string;
  }>;
  onViewEvidenceUsage: (evidence: SourceLocation, title: string) => void;
}) {
  const t = useT();
  if (props.rows.length === 0) return null;

  return (
    <div className="semantic-list">
      <h4>{props.title}</h4>
      {props.rows.slice(0, 24).map((row, index) => (
        <div key={`${props.title}:${row.label}:${index}`} className="semantic-item">
          <div className="semantic-item-main">
            <strong>{row.label}</strong>
            {row.detail ? <span>{row.detail}</span> : null}
          </div>
          {row.location?.file ? (
            <SourceViewerButton
              label={t.btnViewUsage}
              size="small"
              onClick={() => props.onViewEvidenceUsage(row.location!, row.label)}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}

function componentSummarySectionTitle(key: ComponentSummarySectionKey, t: T) {
  if (key === "structure") return t.dfStructure;
  if (key === "hook") return t.dfHook;
  if (key === "hookState") return t.dfHookState;
  if (key === "hookTexts") return t.dfHookTexts;
  if (key === "hookAvailability") return t.dfHookAvailability;
  if (key === "hookHandlers") return t.dfHookHandlers;
  if (key === "hookOther") return t.dfHookOther;
  if (key === "selectorValues") return t.dfSelectorValues;
  if (key === "events") return t.dfEvents;
  return key;
}

function translateComponentOverviewLine(line: ComponentOverviewLine, t: T) {
  const names = line.names.join(", ");
  switch (line.kind) {
    case "rendersChildren": return `${t.relRenders}: ${names}`;
    case "usesHooks": return `${t.relUsesHook}: ${names}`;
    case "usesSelectors": return `${t.relReadsSelector}: ${names}`;
    case "dispatchesActions": return `${t.relDispatches}: ${names}`;
    case "callsApi": return `${t.relCallsApi}: ${names}`;
    case "passesState": return `${t.ovPassesProps}: ${names}`;
    case "passesHandlers": return `${t.ovPassesHandlers}: ${names}`;
    case "generic": return `${line.names[0] ?? ""} ${t.ovGeneric}`.trim();
  }
}

function translateComponentSummaryLabel(label: string, t: T) {
  return label
    .replace(/^renders /, `${t.relRenders} `)
    .replace(/^uses /, `${t.relUsesHook} `)
    .replace(/^reads /, `${t.relReadsSelector} `)
    .replace(/^dispatches /, `${t.relDispatches} `)
    .replace(/^calls /, `${t.relCallsApi} `);
}

function translateComponentSummaryDetail(detail: string | undefined, t: T) {
  if (!detail) return undefined;
  const match = detail.match(/^returns (\d+) values$/);
  if (match) return `${t.dfReturnsCount} ${match[1]}`;
  if (detail === "return shape unknown") return t.dfReturnShapeUnknown;
  return detail;
}

type SelectorStateRead = ReturnType<typeof selectorStateReadFacts>[number];

function selectorInputRows(reads: SelectorStateRead[]) {
  const fallback = { statePath: "unknown", confidence: "low" } as unknown as SelectorStateRead;
  const rows: SelectorStateRead[] = reads.length > 0 ? reads : [fallback];

  return rows.flatMap((read) => {
    const derived = read.derivedFromSelectors ?? [];
    if (derived.length > 0) {
      return derived.map((selectorName) => ({
        ...read,
        label: selectorName,
      }));
    }

    return [{
      ...read,
      label: read.statePath ?? "Derived selector",
    }];
  });
}

function selectorExplanationLines(
  selectorName: string,
  reads: ReturnType<typeof selectorStateReadFacts>,
  bindings: ReturnType<typeof selectorBindingFacts>,
  usageRows: Array<{ label: string }>,
  t: T
) {
  const inputs = selectorInputRows(reads).map((row) => row.label).filter((label) => label !== "unknown");
  const boundNames = uniqueStrings(bindings.map((binding) => binding.localName));
  const lines = [`${selectorName} ${t.dfExplSelectorDecides}`];
  if (inputs.length > 0) lines.push(`${t.dfExplDerivedFrom}: ${inputs.join(", ")}`);
  if (boundNames.length > 0) lines.push(`${t.dfExplAssignedTo}: ${boundNames.join(", ")}`);
  if (usageRows.length > 0) lines.push(`${t.dfExplThenControls}: ${uniqueStrings(usageRows.map((row) => row.label)).join(", ")}`);
  return lines;
}

function hookExplanationLines(
  hookName: string,
  declarations: ReturnType<typeof hookDeclarationShapeFacts>,
  bindings: ReturnType<typeof hookBindingFacts>,
  targetGroups: DataFlowTargetGroup[],
  internalEdges: ProjectMapEdge[],
  t: T
) {
  const returns = uniqueStrings([
    ...declarations.flatMap((fact) => fact.returnShape?.fields ?? []),
    ...bindings.flatMap(hookBindingFields),
  ]);
  const consumers = uniqueStrings(targetGroups.map((group) => group.targetName).filter((name) => name !== "unknown"));
  const internals = uniqueStrings(internalEdges.map((edge) => internalRelationLabel(edge.type, t)));
  const lines = targetGroups.length > 0
    ? [`${hookName}: ${t.dfExplHookUsedBy.replace("{count}", String(targetGroups.length))}`]
    : [`${hookName} ${t.dfExplHookCollects}`];
  if (internals.length > 0) lines.push(`${t.dfExplInternals}: ${internals.join(", ")}`);
  if (returns.length > 0) lines.push(`${t.dfExplReturns}: ${returns.join(", ")}`);
  if (consumers.length > 0) lines.push(`${t.dfExplMainConsumers}: ${consumers.slice(0, 5).join(", ")}`);
  return lines;
}

function componentExplanationLines(
  componentName: string,
  selectorBindings: ReturnType<typeof selectorBindingFacts>,
  hookBindings: ReturnType<typeof hookBindingFacts>,
  hookUsages: ReturnType<typeof hookReturnUsageFacts>,
  t: T
) {
  const selectors = uniqueStrings(selectorBindings.map((binding) => `${binding.selectorName} -> ${binding.localName}`));
  const hooks = uniqueStrings(hookBindings.map((binding) => `${binding.hookName} -> ${hookBindingSummary(binding)}`));
  const hookUsageRows = uniqueStrings(hookUsages.map((usage) => `${usage.localName} -> ${usageSummary(usage.usageKind, usage.targetName, usage.propName, t)}`));
  const lines = [`${componentName} ${t.dfExplComponentUses}`];
  if (selectors.length > 0) lines.push(`${t.dfSelectorValues}: ${selectors.join(", ")}`);
  if (hooks.length > 0) lines.push(`${t.dfHookValues}: ${hooks.join(", ")}`);
  if (hookUsageRows.length > 0) lines.push(`${t.dfExplThenControls}: ${hookUsageRows.join(", ")}`);
  return lines;
}

function uniqueSelectorBindings(bindings: ReturnType<typeof selectorBindingFacts>) {
  const byBinding = new Map<string, (typeof bindings)[number]>();
  for (const binding of bindings) {
    const key = `${binding.owner}\0${binding.localName}`;
    if (!byBinding.has(key)) byBinding.set(key, binding);
  }
  return [...byBinding.values()];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function internalRelationLabel(edgeType: EdgeType, t: T) {
  if (edgeType === "usesSelector") return t.relReadsSelector;
  if (edgeType === "dispatchesAction") return t.relDispatches;
  if (edgeType === "callsApi") return t.relCallsApi;
  return edgeType;
}

function hookReturnRows(
  declarations: ReturnType<typeof hookDeclarationShapeFacts>,
  bindings: ReturnType<typeof hookBindingFacts>
) {
  const declaredRows = declarations.flatMap((fact) =>
    fact.returnShape?.fields?.map((field) => ({
      label: field,
      detail: fact.returnShape?.kind,
      location: fact.location,
    })) ?? []
  );
  if (declaredRows.length > 0) return declaredRows;

  return bindings.flatMap((binding) => hookBindingFields(binding).map((field) => ({
    label: field,
    detail: binding.owner,
    location: binding.location,
    code: binding.code,
  })));
}

function hookValueRows(usages: ReturnType<typeof hookReturnUsageFacts>, t: T) {
  return usages.map((usage) => ({
    label: usage.sourceField ?? usage.localName,
    detail: usageSummary(usage.usageKind, usage.targetName, usage.propName, t),
    location: usage.location,
    code: usage.code,
  }));
}

function hookBindingFields(binding: ReturnType<typeof hookBindingFacts>[number]) {
  if (binding.boundTo.kind === "identifier") return [binding.boundTo.name];
  if (binding.boundTo.kind === "objectDestructure") return binding.boundTo.fields.map((field) => field.localName);
  if (binding.boundTo.kind === "arrayDestructure") return binding.boundTo.items.map((item) => item.localName);
  return [];
}

function hookBindingSummary(binding: ReturnType<typeof hookBindingFacts>[number]) {
  return hookBindingFields(binding).join(", ") || "—";
}

function usageSummary(usageKind: string, targetName: string | undefined, propName: string | undefined, t: T) {
  const target = targetName ? `: ${targetName}` : "";
  const prop = targetName ? `: ${targetName}.${propName ?? "prop"}` : "";
  const handler = targetName ? `: ${targetName}.${propName ?? "handler"}` : "";
  if (usageKind === "conditionalRender") return `${t.usageControlsRender}${target}`;
  if (usageKind === "ternaryCondition") return `${t.usageChoosesRender}${target}`;
  if (usageKind === "prop") return `${t.usagePassedTo}${prop}`;
  if (usageKind === "eventHandler") return `${t.usageHandles}${handler}`;
  if (usageKind === "hookArgument") return `${t.usageHookArgument}${target}`;
  if (usageKind === "actionArgument") return `${t.usageActionArgument}${target}`;
  if (usageKind === "functionArgument") return `${t.usageFunctionArgument}${target}`;
  if (usageKind === "renderedExpression") return t.usageRenderedExpression;
  return usageKind;
}
