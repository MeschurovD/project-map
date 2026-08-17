import fs from "node:fs/promises";
import path from "node:path";
import type { EdgeType, ProjectMapEdge, ProjectMapGraph, ProjectMapNode } from "../../../../graph/types.js";
import type { E2eContextItem, E2eGenerationTarget } from "../../shared/apiTypes.js";
import { e2eFileExists } from "./e2eFileService.js";
import { resolveComponentE2eTargets, resolveE2eTargetPath } from "./e2ePathResolver.js";
import type { E2eContext } from "./e2eTypes.js";

const E2E_CONTEXT_EDGES: Partial<Record<EdgeType, string>> = {
  renders: "Rendered child component",
  usesHook: "Hook used by the component",
  usesSelector: "State read used by the component",
  dispatchesAction: "Action dispatched by the component",
  callsApi: "API call involved in the component",
  dependsOn: "Direct dependency of the component",
};

export async function buildE2eContextForNode(params: {
  graph: ProjectMapGraph;
  nodeId: string;
  projectRoot: string;
  target: E2eGenerationTarget;
}): Promise<E2eContext> {
  const node = getNode(params.graph, params.nodeId);
  const targets = resolveComponentE2eTargets(node);
  if (!targets) {
    throw Object.assign(new Error("Node is not supported by Page Object coverage"), { statusCode: 400 });
  }

  const suggestedContext: E2eContextItem[] = [];
  const seenFiles = new Set<string>();

  if (node.file) {
    suggestedContext.push({
      id: "main-file",
      label: "Main component source",
      type: "source-file",
      file: node.file,
      selected: true,
      reason: "The selected component is defined in this file",
    });
    seenFiles.add(node.file);
  }

  if (params.target === "po-spec") {
    await addExistingFileItem({
      items: suggestedContext,
      seenFiles,
      projectRoot: params.projectRoot,
      id: "page-object",
      label: "Page Object file",
      type: "existing-page-object",
      file: targets.pageObjectPath,
      selected: true,
      reason: "The spec should verify this Page Object",
    });
  }

  for (const edge of directContextEdges(params.graph, node.id)) {
    const related = getNode(params.graph, edge.to);
    addRelatedItem(suggestedContext, seenFiles, edge, related, E2E_CONTEXT_EDGES[edge.type] ?? "Related component dependency", true);
    await addRelatedPageObjectItem(suggestedContext, seenFiles, params.projectRoot, related, edge);
  }

  addTestSelectorItems(suggestedContext, node);
  await addNearbyExistingFiles(suggestedContext, seenFiles, params.projectRoot, node.file);

  for (const edge of params.graph.edges.filter((entry) => entry.to === node.id && isProjectNode(getNode(params.graph, entry.from)))) {
    const related = getNode(params.graph, edge.from);
    addRelatedItem(suggestedContext, seenFiles, edge, related, "Parent page/component usage", false);
  }

  return {
    node: {
      id: node.id,
      name: node.name,
      type: node.type,
      file: node.file,
    },
    target: params.target,
    pageObjectPath: targets.pageObjectPath,
    poSpecPath: targets.poSpecPath,
    targetPath: resolveE2eTargetPath(targets, params.target),
    suggestedContext,
    graphSummary: buildGraphSummary(params.graph, node),
  };
}

function directContextEdges(graph: ProjectMapGraph, nodeId: string) {
  return graph.edges.filter((edge) =>
    edge.from === nodeId &&
    edge.type in E2E_CONTEXT_EDGES &&
    isProjectNode(getNode(graph, edge.to))
  );
}

