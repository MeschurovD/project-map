import { describe, expect, it, vi } from "vitest";
import type { ArtifactHealth } from "../src/artifacts/types.js";
import { openProject } from "../src/cli/openProject.js";

describe("openProject", () => {
  it.each(["stale", "incompatible"] as const)(
    "repairs %s artifacts before starting the explorer",
    async (status) => {
      const order: string[] = [];
      const launchBrowser = vi.fn();
      const result = await openProject(
        {
          projectRoot: "/tmp/example-project",
          openBrowser: true,
          log: () => undefined,
        },
        {
          assessArtifacts: async () => health(status),
          scanProject: async () => {
            order.push("scan");
            return scanResult() as never;
          },
          startServer: async () => {
            order.push("server");
            return { server: { close: vi.fn() }, url: "http://127.0.0.1:3000/" } as never;
          },
          launchBrowser,
        }
      );

      expect(order).toEqual(["scan", "server"]);
      expect(result.scanned).toBe(true);
      expect(launchBrowser).toHaveBeenCalledWith("http://127.0.0.1:3000/");
    }
  );

  it("keeps diagnostic --no-scan and --no-open behavior explicit", async () => {
    const scanProject = vi.fn();
    const launchBrowser = vi.fn();

    const result = await openProject(
      {
        projectRoot: "/tmp/example-project",
        scan: false,
        openBrowser: false,
        log: () => undefined,
      },
      {
        assessArtifacts: async () => health("stale"),
        scanProject,
        startServer: async () => ({ server: { close: vi.fn() }, url: "http://127.0.0.1:3000/" }) as never,
        launchBrowser,
      }
    );

    expect(result.scanned).toBe(false);
    expect(scanProject).not.toHaveBeenCalled();
    expect(launchBrowser).not.toHaveBeenCalled();
  });
});

function health(status: ArtifactHealth["status"]): ArtifactHealth {
  return {
    status,
    checkedAt: "2026-07-28T00:00:00.000Z",
    reasons: status === "fresh" ? [] : [{ code: "test", message: status }],
  };
}

function scanResult() {
  return {
    stats: { filesCount: 3 },
    graph: { nodes: [{}, {}] },
    flowIndex: { flows: [{}] },
  };
}
