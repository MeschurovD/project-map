import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildDocsContextForNode } from "../src/modules/docs/server/services/docsContextService.js";
import { createDocsJob, appendJobLog, getDocsJob, markJobError, markJobSuccess } from "../src/modules/docs/server/services/docsJobService.js";
import {
  resolveDocsPathForNode,
  resolveDocsReadPathsForNode,
  resolveV2DocsPathForNode,
} from "../src/modules/docs/server/services/docsPathResolver.js";
import {
  buildDocsPartialPrompt,
  buildDocsPrompt,
  DOCS_PARTIAL_OUTPUT_TOKEN,
} from "../src/modules/docs/server/services/docsPromptService.js";
import { getDocsStatusForNode } from "../src/modules/docs/server/services/docsStatusService.js";
import { setDocsReviewed } from "../src/modules/docs/server/services/docsReviewService.js";
import { computeSourceDigest } from "../src/modules/docs/server/services/docsFileService.js";
import type { ProjectMapGraph, ProjectMapNode } from "../src/graph/types.js";
import type { FlowIndex } from "../src/flow/types.js";

const STRUCTURED_STALE = "---\nnode: component:a\nsourceHash: 000000000000\nschema: 1\nreviewed: false\n---\n\n## Summary\nКнопка.\n";
const V2_DOCS = `---
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
Компонент A.
<!-- /project-map:block -->
`;

describe("docsPathResolver", () => {
  it("resolves colocated docs paths", () => {
    expect(resolveDocsPathForNode({ file: "src/features/a/a.tsx" })).toBe("src/features/a/a.docs.md");
    expect(resolveDocsPathForNode({ file: "src/features/a/hooks/use-a.ts" })).toBe("src/features/a/hooks/use-a.docs.md");
  });

  it("returns null when node has no file", () => {
    expect(resolveDocsPathForNode({})).toBeNull();
  });

  it("resolves an owner-specific v2 path before the legacy fallback", () => {
    const target = {
      file: "src/features/a/A.tsx",
      name: "use A / permissions",
    };

    expect(resolveV2DocsPathForNode(target)).toBe(
      "src/features/a/A.docs/use-A-permissions.md"
    );
    expect(resolveDocsReadPathsForNode(target)).toEqual([
      "src/features/a/A.docs/use-A-permissions.md",
      "src/features/a/A.docs.md",
    ]);
  });
});