function addRelatedItem(
  items: E2eContextItem[],
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

async function addRelatedPageObjectItem(
  items: E2eContextItem[],
  seenFiles: Set<string>,
  projectRoot: string,
  related: ProjectMapNode,
  edge: ProjectMapEdge
) {
  const targets = resolveComponentE2eTargets(related);
  if (!targets || seenFiles.has(targets.pageObjectPath)) return;
  if (!await e2eFileExists(projectRoot, targets.pageObjectPath)) return;

  seenFiles.add(targets.pageObjectPath);
  items.push({
    id: `po:${edge.id}`,
    label: `Existing Page Object for ${related.name}`,
    type: "existing-page-object",
    nodeId: related.id,
    file: targets.pageObjectPath,
    selected: true,
    reason: "Existing related Page Object can be used as a dependency",
  });
}

async function addExistingFileItem(args: {
  items: E2eContextItem[];
  seenFiles: Set<string>;
  projectRoot: string;
  id: string;
  label: string;
  type: E2eContextItem["type"];
  file: string;
  selected: boolean;
  reason: string;
}) {
  if (args.seenFiles.has(args.file)) return;
  if (!await e2eFileExists(args.projectRoot, args.file)) return;
  args.seenFiles.add(args.file);
  args.items.push({
    id: args.id,
    label: args.label,
    type: args.type,
    file: args.file,
    selected: args.selected,
    reason: args.reason,
  });
}

function addTestSelectorItems(items: E2eContextItem[], node: ProjectMapNode) {
  const selectors = extractTestSelectors(node);
  for (const selector of selectors) {
    items.push({
      id: `selector:${selector}`,
      label: `Test selector: ${selector}`,
      type: "test-selector",
      selected: true,
      reason: "Found in scanner evidence or node metadata",
    });
  }
}

async function addNearbyExistingFiles(items: E2eContextItem[], seenFiles: Set<string>, projectRoot: string, sourceFile: string | undefined) {
  if (!sourceFile) return;
  const dir = path.posix.dirname(sourceFile);
  const absoluteDir = path.join(projectRoot, dir);
  let entries: string[];
  try {
    entries = await fs.readdir(absoluteDir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!/\.(po|spec|test)\.(ts|tsx)$/.test(entry)) continue;
    const file = path.posix.join(dir, entry);
    if (seenFiles.has(file)) continue;
    seenFiles.add(file);
    const isPo = entry.endsWith(".po.ts") || entry.endsWith(".po.tsx");
    items.push({
      id: `nearby:${file}`,
      label: isPo ? `Existing nearby Page Object: ${entry}` : `Existing nearby spec: ${entry}`,
      type: isPo ? "existing-page-object" : "existing-spec",
      file,
      selected: false,
      reason: isPo ? "Existing .po file near the component" : "Existing test/spec near the component",
    });
  }
}

function extractTestSelectors(node: ProjectMapNode) {
  const selectors = new Set<string>();
  const meta = node.meta ?? {};
  for (const value of Object.values(meta)) {
    collectSelectorValues(value, selectors);
  }
  return Array.from(selectors).slice(0, 20);
}

function collectSelectorValues(value: unknown, selectors: Set<string>) {
  if (typeof value === "string" && /data-testid|testid|selector/i.test(value)) {
    selectors.add(value);
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectSelectorValues(entry, selectors);
  }
  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) collectSelectorValues(entry, selectors);
  }
}

function relatedLabel(edgeType: EdgeType, node: ProjectMapNode) {
  if (edgeType === "renders") return `Rendered child component ${node.name}`;
  if (edgeType === "usesHook") return `Hook ${node.name}`;
  if (edgeType === "usesSelector") return `Selector ${node.name}`;
  if (edgeType === "dispatchesAction") return `Action ${node.name}`;
  if (edgeType === "callsApi") return `API ${node.name}`;
  return `${node.type} ${node.name}`;
}

function buildGraphSummary(graph: ProjectMapGraph, node: ProjectMapNode) {
  const outgoing = graph.edges
    .filter((edge) => edge.from === node.id && edge.type in E2E_CONTEXT_EDGES)
    .map((edge) => {
      const target = getNode(graph, edge.to);
      return `- ${node.type}:${node.name} --${edge.type}--> ${target.type}:${target.name}${target.file ? ` (${target.file})` : ""}`;
    });
  const incoming = graph.edges
    .filter((edge) => edge.to === node.id)
    .map((edge) => {
      const source = getNode(graph, edge.from);
      return `- ${source.type}:${source.name} --${edge.type}--> ${node.type}:${node.name}${source.file ? ` (${source.file})` : ""}`;
    });

  return [...outgoing, ...incoming].join("\n") || "No direct graph edges were found for this node.";
}

function getNode(graph: ProjectMapGraph, nodeId: string) {
  const node = graph.nodes.find((entry) => entry.id === nodeId);
  if (!node) throw Object.assign(new Error(`Node not found: ${nodeId}`), { statusCode: 404 });
  return node;
}

function isProjectNode(node: ProjectMapNode) {
  return node.type !== "external-package" && Boolean(node.file);
}
