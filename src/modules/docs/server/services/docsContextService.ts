import type { EdgeType, ProjectMapEdge, ProjectMapGraph, ProjectMapNode } from "../../../../graph/types.js";
import type { FlowIndex, FlowNode } from "../../../../flow/types.js";
import { resolveV2DocsPathForNode } from "./docsPathResolver.js";
import { readDocsFile } from "./docsFileService.js";
import { parseDocsV2File } from "./docsV2FileFormat.js";
import type { DocsContext, DocsContextItem } from "./docsTypes.js";

const OUTGOING_CONTEXT: Partial<Record<EdgeType, string>> = {
  usesHook: "Используется документируемым элементом",
  usesSelector: "Используется документируемым элементом",
  dispatchesAction: "Вызывается документируемым элементом",
  callsApi: "API-зависимость документируемого элемента",
  renders: "Рендерится документируемым элементом",
  dependsOn: "Прямая зависимость документируемого элемента",
};

export async function buildDocsContextForNode(params: {
  graph: ProjectMapGraph;
  nodeId: string;
  projectRoot: string;
  flowIndex?: FlowIndex;
  targetFlowNodeId?: string;
}): Promise<DocsContext> {
  const node = getNode(params.graph, params.nodeId);
  const docsPath = resolveV2DocsPathForNode(node);
  const suggestedContext: DocsContextItem[] = [];
  const seenFiles = new Set<string>();

  if (node.file) {
    suggestedContext.push({
      id: "main-file",
      label: "Основной файл",
      type: "source-file",
      file: node.file,
      selected: true,
      reason: "Документируемый элемент находится в этом файле",
    });
    seenFiles.add(node.file);
  }

  for (const edge of directOutgoingContextEdges(params.graph, node.id)) {
    const related = getNode(params.graph, edge.to);
    addRelatedItem(suggestedContext, seenFiles, edge, related, OUTGOING_CONTEXT[edge.type] ?? "Связанный элемент", true);
  }

  for (const edge of params.graph.edges.filter((entry) => entry.to === node.id && isProjectNode(getNode(params.graph, entry.from)))) {
    const related = getNode(params.graph, edge.from);
    addRelatedItem(suggestedContext, seenFiles, edge, related, "Использует документируемый элемент", true);
  }

  return {
    node: {
      id: node.id,
      name: node.name,
      type: node.type,
      file: node.file,
    },
    docsPath,
    suggestedContext,
    graphSummary: buildGraphSummary(params.graph, node),
    valueFlowSummary: params.flowIndex
      ? buildCanonicalValueFlowSummary(
          params.flowIndex,
          node,
          params.targetFlowNodeId
        )
      : buildValueFlowSummary(params.graph, node),
    values: params.flowIndex
      ? await buildContextValues({
          flowIndex: params.flowIndex,
          owner: node,
          projectRoot: params.projectRoot,
          docsPath,
        })
      : [],
  };
}