describe("docsStatusService", () => {
  it("reports missing, existing, and unsupported docs", async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "project-map-docs-"));
    await fs.mkdir(path.join(projectRoot, "src"), { recursive: true });
    await fs.writeFile(path.join(projectRoot, "src", "A.tsx"), "export function A() {}\n", "utf8");
    await fs.writeFile(path.join(projectRoot, "src", "A.docs.md"), "# A\n", "utf8");
    const graph = createGraph();

    await expect(getDocsStatusForNode({ graph, nodeId: "component:a", projectRoot })).resolves.toMatchObject({
      status: "exists",
      path: "src/A.docs.md",
    });
    await expect(getDocsStatusForNode({ graph, nodeId: "hook:b", projectRoot })).resolves.toEqual({
      nodeId: "hook:b",
      status: "missing",
      expectedPath: "src/useB.docs/useB.md",
    });
    await expect(getDocsStatusForNode({ graph, nodeId: "project:root", projectRoot })).resolves.toEqual({
      nodeId: "project:root",
      status: "unsupported",
      reason: "Node has no source file",
    });
  });

  it("reports structured docs with an outdated sourceHash as stale", async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "project-map-docs-"));
    await fs.mkdir(path.join(projectRoot, "src"), { recursive: true });
    await fs.writeFile(path.join(projectRoot, "src", "A.tsx"), "export function A() {}\n", "utf8");
    await fs.writeFile(
      path.join(projectRoot, "src", "A.docs.md"),
      "---\nnode: component:a\nsourceHash: 000000000000\nschema: 1\nreviewed: true\n---\n\n## Summary\nКнопка.\n",
      "utf8"
    );

    await expect(getDocsStatusForNode({ graph: createGraph(), nodeId: "component:a", projectRoot })).resolves.toMatchObject({
      status: "stale",
      format: "structured",
      reviewed: true,
    });
  });

  it("prefers owner-specific v2 docs over the legacy source-level file", async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "project-map-docs-"));
    await fs.mkdir(path.join(projectRoot, "src", "A.docs"), { recursive: true });
    await fs.writeFile(path.join(projectRoot, "src", "A.tsx"), "export function A() {}\n", "utf8");
    await fs.writeFile(path.join(projectRoot, "src", "A.docs.md"), "# Legacy A\n", "utf8");
    await fs.writeFile(path.join(projectRoot, "src", "A.docs", "A.md"), V2_DOCS, "utf8");

    await expect(getDocsStatusForNode({
      graph: createGraph(),
      nodeId: "component:a",
      projectRoot,
    })).resolves.toMatchObject({
      status: "exists",
      path: "src/A.docs/A.md",
      format: "structured-v2",
    });
  });

  it("reports changed and deleted v2 manifest sources with reasons", async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "project-map-docs-"));
    await fs.mkdir(path.join(projectRoot, "src", "A.docs"), { recursive: true });
    await fs.writeFile(path.join(projectRoot, "src", "A.tsx"), "export const A = 1;\n", "utf8");
    const digest = await computeSourceDigest(projectRoot, "src/A.tsx");
    const docsPath = path.join(projectRoot, "src", "A.docs", "A.md");
    const withSource = V2_DOCS.replace(
      "flowSchema: 1.2.0",
      `flowSchema: 1.2.0
sources:
  - path: "src/A.tsx"
    hash: ${digest}`
    );
    await fs.writeFile(docsPath, withSource, "utf8");

    await expect(getDocsStatusForNode({
      graph: createGraph(),
      nodeId: "component:a",
      projectRoot,
    })).resolves.toMatchObject({ status: "exists" });

    await fs.writeFile(path.join(projectRoot, "src", "A.tsx"), "export const A = 2;\n", "utf8");
    await expect(getDocsStatusForNode({
      graph: createGraph(),
      nodeId: "component:a",
      projectRoot,
    })).resolves.toMatchObject({
      status: "stale",
      staleReasons: ["Изменился source-файл: src/A.tsx"],
    });

    const withDeletedSource = V2_DOCS.replace(
      "flowSchema: 1.2.0",
      `flowSchema: 1.2.0
sources:
  - path: "src/removed.ts"
    hash: sha256:${"0".repeat(64)}`
    );
    await fs.writeFile(docsPath, withDeletedSource, "utf8");
    await expect(getDocsStatusForNode({
      graph: createGraph(),
      nodeId: "component:a",
      projectRoot,
    })).resolves.toMatchObject({
      status: "stale",
      staleReasons: ["Source-файл удалён: src/removed.ts"],
    });
  });
});

describe("setDocsReviewed", () => {
  it("flips the frontmatter flag and reports the fresh status", async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "project-map-docs-"));
    await fs.mkdir(path.join(projectRoot, "src"), { recursive: true });
    await fs.writeFile(path.join(projectRoot, "src", "A.tsx"), "export function A() {}\n", "utf8");
    const docsPath = path.join(projectRoot, "src", "A.docs.md");
    await fs.writeFile(docsPath, STRUCTURED_STALE, "utf8");
    const graph = createGraph();

    await expect(setDocsReviewed({ graph, nodeId: "component:a", projectRoot, reviewed: true })).resolves.toMatchObject({
      status: "stale",
      reviewed: true,
    });
    expect(await fs.readFile(docsPath, "utf8")).toContain("reviewed: true");
  });

  it("rejects legacy and missing docs", async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "project-map-docs-"));
    await fs.mkdir(path.join(projectRoot, "src"), { recursive: true });
    await fs.writeFile(path.join(projectRoot, "src", "A.tsx"), "export function A() {}\n", "utf8");
    await fs.writeFile(path.join(projectRoot, "src", "A.docs.md"), "# Legacy\n", "utf8");
    const graph = createGraph();

    await expect(setDocsReviewed({ graph, nodeId: "component:a", projectRoot, reviewed: true })).rejects.toThrow(/легаси/i);
    await expect(setDocsReviewed({ graph, nodeId: "hook:b", projectRoot, reviewed: true })).rejects.toThrow(/отсутствует/i);
  });

  it("updates the review status of a docs v2 file", async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "project-map-docs-"));
    await fs.mkdir(path.join(projectRoot, "src"), { recursive: true });
    await fs.writeFile(path.join(projectRoot, "src", "A.tsx"), "export const A = 1;\n", "utf8");
    const docsPath = path.join(projectRoot, "src", "A.docs.md");
    await fs.writeFile(docsPath, V2_DOCS, "utf8");
    const graph = createGraph();

    await expect(getDocsStatusForNode({
      graph,
      nodeId: "component:a",
      projectRoot,
    })).resolves.toMatchObject({
      format: "structured-v2",
      reviewed: false,
    });
    await expect(setDocsReviewed({
      graph,
      nodeId: "component:a",
      projectRoot,
      reviewed: true,
    })).resolves.toMatchObject({
      format: "structured-v2",
      reviewed: true,
    });
    expect(await fs.readFile(docsPath, "utf8")).toContain("review: reviewed");
  });
});

