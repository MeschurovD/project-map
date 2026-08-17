import type { FlowIndex } from "../../flow/types.js";
import type { PageOverview } from "../../flow/queries.js";
import type { ProjectMapGraph } from "../../graph/types.js";
import type {
  EnrichmentTarget,
  MergedEnrichmentAnnotation,
} from "../../modules/enrichmentTypes.js";

export type PageBusinessContextEntry = {
  annotation: MergedEnrichmentAnnotation;
  targets: Array<{ target: EnrichmentTarget; label: string }>;
};

export type PageBusinessContext = {
  rules: PageBusinessContextEntry[];
  scenarios: PageBusinessContextEntry[];
  cautions: PageBusinessContextEntry[];
  totalCount: number;
};

const RULE_KINDS = new Set(["business-rule", "role-rule"]);
const SCENARIO_KINDS = new Set(["scenario", "user-flow"]);
const CAUTION_KINDS = new Set(["gotcha", "open-question"]);

export function buildPageBusinessContext(params: {
  graph: ProjectMapGraph;
  overview: PageOverview;
  flowIndex: FlowIndex;
  annotations: MergedEnrichmentAnnotation[];
}): PageBusinessContext {
  const nodeIds = new Set([
    params.overview.pageId,
    ...params.overview.topologyNodes.map((node) => node.id),
  ]);
  const pageFlowIds = new Set(params.overview.flows.map((flow) => flow.id));
  const flowNodeIds = new Set(params.flowIndex.flows
    .filter((flow) => pageFlowIds.has(flow.id))
    .flatMap((flow) => flow.nodeIds));
  const graphNodeById = new Map(params.graph.nodes.map((node) => [node.id, node]));
  const flowNodeById = new Map(params.flowIndex.nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  const rules: PageBusinessContextEntry[] = [];
  const scenarios: PageBusinessContextEntry[] = [];
  const cautions: PageBusinessContextEntry[] = [];

  for (const annotation of params.annotations) {
    if (annotation.moduleId !== "docs") continue;
    const targets = annotation.targets.flatMap((target): PageBusinessContextEntry["targets"] => {
      if (target.type === "node" && nodeIds.has(target.id)) {
        return [{ target, label: graphNodeById.get(target.id)?.name ?? target.id }];
      }
      if (target.type === "flow-node" && flowNodeIds.has(target.id)) {
        const node = flowNodeById.get(target.id);
        return [{ target, label: node?.path ?? node?.name ?? target.id }];
      }
      return [];
    });
    if (targets.length === 0) continue;
    const key = `${annotation.moduleId}:${annotation.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const entry = { annotation, targets };
    if (RULE_KINDS.has(annotation.kind)) rules.push(entry);
    else if (SCENARIO_KINDS.has(annotation.kind)) scenarios.push(entry);
    else if (CAUTION_KINDS.has(annotation.kind)) cautions.push(entry);
  }

  return {
    rules,
    scenarios,
    cautions,
    totalCount: rules.length + scenarios.length + cautions.length,
  };
}
