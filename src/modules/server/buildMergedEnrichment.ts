import type { ProjectMapGraph } from "../../graph/types.js";
import { ENRICHMENT_SCHEMA_VERSION, type MergedEnrichment } from "../enrichmentTypes.js";
import type { EnrichmentContext, ProjectMapServerModule } from "../types.js";

// Merges buildEnrichment results of all modules into one overlay. A module
// must never be able to break the map: a thrown error or a reference to a
// node the canonical graph does not have becomes a warning, not a failure.
export async function buildMergedEnrichment(
  modules: ProjectMapServerModule[],
  context: EnrichmentContext
): Promise<MergedEnrichment> {
  const knownNodeIds = new Set(context.graph.nodes.map((node) => node.id));
  const knownFlowNodeIds = new Set(context.flowIndex?.nodes.map((node) => node.id) ?? []);
  const knownOccurrenceIds = new Set(
    context.flowIndex?.componentStructures.flatMap((structure) =>
      structure.occurrences.map((occurrence) => occurrence.id)
    ) ?? []
  );
  const merged: MergedEnrichment = {
    schemaVersion: ENRICHMENT_SCHEMA_VERSION,
    nodes: [],
    edges: [],
    annotations: [],
    warnings: [],
  };

  for (const module of modules) {
    if (!module.buildEnrichment) continue;

    let enrichment;
    try {
      enrichment = await module.buildEnrichment(context);
    } catch (error) {
      merged.warnings.push(
        `module "${module.id}": buildEnrichment failed: ${error instanceof Error ? error.message : String(error)}`
      );
      continue;
    }

    for (const node of enrichment.nodes ?? []) {
      if (!knownNodeIds.has(node.nodeId)) {
        merged.warnings.push(`module "${module.id}": unknown node "${node.nodeId}" dropped`);
        continue;
      }
      merged.nodes.push({ ...node, moduleId: module.id });
    }

    for (const edge of enrichment.edges ?? []) {
      const broken = [edge.from, edge.to].filter((id) => !knownNodeIds.has(id));
      if (broken.length > 0) {
        merged.warnings.push(
          `module "${module.id}": edge "${edge.id}" references unknown node ${broken.map((id) => `"${id}"`).join(", ")} — dropped`
        );
        continue;
      }
      merged.edges.push({ ...edge, moduleId: module.id });
    }

    for (const annotation of enrichment.annotations ?? []) {
      if (!knownNodeIds.has(annotation.ownerNodeId)) {
        merged.warnings.push(
          `module "${module.id}": annotation "${annotation.id}" has unknown owner node "${annotation.ownerNodeId}" — dropped`
        );
        continue;
      }

      const targets = annotation.targets.filter((target) => {
        const known = target.type === "node"
          ? knownNodeIds.has(target.id)
          : target.type === "flow-node"
            ? knownFlowNodeIds.has(target.id)
            : knownOccurrenceIds.has(target.id);
        if (!known) {
          merged.warnings.push(
            `module "${module.id}": annotation "${annotation.id}" references unknown ${target.type} "${target.id}" — target dropped`
          );
        }
        return known;
      });
      if (targets.length === 0) {
        merged.warnings.push(
          `module "${module.id}": annotation "${annotation.id}" has no resolvable targets — dropped`
        );
        continue;
      }
      merged.annotations.push({ ...annotation, targets, moduleId: module.id });
    }
  }

  return merged;
}