async function buildContextValues(params: {
  flowIndex: FlowIndex;
  owner: ProjectMapNode;
  projectRoot: string;
  docsPath: string | null;
}): Promise<DocsContext["values"]> {
  const annotationKindsByTarget = new Map<string, Set<string>>();
  const valueSummaryTargets = new Set<string>();
  const businessRulesByTarget = new Map<string, Set<string>>();
  if (params.docsPath) {
    try {
      const parsed = parseDocsV2File(await readDocsFile(params.projectRoot, params.docsPath));
      for (const block of parsed?.blocks ?? []) {
        for (const target of block.metadata.targets) {
          if (target.type !== "flow-node") continue;
          const kinds = annotationKindsByTarget.get(target.id) ?? new Set<string>();
          kinds.add(block.metadata.kind);
          annotationKindsByTarget.set(target.id, kinds);
          if (block.metadata.kind === "value-meaning" && block.metadata.summary) {
            valueSummaryTargets.add(target.id);
          }
          if (block.metadata.kind === "business-rule" || block.metadata.kind === "role-rule") {
            const rules = businessRulesByTarget.get(target.id) ?? new Set<string>();
            rules.add(block.metadata.id);
            businessRulesByTarget.set(target.id, rules);
          }
        }
      }
    } catch {
      // Missing, legacy, or unreadable docs simply mean that owner values have
      // no v2 target coverage yet. Status/read endpoints surface file errors.
    }
  }

  return params.flowIndex.nodes
    .filter((node) =>
      node.ownerNodeId === params.owner.id &&
      node.kind !== "gap" &&
      node.kind !== "boundary" &&
      node.kind !== "ui-effect"
    )
    .map((node) => {
      const annotationKinds = [...(annotationKindsByTarget.get(node.id) ?? [])].sort();
      return {
        id: node.id,
        label: node.path ?? node.name,
        kind: node.kind,
        confidence: node.confidence,
        documented: annotationKinds.includes("value-meaning"),
        hasSummary: valueSummaryTargets.has(node.id),
        businessRuleCount: businessRulesByTarget.get(node.id)?.size ?? 0,
        suggestedCategory: suggestValueCategory(node),
        annotationKinds,
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
}

function directOutgoingContextEdges(graph: ProjectMapGraph, nodeId: string) {
  return graph.edges.filter((edge) =>
    edge.from === nodeId &&
    edge.type in OUTGOING_CONTEXT &&
    isProjectNode(getNode(graph, edge.to))
  );
}

function addRelatedItem(
  items: DocsContextItem[],
  seenFiles: Set<string>,
  edge: ProjectMapEdge,
  related: ProjectMapNode,
  reason: string,
  selected: boolean
) {
  if (!related.file || seenFiles.has(related.file)) return;
  seenFiles.add(related.file);
  items.push({
    id: `edge:${edge.id}`,
    label: relatedLabel(edge.type, related),
    type: "related-node",
    nodeId: related.id,
    file: related.file,
    selected,
    reason,
  });
}

function relatedLabel(edgeType: EdgeType, node: ProjectMapNode) {
  if (edgeType === "usesHook") return `Хук ${node.name}`;
  if (edgeType === "usesSelector") return `Selector ${node.name}`;
  if (edgeType === "dispatchesAction") return `Action ${node.name}`;
  if (edgeType === "callsApi") return `API ${node.name}`;
  if (edgeType === "renders") return `Дочерний компонент ${node.name}`;
  return `${node.type} ${node.name}`;
}

function buildGraphSummary(graph: ProjectMapGraph, node: ProjectMapNode) {
  const outgoing = graph.edges
    .filter((edge) => edge.from === node.id && edge.type in OUTGOING_CONTEXT)
    .map((edge) => {
      const target = getNode(graph, edge.to);
      return `- ${node.name} --${edge.type}--> ${target.type}:${target.name}${target.file ? ` (${target.file})` : ""}`;
    });
  const incoming = graph.edges
    .filter((edge) => edge.to === node.id)
    .map((edge) => {
      const source = getNode(graph, edge.from);
      return `- ${source.type}:${source.name} --${edge.type}--> ${node.name}${source.file ? ` (${source.file})` : ""}`;
    });

  return [...outgoing, ...incoming].join("\n") || "Прямые связи в графе не найдены.";
}

function buildValueFlowSummary(graph: ProjectMapGraph, node: ProjectMapNode) {
  const evidence = graph.edges
    .filter((edge) => edge.from === node.id || edge.to === node.id)
    .flatMap((edge) => edge.evidence.map((entry) => {
      const file = entry.file ? `${entry.file}:${entry.line}` : "inline";
      return `- ${edge.type} ${file}${entry.code ? `: ${entry.code}` : ""}`;
    }));

  return evidence.slice(0, 30).join("\n") || "Value-flow facts для этого узла не найдены.";
}

function buildCanonicalValueFlowSummary(
  flowIndex: FlowIndex,
  owner: ProjectMapNode,
  targetFlowNodeId?: string
) {
  const nodeById = new Map(flowIndex.nodes.map((node) => [node.id, node]));
  const focusNodes = targetFlowNodeId
    ? flowIndex.nodes.filter((node) => node.id === targetFlowNodeId)
    : flowIndex.nodes.filter((node) => node.ownerNodeId === owner.id);
  if (focusNodes.length === 0) {
    return "Canonical FlowIndex не содержит значений для этого узла.";
  }

  return focusNodes.slice(0, 20).map((focus) => {
    const flows = flowIndex.flows.filter((flow) => flow.nodeIds.includes(focus.id));
    const incident = flowIndex.edges.filter((edge) =>
      edge.from === focus.id || edge.to === focus.id
    );
    const upstream = incident
      .filter((edge) => edge.to === focus.id)
      .flatMap((edge) => nodeById.get(edge.from) ?? []);
    const downstream = incident
      .filter((edge) => edge.from === focus.id)
      .flatMap((edge) => nodeById.get(edge.to) ?? []);
    const flowNodes = new Set(flows.flatMap((flow) => flow.nodeIds));
    const gaps = flowIndex.nodes.filter((node) =>
      flowNodes.has(node.id) && node.kind === "gap"
    );

    return [
      `### ${focus.path ?? focus.name}`,
      `- canonical id: ${focus.id}`,
      `- kind / owner / confidence: ${focus.kind} / ${focus.ownerNodeId ?? "нет"} / ${focus.confidence}`,
      `- suggested semantic category: ${suggestValueCategory(focus)}`,
      `- flows: ${flows.map((flow) =>
        `${flow.id} [origin=${flow.coverage.origin}, continuation=${flow.coverage.continuation}, completeness=${flow.completeness}]`
      ).join("; ") || "нет"}`,
      `- upstream: ${flowNodeLabels(upstream)}`,
      `- downstream: ${flowNodeLabels(downstream)}`,
      `- gaps: ${gaps.map((gap) => gap.gap?.message ?? gap.name).join("; ") || "нет"}`,
      `- evidence: ${flowEvidenceLines(focus, incident)}`,
    ].join("\n");
  }).join("\n\n");
}

function suggestValueCategory(node: FlowNode) {
  const label = `${node.path ?? ""} ${node.name}`.toLowerCase();
  const compact = label.replace(/[^a-z0-9а-яё]/g, "");
  const type = node.valueSemantics?.type?.toLowerCase() ?? "";
  if (
    /(loading|pending|fetching|submitting|saving|deleting|processing)/.test(compact)
  ) return "ui-state" as const;
  if (
    /(error|expanded|open|selected|active)/.test(compact)
  ) return "ui-state" as const;
  if (
    /(^|[._-\s])(can|should|has|allow|allowed|available|enabled|disabled|visible|hidden)([._-\s]|$)/.test(label) ||
    /^(can|should|has|is[A-Z].*(Allowed|Available|Enabled|Disabled|Visible|Hidden))/.test(node.path ?? node.name)
  ) return "decision" as const;
  if (
    /(^|[._-])(on[A-Z]|handle|handler|callback|submit|click|change)([._-]|$)/.test(node.path ?? node.name) ||
    type.includes("=>") || type.includes("function")
  ) return "handler" as const;
  if (
    /(^|[._-])(input|query|search|filter|form|draft|comment|message)([._-]|$)/.test(label)
  ) return "user-input" as const;
  if (
    node.kind === "state-field" ||
    node.kind === "selector-result" ||
    node.kind === "hook-return" ||
    node.kind === "component-value" ||
    node.kind === "prop"
  ) return "domain-data" as const;
  return "technical" as const;
}

function flowNodeLabels(nodes: FlowNode[]) {
  return [...new Set(nodes.map((node) =>
    `${node.path ?? node.name} (${node.kind}, ${node.id})`
  ))].join("; ") || "нет";
}

function flowEvidenceLines(
  node: FlowNode,
  edges: FlowIndex["edges"]
) {
  const evidence = [
    ...node.evidence,
    ...edges.flatMap((edge) => edge.evidence),
  ];
  return [...new Set(evidence.map((entry) =>
    `${entry.file}${entry.line ? `:${entry.line}` : ""}${entry.code ? ` — ${entry.code}` : ""}`
  ))].slice(0, 12).join("; ") || "нет";
}

function getNode(graph: ProjectMapGraph, nodeId: string) {
  const node = graph.nodes.find((entry) => entry.id === nodeId);
  if (!node) throw Object.assign(new Error(`Node not found: ${nodeId}`), { statusCode: 404 });
  return node;
}

function isProjectNode(node: ProjectMapNode) {
  return node.type !== "external-package" && Boolean(node.file);
}
