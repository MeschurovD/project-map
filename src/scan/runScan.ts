import { createHash, randomUUID } from "node:crypto";
import { buildGraph } from "../graph/buildGraph.js";
import { loadConfig } from "../config/loadConfig.js";
import { collectFacts } from "../scanner/collectFacts.js";
import { createTsProject } from "../scanner/createProject.js";
import { scanFiles } from "../scanner/scanFiles.js";
import { writeArtifacts, type ProjectMapStats } from "../output/writeArtifacts.js";
import { resolveValueFlowTargets } from "../flow/resolveValueFlowTargets.js";
import { buildFlowIndex } from "../flow/buildFlowIndex.js";

export async function runScan(args: { projectRoot: string }) {
  const config = await loadConfig(args.projectRoot);
  const files = await scanFiles(config);
  const project = createTsProject(config, files);
  const collectedFacts = collectFacts(project, files, config);
  const graph = buildGraph(collectedFacts, config);
  const facts = resolveValueFlowTargets(collectedFacts, graph);
  const flowIndex = buildFlowIndex({
    graph,
    facts,
    metadata: {
      runId: randomUUID(),
      generatedAt: new Date().toISOString(),
      sourceFingerprint: createHash("sha256").update(JSON.stringify(facts)).digest("hex"),
    },
  });
  const stats: ProjectMapStats = {
    filesCount: files.length,
    factsCount: facts.length,
    unresolvedCount: facts.filter((fact) => fact.type.startsWith("unresolved")).length,
    nodesCount: graph.nodes.length,
    edgesCount: graph.edges.length,
  };

  await writeArtifacts({ config, facts, graph, flowIndex, stats });

  return {
    config,
    files,
    facts,
    graph,
    flowIndex,
    stats,
  };
}
