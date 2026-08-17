import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ProjectMapGraph, ProjectMapNode } from "../src/graph/types.js";
import { buildE2eContextForNode } from "../src/modules/e2e/server/services/e2eContextService.js";
import { resolveComponentE2eTargets } from "../src/modules/e2e/server/services/e2ePathResolver.js";
import { buildE2ePrompt } from "../src/modules/e2e/server/services/e2ePromptService.js";
import { getE2eStatusForNode } from "../src/modules/e2e/server/services/e2eStatusService.js";

describe("e2ePathResolver", () => {
  it("resolves colocated Page Object and PO spec paths for component nodes", () => {
    expect(resolveComponentE2eTargets(node("component:a", "component", "A", "src/features/a/ui/A.tsx"))).toEqual({
      pageObjectPath: "src/features/a/ui/A.po.ts",
      poSpecPath: "src/features/a/ui/A.po.spec.ts",
    });
  });

  it("returns null for unsupported nodes", () => {
    expect(resolveComponentE2eTargets(node("hook:a", "hook", "useA", "src/useA.ts"))).toBeNull();
    expect(resolveComponentE2eTargets(node("page:home", "page", "Home", "src/Page.tsx"))).toBeNull();
    expect(resolveComponentE2eTargets(node("component:no-file", "component", "NoFile"))).toBeNull();
  });
});

describe("e2eStatusService", () => {
  it("reports component Page Object and PO spec status", async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "project-map-e2e-"));
    await fs.mkdir(path.join(projectRoot, "src"), { recursive: true });
    await fs.writeFile(path.join(projectRoot, "src", "A.po.ts"), "export class APO {}\n", "utf8");
    const graph = createGraph();

    await expect(getE2eStatusForNode({ graph, nodeId: "component:a", projectRoot })).resolves.toMatchObject({
      status: "component",
      pageObject: {
        status: "exists",
        expectedPath: "src/A.po.ts",
        path: "src/A.po.ts",
      },
      poSpec: {
        status: "missing",
        expectedPath: "src/A.po.spec.ts",
      },
    });
    await expect(getE2eStatusForNode({ graph, nodeId: "hook:b", projectRoot })).resolves.toEqual({
      nodeId: "hook:b",
      status: "unsupported",
      reason: "Page Object coverage is available only for component nodes.",
    });
  });

  it("reports page overview of dependent Page Objects", async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "project-map-e2e-"));
    await fs.mkdir(path.join(projectRoot, "src"), { recursive: true });
    await fs.writeFile(path.join(projectRoot, "src", "A.po.ts"), "export class APO {}\n", "utf8");

    await expect(getE2eStatusForNode({ graph: createGraph(), nodeId: "page:home", projectRoot })).resolves.toMatchObject({
      status: "page",
      coverage: {
        existing: 1,
        total: 1,
      },
      dependentPageObjects: [{
        nodeId: "component:a",
        name: "A",
        pageObjectPath: "src/A.po.ts",
        status: "exists",
      }],
    });
  });
});

describe("e2eContextService", () => {
  it("includes target source, direct UI dependencies, and existing Page Object for spec generation", async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "project-map-e2e-"));
    await fs.mkdir(path.join(projectRoot, "src"), { recursive: true });
    await fs.writeFile(path.join(projectRoot, "src", "A.po.ts"), "export class APO {}\n", "utf8");

    const context = await buildE2eContextForNode({
      graph: createGraph(),
      nodeId: "component:a",
      projectRoot,
      target: "po-spec",
    });

    expect(context.target).toBe("po-spec");
    expect(context.targetPath).toBe("src/A.po.spec.ts");
    expect(context.suggestedContext.map((item) => item.file)).toEqual([
      "src/A.tsx",
      "src/A.po.ts",
      "src/useB.ts",
      "src/Page.tsx",
    ]);
  });
});

describe("e2ePromptService", () => {
  it("includes target path, source files, graph summary, and user comment", async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "project-map-e2e-"));
    await fs.mkdir(path.join(projectRoot, "src"), { recursive: true });
    await fs.writeFile(path.join(projectRoot, "src", "A.tsx"), "export function A() { return <button>Delete</button>; }\n", "utf8");

    const prompt = await buildE2ePrompt({
      node: node("component:a", "component", "A", "src/A.tsx"),
      target: "page-object",
      pageObjectPath: "src/A.po.ts",
      poSpecPath: "src/A.po.spec.ts",
      targetPath: "src/A.po.ts",
      userComment: "Expose delete action.",
      selectedContext: [{
        id: "main-file",
        label: "Main component source",
        type: "source-file",
        file: "src/A.tsx",
        selected: true,
        reason: "main",
      }],
      graphSummary: "A uses useB",
      projectRoot,
    });

    expect(prompt).toContain("src/A.po.ts");
    expect(prompt).toContain("Create a Page Object");
    expect(prompt).toContain("Expose delete action.");
    expect(prompt).toContain("A uses useB");
    expect(prompt).toContain("export function A");
  });
});

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
      node("hook:b", "hook", "useB", "src/useB.ts"),
    ],
    edges: [
      edge("e1", "page:home", "component:a", "renders"),
      edge("e2", "component:a", "hook:b", "usesHook"),
    ],
    stats: {
      nodesCount: 3,
      edgesCount: 2,
    },
  };
}

function node(id: string, type: ProjectMapNode["type"], name: string, file?: string): ProjectMapNode {
  return {
    id,
    type,
    name,
    file,
  };
}

function edge(id: string, from: string, to: string, type: ProjectMapGraph["edges"][number]["type"]): ProjectMapGraph["edges"][number] {
  return {
    id,
    from,
    to,
    type,
    confidence: "high",
    evidence: [],
  };
}
