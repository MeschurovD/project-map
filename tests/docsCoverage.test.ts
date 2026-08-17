import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ProjectMapGraph } from "../src/graph/types.js";
import {
  buildDocsCoverage,
  listStaleV2Docs,
} from "../src/modules/docs/server/services/docsCoverageService.js";
import {
  computeSourceDigest,
} from "../src/modules/docs/server/services/docsFileService.js";

describe("buildDocsCoverage", () => {
  it("counts only valid owner-addressed docs and audits the whole corpus", async () => {
    const projectRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "project-map-docs-coverage-")
    );
    await fs.mkdir(path.join(projectRoot, "src", "A.docs"), {
      recursive: true,
    });
    await fs.mkdir(path.join(projectRoot, "src", "Ghost.docs"), {
      recursive: true,
    });
    await fs.mkdir(path.join(projectRoot, "src", "D.docs"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(projectRoot, "src", "A.tsx"),
      "export function A() { return null; }\n",
      "utf8"
    );
    await fs.writeFile(
      path.join(projectRoot, "src", "B.tsx"),
      "export function useB() { return true; }\n",
      "utf8"
    );
    await fs.writeFile(
      path.join(projectRoot, "src", "Page.tsx"),
      "export function Page() { return null; }\n",
      "utf8"
    );
    await fs.writeFile(
      path.join(projectRoot, "src", "D.ts"),
      "export function useD() { return true; }\n",
      "utf8"
    );

    const digest = await computeSourceDigest(projectRoot, "src/A.tsx");
    await fs.writeFile(
      path.join(projectRoot, "src", "A.docs", "A.md"),
      v2Document("component:a", digest),
      "utf8"
    );
    await fs.writeFile(
      path.join(projectRoot, "src", "B.docs.md"),
      v1HookDocument(),
      "utf8"
    );
    await fs.writeFile(
      path.join(projectRoot, "src", "D.docs", "useD.md"),
      v2Document("hook:d"),
      "utf8"
    );
    await fs.writeFile(
      path.join(projectRoot, "src", "Ghost.docs", "Ghost.md"),
      v2Document("component:ghost"),
      "utf8"
    );
    await fs.writeFile(
      path.join(projectRoot, "src", "Loose.docs.md"),
      "# Legacy notes\n",
      "utf8"
    );

    const coverage = await buildDocsCoverage({
      graph: graph(),
      projectRoot,
    });

    expect(coverage.summary).toEqual({
      totalNodes: 5,
      documentedNodes: 3,
      freshNodes: 1,
      reviewedNodes: 3,
      missingNodes: 2,
      invalidDocuments: 1,
      orphanedDocuments: 1,
    });
    expect(coverage.nodes.find((node) => node.nodeId === "component:a"))
      .toMatchObject({
        documented: true,
        fresh: true,
        reviewed: true,
        documentPath: "src/A.docs/A.md",
      });
    expect(coverage.nodes.find((node) => node.nodeId === "hook:shared"))
      .toMatchObject({
        documented: false,
        fresh: false,
        expectedPath: "src/A.docs/useA.md",
      });
    expect(coverage.nodes.find((node) => node.nodeId === "hook:b"))
      .toMatchObject({
        documented: true,
        fresh: false,
        reviewed: true,
      });
    expect(coverage.documents.find((document) =>
      document.path === "src/Ghost.docs/Ghost.md"
    )).toMatchObject({
      ownerNodeId: "component:ghost",
      orphaned: true,
      invalid: false,
    });
    expect(coverage.documents.find((document) =>
      document.path === "src/Loose.docs.md"
    )).toMatchObject({
      format: "legacy",
      invalid: true,
      orphaned: false,
    });
    expect(listStaleV2Docs(coverage)).toEqual([{
      nodeId: "hook:d",
      nodeName: "useD",
      docsPath: "src/D.docs/useD.md",
    }]);
  });
});

function graph(): ProjectMapGraph {
  const nodes: ProjectMapGraph["nodes"] = [
    { id: "component:a", type: "component", name: "A", file: "src/A.tsx" },
    { id: "hook:shared", type: "hook", name: "useA", file: "src/A.tsx" },
    { id: "hook:b", type: "hook", name: "useB", file: "src/B.tsx" },
    { id: "hook:d", type: "hook", name: "useD", file: "src/D.ts" },
    { id: "page:home", type: "page", name: "Page", file: "src/Page.tsx" },
  ];
  return {
    schemaVersion: "1.1.0",
    project: {
      name: "coverage-fixture",
      root: ".",
      sourceRoot: "src",
    },
    nodes,
    edges: [],
    stats: { nodesCount: nodes.length, edgesCount: 0 },
  };
}

function v2Document(
  owner: string,
  digest = `sha256:${"0".repeat(64)}`
) {
  return `---
schema: project-map.docs/v2
owner: ${owner}
generatedAt: 2026-07-30T14:00:00Z
review: reviewed
graphSchema: 1.1.0
flowSchema: 1.2.0
sources:
  - path: "src/A.tsx"
    hash: ${digest}
---

<!-- project-map:block
{"id":"summary","kind":"summary","targets":[{"type":"node","id":"${owner}"}]}
-->
Краткое описание.
<!-- /project-map:block -->
`;
}

function v1HookDocument() {
  return `---
node: hook:b
sourceHash: 000000000000
generated: 2026-07-30T14:00:00Z
schema: 1
reviewed: true
---

## Summary
Возвращает флаг.

## Contract
Нет

## Business rules
Нет

## Gotchas
Нет

## Open questions
Нет
`;
}
