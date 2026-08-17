import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config/defaultConfig.js";
import type { ResolvedProjectMapConfig } from "../src/config/types.js";
import type { FlowIndex } from "../src/flow/types.js";
import type { ProjectMapGraph, ProjectMapNode } from "../src/graph/types.js";
import { buildDocsEnrichment } from "../src/modules/docs/server/services/docsEnrichmentService.js";
import { computeSourceHash } from "../src/modules/docs/server/services/docsFileService.js";
import { buildMergedEnrichment } from "../src/modules/server/buildMergedEnrichment.js";
import type { GraphEnrichment, ProjectMapServerModule } from "../src/modules/types.js";

describe("buildMergedEnrichment", () => {
  it("tags every node and edge with the module id", async () => {
    const merged = await buildMergedEnrichment(
      [
        module("docs", {
          nodes: [{ nodeId: "component:a", badges: [{ id: "docs", label: "docs" }] }],
          edges: [{ id: "x1", from: "component:a", to: "hook:b", type: "coveredByTest" }],
        }),
        module("e2e", {
          nodes: [{ nodeId: "component:a", summary: "covered" }],
        }),
      ],
      context()
    );

    expect(merged.warnings).toEqual([]);
    expect(merged.nodes).toEqual([
      expect.objectContaining({ nodeId: "component:a", moduleId: "docs" }),
      expect.objectContaining({ nodeId: "component:a", moduleId: "e2e", summary: "covered" }),
    ]);
    expect(merged.edges).toEqual([
      expect.objectContaining({ id: "x1", moduleId: "docs" }),
    ]);
  });

  it("keeps annotations with canonical targets and drops unresolved targets", async () => {
    const merged = await buildMergedEnrichment(
      [
        module("docs", {
          annotations: [{
            id: "rule:availability",
            ownerNodeId: "component:a",
            kind: "business-rule",
            targets: [
              { type: "node", id: "component:a" },
              { type: "flow-node", id: "component-value:component:a#visible" },
              { type: "flow-node", id: "component-value:component:a#ghost" },
            ],
            markdown: "Visible for owners.",
          }],
        }),
      ],
      { ...context(), flowIndex: createFlowIndex() }
    );

    expect(merged.annotations).toEqual([
      expect.objectContaining({
        id: "rule:availability",
        moduleId: "docs",
        targets: [
          { type: "node", id: "component:a" },
          { type: "flow-node", id: "component-value:component:a#visible" },
        ],
      }),
    ]);
    expect(merged.warnings).toEqual([
      expect.stringContaining('component-value:component:a#ghost'),
    ]);
  });

  it("drops references to unknown nodes with a warning", async () => {
    const merged = await buildMergedEnrichment(
      [
        module("docs", {
          nodes: [
            { nodeId: "component:a", summary: "kept" },
            { nodeId: "component:ghost", summary: "dropped" },
          ],
          edges: [
            { id: "x1", from: "component:a", to: "selector:ghost", type: "coveredByTest" },
          ],
        }),
      ],
      context()
    );

    expect(merged.nodes).toEqual([expect.objectContaining({ nodeId: "component:a" })]);
    expect(merged.edges).toEqual([]);
    expect(merged.warnings).toEqual([
      expect.stringContaining('unknown node "component:ghost"'),
      expect.stringContaining('"selector:ghost"'),
    ]);
  });

  it("turns a failing module into a warning and keeps the rest", async () => {
    const failing: ProjectMapServerModule = {
      id: "broken",
      registerRoutes: () => [],
      buildEnrichment: () => Promise.reject(new Error("boom")),
    };

    const merged = await buildMergedEnrichment(
      [failing, module("docs", { nodes: [{ nodeId: "component:a" }] })],
      context()
    );

    expect(merged.nodes).toEqual([expect.objectContaining({ moduleId: "docs" })]);
    expect(merged.warnings).toEqual([expect.stringContaining('"broken"')]);
  });

  it("skips modules without buildEnrichment", async () => {
    const plain: ProjectMapServerModule = { id: "plain", registerRoutes: () => [] };
    const merged = await buildMergedEnrichment([plain], context());

    expect(merged).toEqual({
      schemaVersion: "1.1.0",
      nodes: [],
      edges: [],
      annotations: [],
      warnings: [],
    });
  });
});

