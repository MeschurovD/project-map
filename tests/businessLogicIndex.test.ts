import { describe, expect, it } from "vitest";
import { FLOW_SCHEMA_VERSION, type FlowIndex } from "../src/flow/types.js";
import type { ProjectMapGraph } from "../src/graph/types.js";
import type { MergedEnrichmentAnnotation } from "../src/modules/enrichmentTypes.js";
import {
  buildBusinessLogicIndex,
  filterBusinessLogicEntries,
} from "../src/ui/graph-view/buildBusinessLogicIndex.js";

const PAGE_ID = "page:profile";
const COMPONENT_ID = "component:profile-widget";
const SOURCE_ID = "hook-return:component:profile-widget#canEdit";
const PROP_ID = "prop:component:profile-widget#canEdit";
const CONTROL_ID = "component-value:component:profile-widget#showEditor";

describe("buildBusinessLogicIndex", () => {
  it("builds a reverse map from a documented rule to direct, inherited and related values", () => {
    const index = buildBusinessLogicIndex({
      graph: graph(),
      flowIndex: flows(),
      annotations: [rule()],
    });

    expect(index.stats).toMatchObject({
      totalCount: 1,
      ruleCount: 1,
      reviewedCount: 1,
      pagesWithoutBusinessContextCount: 0,
    });
    expect(index.entries[0]).toMatchObject({
      category: "rule",
      pageIds: [PAGE_ID],
      pageLabels: ["ProfilePage"],
    });
    expect(index.entries[0]?.targets.map((target) => [target.label, target.association])).toEqual([
      ["canEdit", "direct"],
      ["ProfileWidget", "direct"],
      ["props.canEdit", "inherited"],
      ["showEditor", "related"],
    ]);
    expect(index.entries[0]?.targets.find((target) => target.target.id === PROP_ID)).toMatchObject({
      flowId: "flow:profile-edit",
      relations: ["passes"],
      confidence: "medium",
    });
  });

  it("exposes quality diagnostics and filters the catalog by meaning, status and association", () => {
    const stale: MergedEnrichmentAnnotation = {
      ...rule(),
      id: "stale-role",
      markdown: "Только администратор может менять роль.",
      review: "generated",
      stale: true,
      targets: [],
    };
    const duplicate: MergedEnrichmentAnnotation = {
      ...rule(),
      id: "profile-edit-copy",
      documentId: "copy",
    };
    const index = buildBusinessLogicIndex({ graph: graph(), flowIndex: flows(), annotations: [rule(), stale, duplicate] });

    expect(index.stats).toMatchObject({ staleCount: 1, unlinkedCount: 1, duplicateCount: 2, undocumentedValueCount: 3 });
    expect(index.undocumentedValues.map((target) => target.label)).toEqual(["canEdit", "props.canEdit", "showEditor"]);
    expect(filterBusinessLogicEntries(index.entries, { query: "администратор" }).map((entry) => entry.annotation.id)).toEqual(["stale-role"]);
    expect(filterBusinessLogicEntries(index.entries, { quality: "unlinked" }).map((entry) => entry.annotation.id)).toEqual(["stale-role"]);
    expect(filterBusinessLogicEntries(index.entries, { quality: "duplicate" }).map((entry) => entry.annotation.id)).toEqual(["profile-edit", "profile-edit-copy"]);
    expect(filterBusinessLogicEntries(index.entries, { association: "related" }).map((entry) => entry.annotation.id)).toEqual(["profile-edit", "profile-edit-copy"]);
    expect(filterBusinessLogicEntries(index.entries, { pageId: PAGE_ID }).map((entry) => entry.annotation.id)).toEqual(["stale-role", "profile-edit", "profile-edit-copy"]);
  });
});

function graph(): ProjectMapGraph {
  return {
    schemaVersion: "1.1.0",
    project: { name: "test", root: "/project", sourceRoot: "src" },
    nodes: [
      { id: PAGE_ID, type: "page", name: "ProfilePage", file: "src/pages/ProfilePage.tsx" },
      { id: COMPONENT_ID, type: "component", name: "ProfileWidget", file: "src/widgets/ProfileWidget.tsx" },
      { id: "file:profile-page", type: "file", name: "ProfilePage.tsx", file: "src/pages/ProfilePage.tsx" },
    ],
    edges: [
      { id: "contains", from: PAGE_ID, to: "file:profile-page", type: "contains", confidence: "high", evidence: [] },
      { id: "defined-in", from: COMPONENT_ID, to: "file:profile-page", type: "definedIn", confidence: "high", evidence: [] },
    ],
    stats: { nodesCount: 3, edgesCount: 2 },
  };
}

function flows(): FlowIndex {
  return {
    schemaVersion: FLOW_SCHEMA_VERSION,
    runId: "run",
    generatedAt: "2026-08-09T00:00:00.000Z",
    sourceFingerprint: "test",
    nodes: [
      { id: SOURCE_ID, kind: "hook-return", name: "canEdit", ownerNodeId: COMPONENT_ID, confidence: "high", evidence: [] },
      { id: PROP_ID, kind: "prop", name: "canEdit", path: "props.canEdit", ownerNodeId: COMPONENT_ID, confidence: "medium", evidence: [] },
      { id: CONTROL_ID, kind: "component-value", name: "showEditor", ownerNodeId: COMPONENT_ID, confidence: "medium", evidence: [] },
    ],
    edges: [
      { id: "passes", from: SOURCE_ID, to: PROP_ID, relation: "passes", confidence: "medium", evidence: [] },
      { id: "controls", from: PROP_ID, to: CONTROL_ID, relation: "controls", confidence: "medium", evidence: [] },
    ],
    flows: [{
      id: "flow:profile-edit",
      scopeNodeIds: [PAGE_ID, COMPONENT_ID],
      subjectNodeId: SOURCE_ID,
      nodeIds: [SOURCE_ID, PROP_ID, CONTROL_ID],
      edgeIds: ["passes", "controls"],
      completeness: "complete",
      coverage: { origin: "proven", continuation: "proven", reasonCodes: [] },
    }],
    componentStructures: [],
    stats: { flowsCount: 1, completeFlowsCount: 1, gapsCount: 0, originResolvedFlowsCount: 1, originGapFlowsCount: 0, originUnknownFlowsCount: 0, continuationResolvedFlowsCount: 1 },
  };
}

function rule(): MergedEnrichmentAnnotation {
  return {
    moduleId: "docs",
    id: "profile-edit",
    ownerNodeId: COMPONENT_ID,
    kind: "business-rule",
    markdown: "Профиль может редактировать только его владелец.",
    propagation: "context",
    review: "reviewed",
    targets: [
      { type: "node", id: COMPONENT_ID },
      { type: "flow-node", id: SOURCE_ID },
    ],
  };
}
