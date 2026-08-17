import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config/defaultConfig.js";
import type { ResolvedProjectMapConfig } from "../src/config/types.js";
import type { ProjectMapGraph, ProjectMapNode } from "../src/graph/types.js";
import {
  buildE2eCoverageSummary,
  buildE2eEnrichment,
} from "../src/modules/e2e/server/services/e2eEnrichmentService.js";

describe("buildE2eEnrichment", () => {
  it("badges covered components and pages with partial coverage", async () => {
    const projectRoot = await makeProject(["src/A.po.ts"]);
    const graph = createGraph();

    const enrichment = await buildE2eEnrichment({ config: config(projectRoot), projectRoot, graph });

    expect(enrichment.nodes).toContainEqual({
      nodeId: "component:a",
      badges: [{ id: "e2e-covered", label: "e2e", tone: "ok" }],
    });
    expect(enrichment.nodes?.some((node) => node.nodeId === "component:b")).toBe(false);
    expect(enrichment.nodes).toContainEqual({
      nodeId: "page:home",
      badges: [{ id: "e2e-coverage", label: "e2e 1/2", tone: "info" }],
    });
  });

  it("emits coveredByTest edges only when the test file node is in the graph", async () => {
    const projectRoot = await makeProject(["src/A.po.ts", "src/B.po.ts"]);

    const enrichment = await buildE2eEnrichment({
      config: config(projectRoot),
      projectRoot,
      graph: createGraph(),
    });

    // A's page object is a graph file node, B's is not scanned.
    expect(enrichment.edges).toEqual([
      {
        id: "e2e-covered:component:a",
        from: "component:a",
        to: "file:src/A.po.ts",
        type: "coveredByTest",
        label: "covered by",
      },
    ]);
  });

  it("warns about fully uncovered pages", async () => {
    const projectRoot = await makeProject([]);

    const enrichment = await buildE2eEnrichment({
      config: config(projectRoot),
      projectRoot,
      graph: createGraph(),
    });

    expect(enrichment.nodes).toEqual([
      {
        nodeId: "page:home",
        badges: [{ id: "e2e-coverage", label: "e2e 0/2", tone: "warn" }],
      },
    ]);
  });
});

describe("buildE2eCoverageSummary", () => {
  it("counts only fully covered pages", async () => {
    const partial = await makeProject(["src/A.po.ts"]);
    await expect(buildE2eCoverageSummary(createGraph(), partial)).resolves.toEqual({
      coveredPages: 0,
      totalPages: 1,
    });

    const full = await makeProject(["src/A.po.ts", "src/B.po.ts"]);
    await expect(buildE2eCoverageSummary(createGraph(), full)).resolves.toEqual({
      coveredPages: 1,
      totalPages: 1,
    });
  });
});

async function makeProject(pageObjectFiles: string[]) {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "project-map-e2e-"));
  await fs.mkdir(path.join(projectRoot, "src"), { recursive: true });
  for (const file of pageObjectFiles) {
    await fs.writeFile(path.join(projectRoot, file), "export class PO {}\n", "utf8");
  }
  return projectRoot;
}

function createGraph(): ProjectMapGraph {
  return {
    schemaVersion: "1.1.0",
    project: {
      name: "test",
      root: "/project",
      sourceRoot: "src",
    },
    nodes: [
      node("page:home", "page", "Home", "src/Page.tsx"),
      node("component:a", "component", "A", "src/A.tsx"),
      node("component:b", "component", "B", "src/B.tsx"),
      node("file:src/A.po.ts", "file", "A.po.ts", "src/A.po.ts"),
    ],
    edges: [
      edge("e1", "page:home", "component:a", "renders"),
      edge("e2", "page:home", "component:b", "renders"),
    ],
    stats: {
      nodesCount: 4,
      edgesCount: 2,
    },
  };
}

function node(id: string, type: ProjectMapNode["type"], name: string, file?: string): ProjectMapNode {
  return { id, type, name, file };
}

function edge(id: string, from: string, to: string, type: ProjectMapGraph["edges"][number]["type"]): ProjectMapGraph["edges"][number] {
  return { id, from, to, type, confidence: "high", evidence: [] };
}

function config(projectRoot: string): ResolvedProjectMapConfig {
  return {
    ...defaultConfig,
    projectRoot,
    sourceRootAbs: path.join(projectRoot, "src"),
    outputDirAbs: path.join(projectRoot, ".project-map"),
    tsconfigPathAbs: null,
  };
}