describe("buildDocsEnrichment", () => {
  it("adds only a docs badge for legacy files without frontmatter", async () => {
    const projectRoot = await makeProject();
    await fs.writeFile(path.join(projectRoot, "src", "A.docs.md"), "# A\n", "utf8");

    const enrichment = await buildDocsEnrichment({ ...context(projectRoot), projectRoot });

    expect(enrichment.nodes).toEqual([
      {
        nodeId: "component:a",
        badges: [{ id: "docs", label: "docs", tone: "info" }],
      },
    ]);
  });

  it("extracts summary, sections and badges from structured docs", async () => {
    const projectRoot = await makeProject();
    const sourceHash = await computeSourceHash(projectRoot, "src/A.tsx");
    await fs.writeFile(path.join(projectRoot, "src", "A.docs.md"), structuredDocs({
      node: "component:a",
      sourceHash,
      reviewed: true,
    }), "utf8");

    const enrichment = await buildDocsEnrichment({ ...context(projectRoot), projectRoot });
    const entry = enrichment.nodes?.find((node) => node.nodeId === "component:a");

    expect(entry?.summary).toBe("Кнопка удаления записи.");
    expect(entry?.badges).toEqual([
      { id: "docs", label: "docs", tone: "info" },
      { id: "docs-reviewed", label: "reviewed", tone: "ok" },
      { id: "docs-gotchas", label: "gotchas", tone: "warn" },
    ]);
    expect(entry?.sections?.map((section) => section.id)).toEqual([
      "business-rules",
      "gotchas",
      "open-questions",
    ]);
    expect(enrichment.annotations).toEqual([
      expect.objectContaining({
        id: "src/A.docs.md:summary",
        ownerNodeId: "component:a",
        kind: "summary",
        targets: [{ type: "node", id: "component:a" }],
        review: "reviewed",
        stale: false,
      }),
      expect.objectContaining({
        id: "src/A.docs.md:business-rules",
        kind: "business-rule",
        markdown: expect.stringContaining("[showButton]"),
      }),
      expect.objectContaining({
        id: "src/A.docs.md:gotchas",
        kind: "gotcha",
      }),
      expect.objectContaining({
        id: "src/A.docs.md:open-questions",
        kind: "open-question",
      }),
    ]);
  });

  it("marks docs stale when the source hash no longer matches", async () => {
    const projectRoot = await makeProject();
    await fs.writeFile(path.join(projectRoot, "src", "A.docs.md"), structuredDocs({
      node: "component:a",
      sourceHash: "000000000000",
    }), "utf8");

    const enrichment = await buildDocsEnrichment({ ...context(projectRoot), projectRoot });
    const entry = enrichment.nodes?.find((node) => node.nodeId === "component:a");

    expect(entry?.badges).toContainEqual({ id: "docs-stale", label: "stale", tone: "warn" });
    expect(enrichment.annotations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "src/A.docs.md:summary",
          stale: true,
          review: "generated",
        }),
      ])
    );
  });

  it("compiles docs v2 blocks into node projection and typed annotations", async () => {
    const projectRoot = await makeProject();
    await fs.mkdir(path.join(projectRoot, "src", "A.docs"), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, "src", "A.docs.md"),
      "# Legacy source-level fallback\n",
      "utf8"
    );
    await fs.writeFile(
      path.join(projectRoot, "src", "A.docs", "A.md"),
      v2Docs(),
      "utf8"
    );

    const enrichment = await buildDocsEnrichment({
      ...context(projectRoot),
      projectRoot,
    });

    expect(enrichment.nodes).toEqual([
      expect.objectContaining({
        nodeId: "component:a",
        summary: "Объясняет бизнес-смысл A.",
        badges: expect.arrayContaining([
          { id: "docs", label: "docs", tone: "info" },
          { id: "docs-gotchas", label: "gotchas", tone: "warn" },
        ]),
      }),
    ]);
    expect(enrichment.annotations).toEqual([
      expect.objectContaining({
        id: "src/A.docs/A.md:summary",
        ownerNodeId: "component:a",
        kind: "summary",
        targets: [{ type: "node", id: "component:a" }],
      }),
      expect.objectContaining({
        id: "src/A.docs/A.md:visible-rule",
        kind: "gotcha",
        propagation: "context",
        targets: [
          { type: "node", id: "component:a" },
          { type: "flow-node", id: "component-value:component:a#visible" },
        ],
      }),
    ]);
  });

  it("gives nodes not named in the frontmatter badges but no content", async () => {
    const projectRoot = await makeProject();
    const sourceHash = await computeSourceHash(projectRoot, "src/A.tsx");
    await fs.writeFile(path.join(projectRoot, "src", "A.docs.md"), structuredDocs({
      node: "component:other",
      sourceHash,
    }), "utf8");

    const enrichment = await buildDocsEnrichment({ ...context(projectRoot), projectRoot });
    const entry = enrichment.nodes?.find((node) => node.nodeId === "component:a");

    expect(entry?.badges).toEqual([{ id: "docs", label: "docs", tone: "info" }]);
    expect(entry?.summary).toBeUndefined();
    expect(entry?.sections).toBeUndefined();
  });
});

