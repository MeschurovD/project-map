import { describe, expect, it } from "vitest";
import { parseDocsV2File } from "../src/modules/docs/server/services/docsV2FileFormat.js";
import {
  buildDocsV2OwnerReferenceAllowlist,
  validateDocsV2ReferenceDiagnostics,
  validateDocsV2References,
} from "../src/modules/docs/server/services/docsV2ReferenceValidator.js";
import { FLOW_SCHEMA_VERSION, type FlowIndex } from "../src/flow/types.js";
import type { ProjectMapGraph } from "../src/graph/types.js";

const OWNER = "component:a";

describe("validateDocsV2References", () => {
  it("scopes write targets to flows reachable from the owner", () => {
    const graph: ProjectMapGraph = {
      schemaVersion: "1.1.0",
      project: { name: "test", root: "/project", sourceRoot: "src" },
      nodes: [
        { id: OWNER, type: "component", name: "A", file: "src/A.tsx" },
        { id: "hook:b", type: "hook", name: "useB", file: "src/useB.ts" },
        { id: "component:other", type: "component", name: "Other", file: "src/Other.tsx" },
      ],
      edges: [],
      stats: { nodesCount: 3, edgesCount: 0 },
    };
    const ownerValue = "component-value:component:a#visible";
    const hookValue = "hook-return:hook:b#visible";
    const unrelatedValue = "component-value:component:other#visible";
    const flowIndex: FlowIndex = {
      schemaVersion: FLOW_SCHEMA_VERSION,
      runId: "run",
      generatedAt: "2026-08-09T00:00:00.000Z",
      sourceFingerprint: "test",
      nodes: [
        { id: ownerValue, kind: "component-value", name: "visible", ownerNodeId: OWNER, confidence: "high", evidence: [] },
        { id: hookValue, kind: "hook-return", name: "useB.visible", ownerNodeId: "hook:b", confidence: "high", evidence: [] },
        { id: unrelatedValue, kind: "component-value", name: "other", ownerNodeId: "component:other", confidence: "high", evidence: [] },
      ],
      edges: [],
      flows: [
        { id: "flow:owner", scopeNodeIds: [OWNER], subjectNodeId: ownerValue, nodeIds: [hookValue, ownerValue], edgeIds: [], completeness: "complete", coverage: { origin: "proven", continuation: "proven", reasonCodes: [] } },
        { id: "flow:other", scopeNodeIds: ["component:other"], subjectNodeId: unrelatedValue, nodeIds: [unrelatedValue], edgeIds: [], completeness: "complete", coverage: { origin: "proven", continuation: "proven", reasonCodes: [] } },
      ],
      componentStructures: [],
      stats: { flowsCount: 2, completeFlowsCount: 2, gapsCount: 0, originResolvedFlowsCount: 2, originGapFlowsCount: 0, originUnknownFlowsCount: 0, continuationResolvedFlowsCount: 2 },
    };

    const allowlist = buildDocsV2OwnerReferenceAllowlist(graph, flowIndex, OWNER);

    expect([...allowlist.flowNodeIds]).toEqual([hookValue, ownerValue]);
    expect([...allowlist.nodeIds].sort()).toEqual([OWNER, "hook:b"].sort());
    expect(allowlist.flowNodeIds.has(unrelatedValue)).toBe(false);
    expect(allowlist.nodeIds.has("component:other")).toBe(false);
  });

  it("accepts canonical node, flow-node and occurrence targets", () => {
    const parsed = parseDocsV2File(documentWithTargets([
      { type: "node", id: OWNER },
      { type: "flow-node", id: "component-value:component:a#visible" },
      { type: "occurrence", id: "jsx:component:a#button" },
    ]))!;

    const errors = validateDocsV2References({
      parsed,
      expectedOwnerNodeId: OWNER,
      allowlist: {
        nodeIds: new Set([OWNER]),
        flowNodeIds: new Set(["component-value:component:a#visible"]),
        occurrenceIds: new Set(["jsx:component:a#button"]),
      },
    });
    expect(errors).toEqual([]);
  });

  it("rejects an unexpected owner and every orphan target", () => {
    const parsed = parseDocsV2File(documentWithTargets([
      { type: "node", id: "component:ghost" },
      { type: "flow-node", id: "component-value:ghost#value" },
      { type: "occurrence", id: "jsx:ghost#button" },
    ], "component:other"))!;

    const errors = validateDocsV2References({
      parsed,
      expectedOwnerNodeId: OWNER,
      allowlist: {
        nodeIds: new Set([OWNER]),
        flowNodeIds: new Set(),
        occurrenceIds: new Set(),
      },
    });

    expect(errors).toHaveLength(4);
    expect(errors).toEqual(expect.arrayContaining([
      `Frontmatter owner должен быть равен "${OWNER}".`,
      expect.stringContaining('неизвестный node target "component:ghost"'),
      expect.stringContaining('неизвестный flow-node target "component-value:ghost#value"'),
      expect.stringContaining('неизвестный occurrence target "jsx:ghost#button"'),
    ]));

    expect(validateDocsV2ReferenceDiagnostics({
      parsed,
      expectedOwnerNodeId: OWNER,
      allowlist: {
        nodeIds: new Set([OWNER]),
        flowNodeIds: new Set(),
        occurrenceIds: new Set(),
      },
    }).map((diagnostic) => diagnostic.code)).toEqual([
      "unexpected-owner",
      "unknown-target",
      "unknown-target",
      "unknown-target",
    ]);
  });
});

function documentWithTargets(
  targets: Array<{ type: "node" | "flow-node" | "occurrence"; id: string }>,
  owner = OWNER
) {
  return `---
schema: project-map.docs/v2
owner: ${owner}
generatedAt: 2026-07-30T14:00:00Z
review: unreviewed
graphSchema: 1.1.0
flowSchema: 1.2.0
---

<!-- project-map:block
${JSON.stringify({ id: "summary", kind: "summary", targets })}
-->
Описание.
<!-- /project-map:block -->
`;
}