describe("docsContextService", () => {
  it("includes main file, used hook, rendered child, and used by", async () => {
    const context = await buildDocsContextForNode({
      graph: createGraph(),
      nodeId: "component:a",
      projectRoot: "/project",
    });

    expect(context.suggestedContext.map((item) => item.file)).toEqual([
      "src/A.tsx",
      "src/useB.ts",
      "src/Child.tsx",
      "src/Page.tsx",
    ]);
  });

  it("uses canonical FlowIndex facts and can focus one flow-node target", async () => {
    const flowIndex = docsFlowIndex();
    const context = await buildDocsContextForNode({
      graph: createGraph(),
      nodeId: "component:a",
      projectRoot: "/project",
      flowIndex,
      targetFlowNodeId: "component-value:component:a#visible",
    });

    expect(context.valueFlowSummary).toContain(
      "canonical id: component-value:component:a#visible"
    );
    expect(context.valueFlowSummary).toContain("origin=proven");
    expect(context.valueFlowSummary).toContain("suggested semantic category:");
    expect(context.valueFlowSummary).toContain(
      "selectVisible (selector-result"
    );
    expect(context.valueFlowSummary).toContain("src/A.tsx:7");
    expect(context.valueFlowSummary).not.toContain("#unrelated");
    expect(context.values.map((value) => [value.label, value.documented, value.suggestedCategory])).toEqual([
      ["unrelated", false, "domain-data"],
      ["visible", false, "decision"],
    ]);
  });

  it("marks owner values that already have target-aware documentation", async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "project-map-docs-context-"));
    await fs.mkdir(path.join(projectRoot, "src", "A.docs"), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, "src", "A.docs", "A.md"),
      `${V2_DOCS}
<!-- project-map:block
{"id":"visible-meaning","kind":"value-meaning","summary":"Определяет видимость компонента.","valueCategory":"decision","targets":[{"type":"node","id":"component:a"},{"type":"flow-node","id":"component-value:component:a#visible"}]}
-->
Определяет, виден ли компонент пользователю.
<!-- /project-map:block -->

<!-- project-map:block
{"id":"visible-rule","kind":"business-rule","targets":[{"type":"node","id":"component:a"},{"type":"flow-node","id":"component-value:component:a#visible"}]}
-->
Компонент доступен только пользователю с подтверждёнными правами.
<!-- /project-map:block -->
`,
      "utf8"
    );

    const context = await buildDocsContextForNode({
      graph: createGraph(),
      nodeId: "component:a",
      projectRoot,
      flowIndex: docsFlowIndex(),
    });

    expect(context.values).toEqual([
      expect.objectContaining({ id: "component-value:component:a#unrelated", documented: false, hasSummary: false, businessRuleCount: 0, annotationKinds: [] }),
      expect.objectContaining({ id: "component-value:component:a#visible", documented: true, hasSummary: true, businessRuleCount: 1, annotationKinds: ["business-rule", "value-meaning"] }),
    ]);
  });
});