async function makeProject() {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "project-map-enrichment-"));
  await fs.mkdir(path.join(projectRoot, "src"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "src", "A.tsx"), "export function A() {}\n", "utf8");
  return projectRoot;
}

function structuredDocs(params: { node: string; sourceHash: string; reviewed?: boolean }) {
  return `---
node: ${params.node}
sourceHash: ${params.sourceHash}
generated: 2026-06-12
schema: 1
reviewed: ${params.reviewed ?? false}
---

## Summary
Кнопка удаления записи.

## Business rules
- Кнопка скрыта до подтверждения. [showButton]

## Scenarios
Нет

## Gotchas
- Кнопка мигает до ответа запроса прав.

## Open questions
- Дублируется ли проверка прав?
`;
}

function v2Docs() {
  return `---
schema: project-map.docs/v2
owner: component:a
generatedAt: 2026-07-30T14:00:00Z
review: unreviewed
graphSchema: 1.1.0
flowSchema: 1.2.0
---

# A

<!-- project-map:block
{"id":"summary","kind":"summary","targets":[{"type":"node","id":"component:a"}]}
-->
Объясняет бизнес-смысл A.
<!-- /project-map:block -->

<!-- project-map:block
{"id":"visible-rule","kind":"gotcha","targets":[
  {"type":"node","id":"component:a"},
  {"type":"flow-node","id":"component-value:component:a#visible"}
]}
-->
До загрузки прав значение отрицательное.
<!-- /project-map:block -->
`;
}

function module(id: string, enrichment: GraphEnrichment): ProjectMapServerModule {
  return {
    id,
    registerRoutes: () => [],
    buildEnrichment: () => Promise.resolve(enrichment),
  };
}

function context(projectRoot = "/project") {
  return {
    config: config(projectRoot),
    projectRoot,
    graph: createGraph(),
  };
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
      node("project:root", "project", "test"),
      node("component:a", "component", "A", "src/A.tsx"),
      node("hook:b", "hook", "useB", "src/useB.ts"),
    ],
    edges: [],
    stats: {
      nodesCount: 3,
      edgesCount: 0,
    },
  };
}

function createFlowIndex(): FlowIndex {
  return {
    schemaVersion: "1.4.0",
    runId: "enrichment-test",
    generatedAt: "2026-07-30T00:00:00.000Z",
    sourceFingerprint: "fixture",
    nodes: [{
      id: "component-value:component:a#visible",
      kind: "component-value",
      name: "visible",
      ownerNodeId: "component:a",
      confidence: "high",
      evidence: [],
    }],
    edges: [],
    flows: [],
    componentStructures: [],
    stats: {
      flowsCount: 0,
      completeFlowsCount: 0,
      gapsCount: 0,
      originResolvedFlowsCount: 0,
      originGapFlowsCount: 0,
      originUnknownFlowsCount: 0,
      continuationResolvedFlowsCount: 0,
    },
  };
}

function node(id: string, type: ProjectMapNode["type"], name: string, file?: string): ProjectMapNode {
  return { id, type, name, file };
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
