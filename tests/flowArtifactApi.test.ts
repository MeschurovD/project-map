import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { artifactMiddleware } from "../src/dev/startDevServer.js";
import { FLOW_SCHEMA_VERSION } from "../src/flow/types.js";

describe("flows artifact API", () => {
  it("serves a compatible flows artifact", async () => {
    const root = await fixtureRoot({
      schemaVersion: FLOW_SCHEMA_VERSION,
      runId: "run-1",
      nodes: [],
      edges: [],
      flows: [],
    });

    try {
      const response = await invoke(root);
      expect(response.statusCode).toBe(200);
      expect(response.body).toMatchObject({ schemaVersion: FLOW_SCHEMA_VERSION, runId: "run-1" });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects an incompatible flows schema", async () => {
    const root = await fixtureRoot({ schemaVersion: "0.9.0", flows: [] });

    try {
      const response = await invoke(root);
      expect(response.statusCode).toBe(409);
      expect(response.body).toMatchObject({
        expectedSchemaVersion: FLOW_SCHEMA_VERSION,
        actualSchemaVersion: "0.9.0",
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("returns the standard missing-artifact response", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "project-map-flow-api-"));

    try {
      const response = await invoke(root);
      expect(response.statusCode).toBe(404);
      expect(response.body).toMatchObject({ error: ".project-map/flows.json not found" });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

async function fixtureRoot(value: unknown): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "project-map-flow-api-"));
  const output = path.join(root, ".project-map");
  await fs.mkdir(output);
  await fs.writeFile(path.join(output, "flows.json"), JSON.stringify(value), "utf8");
  return root;
}

async function invoke(projectRoot: string) {
  let body = "";
  const response = {
    statusCode: 0,
    setHeader() {},
    end(value: string) {
      body = value;
    },
  };
  const middleware = artifactMiddleware(projectRoot, "flows.json", FLOW_SCHEMA_VERSION);

  await middleware({} as never, response as never, () => undefined);
  return { statusCode: response.statusCode, body: JSON.parse(body) as Record<string, unknown> };
}
