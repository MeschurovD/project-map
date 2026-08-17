import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assessArtifactDirectory } from "../src/artifacts/status.js";
import { artifactStatusMiddleware } from "../src/dev/startDevServer.js";
import { runScan } from "../src/scan/runScan.js";

describe("artifact run status", () => {
  it("classifies a complete run as fresh, a mixed run as stale and an unknown schema as incompatible", async () => {
    const root = await scannedFixture();
    const output = path.join(root, ".project-map");

    try {
      expect(await assessArtifactDirectory(root)).toMatchObject({ status: "fresh", reasons: [] });

      const statsPath = path.join(output, "stats.json");
      const originalStats = await fs.readFile(statsPath, "utf8");
      await fs.writeFile(statsPath, JSON.stringify({ filesCount: -1 }), "utf8");
      expect(await assessArtifactDirectory(root)).toMatchObject({
        status: "stale",
        reasons: expect.arrayContaining([expect.objectContaining({ code: "artifact-digest-mismatch", artifact: "stats" })]),
      });

      await fs.writeFile(statsPath, originalStats, "utf8");
      const manifestPath = path.join(output, "manifest.json");
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      await fs.writeFile(manifestPath, JSON.stringify({ ...manifest, schemaVersion: "9.0.0" }), "utf8");
      expect(await assessArtifactDirectory(root)).toMatchObject({
        status: "incompatible",
        reasons: [expect.objectContaining({ code: "manifest-schema-incompatible" })],
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("serves artifact health through the status middleware", async () => {
    const root = await scannedFixture();

    try {
      let body = "";
      const response = {
        statusCode: 0,
        setHeader() {},
        end(value: string) { body = value; },
      };
      await artifactStatusMiddleware(root)({} as never, response as never, () => undefined);

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(body)).toMatchObject({ status: "fresh", reasons: [] });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("marks analysis stale when a source file changes after the scan", async () => {
    const root = await scannedFixture();

    try {
      const sourceFile = path.join(root, "src/pages/user/ui/UserPage.tsx");
      const original = await fs.readFile(sourceFile, "utf8");
      await new Promise((resolve) => setTimeout(resolve, 5));
      await fs.writeFile(sourceFile, `${original}\n`, "utf8");

      expect(await assessArtifactDirectory(root)).toMatchObject({
        status: "stale",
        reasons: expect.arrayContaining([
          expect.objectContaining({ code: "source-newer-than-analysis" }),
        ]),
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

async function scannedFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "project-map-artifact-status-"));
  await fs.cp(path.resolve("fixtures/basic-fsd-redux"), root, { recursive: true });
  await runScan({ projectRoot: root });
  return root;
}
