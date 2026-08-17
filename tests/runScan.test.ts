import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runScan } from "../src/scan/runScan.js";

describe("runScan", () => {
  it("writes facts and graph artifacts for a basic FSD Redux project", async () => {
    const sourceFixture = path.resolve("fixtures/basic-fsd-redux");
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "project-map-fixture-"));
    await fs.cp(sourceFixture, tempRoot, { recursive: true });

    const result = await runScan({ projectRoot: tempRoot });
    const artifactFiles = await fs.readdir(path.join(tempRoot, ".project-map"));

    expect(artifactFiles.sort()).toEqual([
      "config.json",
      "facts.json",
      "flows.json",
      "graph.json",
      "manifest.json",
      "stats.json",
      "unresolved.json",
    ]);
    expect(result.stats.filesCount).toBeGreaterThan(0);
    expect(result.flowIndex).toMatchObject({
      schemaVersion: "1.4.0",
      sourceFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      stats: {
        flowsCount: 5,
        completeFlowsCount: 2,
        gapsCount: 0,
        originResolvedFlowsCount: 5,
        originGapFlowsCount: 0,
        originUnknownFlowsCount: 0,
        continuationResolvedFlowsCount: 2,
      },
    });
    const storedFlowIndex = JSON.parse(
      await fs.readFile(path.join(tempRoot, ".project-map", "flows.json"), "utf8")
    );
    expect(storedFlowIndex).toEqual(result.flowIndex);
    const manifest = JSON.parse(
      await fs.readFile(path.join(tempRoot, ".project-map", "manifest.json"), "utf8")
    );
    expect(manifest).toMatchObject({
      schemaVersion: "1.0.0",
      runId: result.flowIndex.runId,
      generatedAt: result.flowIndex.generatedAt,
      sourceFingerprint: result.flowIndex.sourceFingerprint,
      artifacts: {
        graph: { file: "graph.json", schemaVersion: "1.1.0" },
        flows: { file: "flows.json", schemaVersion: "1.4.0" },
      },
    });
    expect(result.facts.some((fact) => fact.type === "component" && fact.name === "UserProfileWidget")).toBe(true);
    expect(result.facts.some((fact) => fact.type === "selectorUsage" && fact.selectorName === "selectCurrentUser")).toBe(true);
    expect(result.facts.some((fact) => fact.type === "dispatchCall" && fact.actionName === "userActions.touch")).toBe(true);
    expect(result.graph.nodes.some((node) => node.id === "page:records")).toBe(false);
    expect(result.graph.nodes.some((node) => node.id === "page:activity-log-page")).toBe(true);
    expect(result.graph.nodes.some((node) => node.id === "page:archive-page")).toBe(true);
    expect(result.graph.edges.some((edge) => edge.type === "renders")).toBe(true);
    expect(result.graph.edges.some((edge) => edge.type === "usesSelector")).toBe(true);
    expect(result.graph.nodes.some((node) => node.id === "selector:src/entities/user/index#selectCurrentUser")).toBe(true);
    expect(result.graph.nodes.some((node) => node.id === "selector:selectCurrentUser")).toBe(false);
    expect(result.facts.some((fact) => fact.type === "reduxThunk" && fact.name === "fetchUser")).toBe(true);
    expect(result.graph.edges.some(
      (edge) => edge.type === "writesSlice" && edge.from === "thunk:src/entities/user/model/thunks#fetchUser" && edge.to === "slice-model:user"
    )).toBe(true);
    expect(result.graph.edges.some(
      (edge) => edge.type === "dispatchesAction" && edge.to === "thunk:src/entities/user/model/thunks#fetchUser"
    )).toBe(true);
    expect(result.graph.edges.some((edge) => edge.type === "dispatchesAction" && edge.to === "action:user.touch")).toBe(true);
  });
});
