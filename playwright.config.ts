import { defineConfig } from "@playwright/test";

// Browser smoke config. Kept intentionally minimal and OUT of `npm test`:
// the vitest suite must stay fast, so the smoke runs via `npm run test:smoke`.
// One spec, one worker, no shards; the spec owns the scan + dev-server
// lifecycle in beforeAll/afterAll, so no global webServer is configured here.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    headless: true,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