describe("docsPromptService", () => {
  it("includes node, docs path, context file paths, user comment, and existing docs without source code", async () => {
    const prompt = await buildDocsPrompt({
      node: node("component:a", "component", "A", "src/A.tsx"),
      docsPath: "src/A.docs/A.md",
      mode: "regenerate",
      userComment: "Добавь раздел про props.",
      selectedContext: [{
        id: "main-file",
        label: "Основной файл",
        type: "source-file",
        file: "src/A.tsx",
        selected: true,
        reason: "main",
      }],
      sourceManifest: [{
        path: "src/A.tsx",
        hash: `sha256:${"a".repeat(64)}`,
      }],
      existingDocs: "# Old docs",
      graphSummary: "A renders Child",
      valueFlowSummary: "value -> prop",
    });

    expect(prompt).toContain("Имя: A");
    expect(prompt).toContain("src/A.docs/A.md");
    expect(prompt).toContain("src/A.tsx - main");
    expect(prompt).not.toContain("export function A");
    expect(prompt).toContain("Добавь раздел про props.");
    expect(prompt).toContain("# Old docs");
    expect(prompt).toContain("schema: project-map.docs/v2");
    expect(prompt).toContain("owner: component:a");
    expect(prompt).toContain('"kind":"scenario"');
    expect(prompt).toContain("<!-- project-map:block");
    expect(prompt).toContain('  - path: "src/A.tsx"');
    expect(prompt).toContain(`hash: sha256:${"a".repeat(64)}`);
    expect(prompt).toContain("canonical flow-node targets");
    expect(prompt).toContain("business-rule");
  });

  it("requests node-type specific sections", async () => {
    const prompt = await buildDocsPrompt({
      node: node("hook:b", "hook", "useB", "src/useB.ts"),
      docsPath: "src/useB.docs/useB.md",
      mode: "create",
      selectedContext: [],
      sourceManifest: [{
        path: "src/useB.ts",
        hash: `sha256:${"b".repeat(64)}`,
      }],
    });

    expect(prompt).toContain('"kind":"contract"');
    expect(prompt).not.toContain('"kind":"scenario"');
  });

  it("builds an explicit non-destructive v1 to v2 migration prompt", async () => {
    const prompt = await buildDocsPrompt({
      node: node("component:a", "component", "A", "src/A.tsx"),
      docsPath: "src/A.docs/A.md",
      mode: "migrate",
      selectedContext: [],
      sourceManifest: [{
        path: "src/A.tsx",
        hash: `sha256:${"c".repeat(64)}`,
      }],
      existingDocs: "---\nnode: component:a\nschema: 1\n---\n\n## Summary\nСтарое описание.",
    });

    expect(prompt).toContain("Режим миграции v1 → v2");
    expect(prompt).toContain("Не изменяй и не удаляй исходный v1-файл");
    expect(prompt).toContain("## Summary\nСтарое описание.");
    expect(prompt).toContain("Файл документации: src/A.docs/A.md");
  });

  it("builds a fragment-only prompt for selected annotations", () => {
    const prompt = buildDocsPartialPrompt({
      node: node("component:a", "component", "A", "src/A.tsx"),
      docsPath: "src/A.docs/A.md",
      scope: { type: "annotation", annotationIds: ["summary"] },
      userComment: "Сделай смысл точнее.",
      selectedContext: [],
      existingDocs: V2_DOCS,
    });

    expect(prompt).toContain(DOCS_PARTIAL_OUTPUT_TOKEN);
    expect(prompt).toContain("Не изменяй исходный документ напрямую");
    expect(prompt).toContain('"id":"summary"');
    expect(prompt).toContain("Сделай смысл точнее.");
  });

  it("builds a value-meaning fragment when a target has no annotation yet", () => {
    const target = {
      type: "flow-node" as const,
      id: "component-value:component:a#profile.name",
    };
    const prompt = buildDocsPartialPrompt({
      node: node("component:a", "component", "A", "src/A.tsx"),
      docsPath: "src/A.docs/A.md",
      scope: { type: "target", target, createIfMissing: true },
      selectedContext: [],
      existingDocs: V2_DOCS,
      valueFlowSummary: "canonical id: component-value:component:a#profile.name",
    });

    expect(prompt).toContain("value-meaning-profile-name");
    expect(prompt).toContain('"kind": "value-meaning"');
    expect(prompt).toContain('"summary": "<Одно предложение о бизнес-роли значения>"');
    expect(prompt).toContain('"valueCategory": "domain-data"');
    expect(prompt).toContain("наблюдаемое поведение и границы влияния");
    expect(prompt).toContain(target.id);
    expect(prompt).toContain("Создай ровно один обязательный block");
  });

  it("ensures value-meaning when a target currently has only a business rule", () => {
    const target = { type: "flow-node" as const, id: "component-value:component:a#visible" };
    const existing = V2_DOCS + `
<!-- project-map:block
{"id":"visible-rule","kind":"business-rule","targets":[{"type":"node","id":"component:a"},{"type":"flow-node","id":"${target.id}"}]}
-->
Значение управляет доступностью действия.
<!-- /project-map:block -->
`;
    const prompt = buildDocsPartialPrompt({
      node: node("component:a", "component", "A", "src/A.tsx"),
      docsPath: "src/A.docs/A.md",
      scope: {
        type: "target",
        target,
        createIfMissing: true,
        ensureValueMeaning: true,
        includeBusinessLogic: true,
      },
      selectedContext: [],
      existingDocs: existing,
    });

    expect(prompt).toContain('kind `value-meaning`');
    expect(prompt).toContain("metadata `summary`");
    expect(prompt).toContain("business-rule, role-rule, gotcha или open-question");
    expect(prompt).toContain("Не возвращай и не изменяй их");
    expect(prompt).toContain("НЕ пересказывай его");
    expect(prompt).toContain("названия selector, store, state paths");
  });
});

