import fs from "node:fs/promises";
import path from "node:path";
import type { ProjectMapGraph } from "../../graph/types.js";

export async function readGraph(projectRoot: string): Promise<ProjectMapGraph> {
  const graphPath = path.join(projectRoot, ".project-map", "graph.json");
  const raw = await fs.readFile(graphPath, "utf8");
  return JSON.parse(raw) as ProjectMapGraph;
}