describe("docsJobService", () => {
  it("tracks job lifecycle", () => {
    const job = createDocsJob({ nodeId: "component:a", docsPath: "src/A.docs.md" });
    appendJobLog(job.id, "Running opencode");
    markJobSuccess(job.id);

    expect(getDocsJob(job.id)).toMatchObject({
      status: "success",
      logs: ["Running opencode"],
    });

    const failed = createDocsJob({ nodeId: "component:a", docsPath: "src/A.docs.md" });
    markJobError(failed.id, "OpenCode exited with code 1");
    expect(getDocsJob(failed.id)).toMatchObject({
      status: "error",
      error: "OpenCode exited with code 1",
    });
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
      node("project:root", "project", "test"),
      node("component:a", "component", "A", "src/A.tsx"),
      node("hook:b", "hook", "useB", "src/useB.ts"),
      node("component:child", "component", "Child", "src/Child.tsx"),
      node("page:home", "page", "Home", "src/Page.tsx"),
    ],
    edges: [
      edge("e1", "component:a", "hook:b", "usesHook"),
      edge("e2", "component:a", "component:child", "renders"),
      edge("e3", "page:home", "component:a", "renders"),
    ],
    stats: {
      nodesCount: 5,
      edgesCount: 3,
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

function docsFlowIndex(): FlowIndex {
  const visible = "component-value:component:a#visible";
  const selector = "selector-result:selector:visible";
  const consumer = "prop:component:child#visible";
  return {
    schemaVersion: "1.4.0",
    runId: "docs-context",
    generatedAt: "2026-07-30T00:00:00.000Z",
    sourceFingerprint: "fixture",
    nodes: [
      {
        id: selector,
        kind: "selector-result",
        name: "selectVisible",
        confidence: "high",
        evidence: [{ file: "src/selectors.ts", line: 2 }],
      },
      {
        id: visible,
        kind: "component-value",
        name: "visible",
        path: "visible",
        ownerNodeId: "component:a",
        confidence: "high",
        evidence: [{ file: "src/A.tsx", line: 7, code: "const visible = useSelector(selectVisible)" }],
      },
      {
        id: consumer,
        kind: "prop",
        name: "visible",
        ownerNodeId: "component:child",
        confidence: "high",
        evidence: [],
      },
      {
        id: "component-value:component:a#unrelated",
        kind: "component-value",
        name: "unrelated",
        ownerNodeId: "component:a",
        confidence: "medium",
        evidence: [],
      },
    ],
    edges: [
      {
        id: "flow-edge:selector-visible",
        from: selector,
        to: visible,
        relation: "binds",
        confidence: "high",
        evidence: [],
      },
      {
        id: "flow-edge:visible-prop",
        from: visible,
        to: consumer,
        relation: "passes",
        confidence: "high",
        evidence: [],
      },
    ],
    flows: [{
      id: `flow:${visible}`,
      scopeNodeIds: ["component:a", "component:child"],
      subjectNodeId: visible,
      nodeIds: [selector, visible, consumer],
      edgeIds: ["flow-edge:selector-visible", "flow-edge:visible-prop"],
      completeness: "complete",
      coverage: {
        origin: "proven",
        continuation: "proven",
        reasonCodes: [],
      },
    }],
    componentStructures: [],
    stats: {
      flowsCount: 1,
      completeFlowsCount: 1,
      gapsCount: 0,
      originResolvedFlowsCount: 1,
      originGapFlowsCount: 0,
      originUnknownFlowsCount: 0,
      continuationResolvedFlowsCount: 1,
    },
  };
}
