import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { runScan } from "../src/scan/runScan.js";
import { startDevServer } from "../src/dev/startDevServer.js";
import type { ProjectMapGraph } from "../src/graph/types.js";
import type { FlowIndex } from "../src/flow/types.js";
import { resolveV2DocsPathForNode } from "../src/modules/docs/server/services/docsPathResolver.js";

// PM-014 / PM-015 — browser smoke golden flow.
//
// It drives the REAL user route
//   page → unit → value trace → evidence → impact
// against the golden fixture's own scan artifacts, through visible UI only
// (no internal mode knowledge, no URL-state hacks to skip steps).
//
// The route asserted, counted from a cold landing on the pages table:
//   Action 1: click the `user` page row           → composition tree
//   Action 2: click `UserProfileWidget`            → unit values
//   Action 3: click `profile.name`                 → readable ordered steps
//   Action 4: switch to Evidence                   → evidence ledger
//   Action 5: open selector evidence               → real source snippet
//   Action 6: switch to Graph                      → branching-capable canvas
//   Action 7: click the `selectCurrentUser` node   → node inspector
//   Action 8: click `Impact`                       → Impact (proven blast radius)
// PM-018 requires reaching a unit's values in ≤ 3 actions and opening a trace
// with one value action. This route reaches the actual trace in three actions.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let tempRoot: string;
let server: Awaited<ReturnType<typeof startDevServer>>["server"] | undefined;
let baseUrl: string;

test.beforeAll(async () => {
  // Self-contained: copy the fixture, scan it into .project-map, then serve it.
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "project-map-smoke-"));
  await fs.cp(path.join(repoRoot, "fixtures/basic-fsd-redux"), tempRoot, { recursive: true });
  await runScan({ projectRoot: tempRoot });
  // port 0 → the OS picks a free port; the returned URL carries the real one.
  const started = await startDevServer({ projectRoot: tempRoot, port: 0 });
  server = started.server;
  baseUrl = started.url;
});

test.afterAll(async () => {
  await server?.close();
  if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
});

test("golden route: page → unit → value → trace → evidence → impact through visible UI only", async ({ page }) => {
  let actions = 0;

  // ── a. App loads on the pages table with fresh artifacts ──────────────────
  await page.goto(baseUrl);
  const pagesTable = page.locator("table.pages-dashboard");
  await expect(pagesTable).toBeVisible();
  await expect(page.locator(".artifact-status-row.status-fresh")).toContainText(/up to date/i);

  // ── b. Sidebar search filters the pages table down to the wanted page ──────
  // PM-014 wiring: typing in the visible search box narrows the pages table so
  // "find a page" works on a real 26+ page project. Typing is part of Action 1
  // ("find and open the page"), so it does NOT increment the action counter —
  // only the click that opens the page below does.
  const searchBox = page.getByPlaceholder("Search");
  await searchBox.fill("user");
  await expect(page.getByRole("button", { name: "user", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "activity-log-page", exact: true })).toHaveCount(0);

  // A query that matches nothing shows an honest empty state, not the table.
  await searchBox.fill("no-such-page-xyz");
  await expect(page.locator(".pages-dashboard-empty")).toBeVisible();
  await expect(pagesTable).toHaveCount(0);

  // Clearing the box restores the full table before the real route begins.
  await searchBox.fill("");
  await expect(pagesTable).toBeVisible();

  // ── c. The page row shows a stable value denominator and source coverage ──
  const userRowButton = page.getByRole("button", { name: "user", exact: true });
  await expect(userRowButton).toBeVisible();
  const userRow = page.locator("tr", { has: userRowButton });
  // All five canonical values have a proven origin. Downstream continuation is
  // tracked separately, so it no longer depresses the source metric.
  await expect(userRow).toContainText("5/5 · 100%");
  await expect(userRow).toContainText("0");

  // ── Action 1: select the page → its composition tree opens ────────────────
  await userRowButton.click();
  actions += 1;

  await expect(page.locator(".structure-screen")).toBeVisible();
  const pageSummary = page.getByRole("region", { name: "Page at a glance" });
  await expect(pageSummary).toBeVisible();
  await expect(pageSummary).toContainText("Entry component");
  await expect(pageSummary).toContainText("UserPage");
  await expect(pageSummary).toContainText("5 / 5");
  await expect(page.locator(".unit-type-chip", { hasText: "COMPONENT" }).first()).toBeVisible();
  await expect(page.locator(".unit-type-chip", { hasText: "HOOK" }).first()).toBeVisible();
  const profileUnit = page.getByRole("button", { name: "UserProfileWidget", exact: true });
  await expect(profileUnit).toBeVisible();
  await expect(page.locator(".structure-tree")
    .getByRole("button", { name: "useUserProfile", exact: true })).toBeVisible();

  // ── Action 2: open a unit → its semantic overview opens by default ───────
  await profileUnit.click();
  actions += 1;

  await expect(page.locator(".unit-screen")).toBeVisible();
  const overview = page.locator('[data-symbol-tab="overview"]');
  await expect(overview).toBeVisible();
  await expect(overview.getByRole("heading", { name: "Data in the interface" })).toBeVisible();
  await expect(overview.locator(".symbol-fact-line")).toContainText("results");
  await expect(overview.locator(".symbol-story-card", { hasText: "UserCard" })).toBeVisible();
  const profileValue = overview.locator('[data-symbol-story-value="profile.name"]');
  await expect(profileValue).toBeVisible();
  await expect(profileValue).toContainText("Origin");
  await expect(profileValue).toContainText("Direct consumers");
  await expect(profileValue).toContainText("Downstream consumers");
  await expect(profileValue).toContainText("string");
  await expect(profileValue).toContainText("user.name");
  await expect(profileValue).toContainText("chooses the first available value");
  const originPipeline = profileValue.locator(".symbol-value-pipeline.is-primary");
  await expect(originPipeline).toContainText("fetchUser");
  for (const type of ["THUNK", "COMPONENT", "COMPUTED"]) {
    await expect(originPipeline.locator(`[data-pipeline-type="${type}"]`)).toBeVisible();
  }
  await expect(originPipeline.locator('[data-pipeline-type="API"]')).toHaveCount(0);
  await expect(originPipeline.locator('[data-pipeline-type="ACTION"]')).toHaveCount(0);
  await profileValue.getByRole("button", { name: "Show full path" }).click();
  await expect(originPipeline).toHaveAttribute("data-origin-expanded", "true");
  const operation = originPipeline.locator('[data-origin-operation="fetchUser"]');
  await expect(operation).toContainText("Source 1");
  for (const type of ["API", "THUNK", "ACTION"]) {
    await expect(operation.locator(`[data-pipeline-type="${type}"]`)).toBeVisible();
  }
  const fulfilled = operation.locator('[data-origin-lifecycle="fetchUser.fulfilled"]');
  await expect(fulfilled.locator('[data-pipeline-type="STATE"]')).toContainText("user.current");
  await expect(fulfilled.locator('[data-pipeline-type="STATE"]')).toHaveAttribute("title", "state.user.current");
  await expect(fulfilled.locator('[data-pipeline-type="SELECTOR"]')).toContainText("selectCurrentUser");
  const terminal = originPipeline.locator(".symbol-origin-terminal");
  await expect(terminal.locator('[data-pipeline-type="COMPONENT"]')).toBeVisible();
  await expect(terminal.locator('[data-pipeline-type="COMPUTED"]')).toBeVisible();
  await expect(profileValue.getByRole("button", { name: "Collapse path" })).toHaveAttribute("aria-expanded", "true");

  // ── Action 3: open the value → its readable ordered trace opens ──────────
  await profileValue.getByRole("button", { name: "Show trace" }).click();
  actions += 1;

  const steps = page.locator('[data-trace-view="steps"]');
  await expect(steps).toBeVisible();
  await expect(page.getByRole("tab", { name: "Steps" })).toHaveAttribute("aria-selected", "true");
  // The answer and steps span the API source through to the real UI consumer.
  await expect(page.locator(".value-journey-answer")).toContainText("GET /api/users/${userId}");
  await expect(page.locator(".value-journey-answer")).toContainText("UserCard.name");
  for (const step of ["GET /api/users/${userId}", "selectCurrentUser", "profile.name", "UserCard.name"]) {
    await expect(page.locator(`[data-flow-step="${step}"]`)).toBeVisible();
  }
  // A visible way back to the unit is present on the trace.
  await expect(page.getByRole("button", { name: /back to unit/i })).toBeVisible();
  const breadcrumb = page.getByRole("navigation", { name: "Graph breadcrumb" });
  await expect(breadcrumb.getByRole("button", { name: "Pages", exact: true })).toBeVisible();
  await expect(breadcrumb.getByRole("button", { name: "user", exact: true })).toBeVisible();
  await expect(breadcrumb.getByRole("button", { name: "UserProfileWidget", exact: true })).toBeVisible();

  // PM-018 exit criterion: the open UI value's trace is on screen in 3 actions.
  expect(actions).toBeLessThanOrEqual(3);

  // Browser history and refresh preserve the unit/value semantic level.
  await page.goBack();
  await expect(page.locator(".unit-screen")).toBeVisible();
  await page.goForward();
  await expect(steps).toBeVisible();
  await page.reload();
  await expect(steps).toBeVisible();

  // ── Action 4: Evidence is a first-class ledger, separate from the graph ──
  await page.getByRole("tab", { name: "Evidence" }).click();
  actions += 1;
  const selectorEvidence = page.locator(".journey-evidence-row", {
    has: page.getByText("selectCurrentUser", { exact: true }),
  }).first();
  await expect(selectorEvidence).toContainText("src/entities/user/model/selectors.ts");

  // ── Action 5: evidence opens the exact source location ───────────────────
  await selectorEvidence.locator(".journey-evidence-source").click();
  actions += 1;
  const sourceDialog = page.getByRole("dialog", { name: "selectCurrentUser" });
  await expect(sourceDialog).toBeVisible();
  await expect(sourceDialog).toContainText("src/entities/user/model/selectors.ts");
  await sourceDialog.getByRole("button", { name: "Close" }).click();

  // ── Action 6: Graph stays available for topology and branching ───────────
  await page.getByRole("tab", { name: "Graph" }).click();
  actions += 1;
  const selectorCard = flowNode(page, "selectCurrentUser");
  await expect(selectorCard).toBeVisible();
  await expect(flowNode(page, "GET /api/users/${userId}")).toBeVisible();
  await expect(flowNode(page, "profile.name")).toBeVisible();
  await expect(flowNode(page, "UserCard.name")).toBeVisible();
  await expect(page.locator(".flow-stage-header", { hasText: "Network" })).toBeVisible();

  // ── Action 7: graph node → its evidence-backed inspector ─────────────────
  await selectorCard.click();
  actions += 1;

  const inspector = page.locator("aside.detail-panel");
  await expect(inspector.getByRole("heading", { name: "selectCurrentUser" })).toBeVisible();
  // A real file path + code line from the fixture, not a synthetic label.
  await expect(inspector).toContainText("src/entities/user/model/selectors.ts");
  await expect(inspector.locator("code", { hasText: "selectCurrentUser" }).first()).toBeVisible();

  // ── Action 8: from the same inspector open Impact ─────────────────────────
  await inspector.getByRole("button", { name: "Impact" }).click();
  actions += 1;

  // UserCard is proven-affected (not in the "possibly affected" section), and
  // the affected pages are the three the golden contract expects.
  await expect(inspector.getByRole("heading", { name: "selectCurrentUser" })).toBeVisible();
  await expect(inspector.getByRole("button", { name: "UserCard", exact: true })).toBeVisible();
  for (const pageName of ["activity-log-page", "archive-page", "user"]) {
    await expect(inspector.getByRole("button", { name: pageName, exact: true })).toBeVisible();
  }

  // The low-confidence "possibly affected" block is a visually separate section
  // when present; in this state UserCard must be proven, never merged into it.
  const possibleSection = inspector.locator(".impact-possible");
  await expect(possibleSection.getByText("UserCard")).toHaveCount(0);

  // The ≤ 3 budget applies to reaching the answer. Evidence, graph and impact
  // are deliberate drill-downs from that answer.
  expect(actions).toBeLessThanOrEqual(8);
});

test("symbol value opens its exact transformation code in the shared modal", async ({ page }) => {
  await page.goto(baseUrl);
  await page.getByRole("button", { name: "user", exact: true }).click();
  await page.getByRole("button", { name: "UserProfileWidget", exact: true }).click();

  const value = page.locator('[data-symbol-story-value="profile.name"]');
  await value.getByRole("button", { name: "Code", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Transformation code: profile.name" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".source-modal-header")).toContainText("useUserProfile.ts");
  await expect(dialog.locator(".source-code-snippet")).toContainText('user?.name ?? "Unknown"');
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);
});

test("symbol pipeline cards open their exact step code in the shared modal", async ({ page }) => {
  await page.goto(baseUrl);
  await page.getByRole("button", { name: "user", exact: true }).click();
  await page.getByRole("button", { name: "UserProfileWidget", exact: true }).click();

  const value = page.locator('[data-symbol-story-value="profile.name"]');
  await value.locator('button[data-pipeline-type="THUNK"]').click();

  const originDialog = page.getByRole("dialog", { name: "Step code: fetchUser" });
  await expect(originDialog).toBeVisible();
  await expect(originDialog.locator(".source-modal-header")).toContainText("useUserProfile.ts");
  await expect(originDialog.locator(".source-code-snippet")).toContainText("export function useUserProfile()");
  await expect(originDialog.locator(".source-code-snippet")).toContainText('dispatch(fetchUser("1"))');
  await expect(originDialog.locator(".source-code-snippet")).toContainText("return {");
  await expect(originDialog.locator(".source-code-snippet")).not.toContainText("addCase");
  await originDialog.getByRole("button", { name: "Close" }).click();

  await value.locator('button[data-pipeline-type="PROP"]').click();
  const consumerDialog = page.getByRole("dialog", { name: "Step code: UserCard.name" });
  await expect(consumerDialog).toBeVisible();
  await expect(consumerDialog.locator(".source-code-snippet")).toContainText("export function UserProfileWidget()");
  await expect(consumerDialog.locator(".source-code-snippet")).toContainText("<UserCard name={profile.name} />");
  await consumerDialog.getByRole("button", { name: "Close" }).click();

  await value.locator('button[data-pipeline-type="COMPUTED"]').click();
  const computedDialog = page.getByRole("dialog", { name: "Transformation code: profile.name" });
  await expect(computedDialog.locator(".source-modal-header")).toContainText("useUserProfile.ts");
  await expect(computedDialog.locator(".source-code-snippet")).toContainText("export function useUserProfile()");
  await expect(computedDialog.locator(".source-code-snippet")).toContainText('name: user?.name ?? "Unknown"');
  await computedDialog.getByRole("button", { name: "Close" }).click();

  await value.getByRole("button", { name: "Show full path" }).click();

  await value.locator('button[data-pipeline-type="API"]').click();
  const apiDialog = page.locator(".source-modal");
  await expect(apiDialog.locator(".source-modal-header")).toContainText("thunks.ts");
  await expect(apiDialog.locator(".source-code-snippet")).toContainText("async (userId: string)");
  await expect(apiDialog.locator(".source-code-snippet")).toContainText("await fetch");
  await apiDialog.getByRole("button", { name: "Close" }).click();

  await value.locator('button[data-pipeline-type="ACTION"]').click();
  const actionDialog = page.locator(".source-modal");
  await expect(actionDialog.locator(".source-modal-header")).toContainText("slice.ts");
  await expect(actionDialog.locator(".source-code-snippet")).toContainText("addCase(fetchUser.fulfilled");
  await actionDialog.getByRole("button", { name: "Close" }).click();

  await value.locator('button[data-pipeline-type="STATE"]').click();
  const stateDialog = page.locator(".source-modal");
  await expect(stateDialog.locator(".source-modal-header")).toContainText("slice.ts");
  await expect(stateDialog.locator(".source-code-snippet")).toContainText("state.current = action.payload");
  await expect(stateDialog.locator(".source-modal-header")).not.toContainText("selectors.ts");
  await stateDialog.getByRole("button", { name: "Close" }).click();

  await value.locator('button[data-pipeline-type="SELECTOR"]').click();
  const selectorDialog = page.locator(".source-modal");
  await expect(selectorDialog.locator(".source-modal-header")).toContainText("selectors.ts");
  await expect(selectorDialog.locator(".source-code-snippet")).toContainText("export const selectCurrentUser");
  await selectorDialog.getByRole("button", { name: "Close" }).click();

  await value.locator('button[data-pipeline-type="COMPONENT"]').click();
  const componentDialog = page.locator(".source-modal");
  await expect(componentDialog.locator(".source-modal-header")).toContainText("UserProfileWidget.tsx");
  await expect(componentDialog.locator(".source-code-snippet")).toContainText("export function UserProfileWidget()");
});

test("a journey step opens only its own code fragment", async ({ page }) => {
  await page.goto(baseUrl);
  await page.getByRole("button", { name: "user", exact: true }).click();
  await page.getByRole("button", { name: "UserProfileWidget", exact: true }).click();
  const value = page.locator('[data-symbol-story-value="profile.name"]');
  await value.getByRole("button", { name: "Show trace" }).click();

  const selector = page.locator('[data-flow-step="selectCurrentUser"]');
  await selector.getByRole("button", { name: "View code", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Step code: selectCurrentUser" });
  const code = dialog.locator(".source-code-snippet");
  await expect(code).toContainText("selectCurrentUser");
  await expect(code).toContainText("state.user.current");
  await expect(code).not.toContainText("selectUserError");
});

// A flow-trace card, targeted by its visible label via the data attribute added
// to the semantic card (resilient to layout/position changes on the canvas).
function flowNode(page: Page, label: string) {
  return page.locator(`[data-flow-node-label="${label}"]`);
}

test("missing artifacts recover through the visible analysis action", async ({ page }) => {
  await fs.unlink(path.join(tempRoot, ".project-map", "flows.json"));

  await page.goto(baseUrl);
  const recovery = page.locator(".analysis-recovery");
  await expect(recovery.getByRole("heading", { name: "Project analysis is not ready" })).toBeVisible();
  await expect(recovery.locator(":scope > p")).not.toContainText("flows.json");

  await recovery.getByRole("button", { name: "Run analysis" }).click();
  await expect(page.locator("table.pages-dashboard")).toBeVisible();
  await expect(page.locator(".artifact-status-row.status-fresh")).toContainText(/up to date/i);
});

test("incompatible artifacts explain recovery without exposing schema as the main error", async ({ page }) => {
  const flowsPath = path.join(tempRoot, ".project-map", "flows.json");
  const flows = JSON.parse(await fs.readFile(flowsPath, "utf8")) as { schemaVersion: string };
  flows.schemaVersion = "0.0.0";
  await fs.writeFile(flowsPath, JSON.stringify(flows, null, 2));

  await page.goto(baseUrl);
  const recovery = page.locator(".analysis-recovery");
  await expect(recovery.getByRole("heading", { name: "Project analysis is not ready" })).toBeVisible();
  await expect(recovery.getByText("Run the analysis again")).toBeVisible();

  await recovery.getByRole("button", { name: "Run analysis" }).click();
  await expect(page.locator("table.pages-dashboard")).toBeVisible();
});

test("global search and language persist without losing the open unit", async ({ page }) => {
  await page.goto(baseUrl);
  await page.getByRole("button", { name: "user", exact: true }).click();
  await page.getByRole("button", { name: "UserProfileWidget", exact: true }).click();

  await page.getByPlaceholder("Search").click();
  await expect(page.getByRole("dialog", { name: "Jump to node" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "RU", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Graph breadcrumb" })
    .getByRole("button", { name: "Страницы", exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "UserProfileWidget" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Данные в интерфейсе" })).toBeVisible();

  await page.getByRole("button", { name: "Контракт", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Результаты и потребители" })).toBeVisible();

  await page.getByRole("button", { name: "Потребители", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Прямые потребители" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Нисходящие потребители" })).toBeVisible();
  await expect(page.locator('[data-symbol-tab="consumers"]')).toContainText("UserCard");
});

test("page quality keeps static analysis, Docs, E2E, and artifact trust separate", async ({ page }) => {
  await page.goto(baseUrl);
  await page.getByRole("button", { name: "user", exact: true }).click();
  await page.getByRole("button", { name: "Quality", exact: true }).click();

  const quality = page.locator(".page-quality-screen");
  await expect(quality).toBeVisible();
  await expect(quality.getByRole("heading", { name: "Quality and evidence" })).toBeVisible();
  await expect(quality).toContainText("origin resolved");
  await expect(quality).toContainText("continuation resolved");
  await expect(quality.getByRole("heading", { name: "Analysis quality" })).toBeVisible();
  await expect(quality.getByRole("heading", { name: "Documentation", exact: true })).toBeVisible();
  await expect(quality.getByRole("heading", { name: "E2E and Page Objects" })).toBeVisible();
  await expect(quality.getByRole("heading", { name: "Analysis artifacts" })).toBeVisible();
  await expect(quality.getByText("Artifacts are up to date", { exact: true })).toBeVisible();

  await expect(quality.getByText("Loading documentation coverage…")).toHaveCount(0);
  await expect(quality.getByText("Loading E2E coverage…")).toHaveCount(0);
  await expect(page.locator("aside.detail-panel")).toHaveCount(0);

  await page.getByRole("button", { name: "RU", exact: true }).click();
  await expect(quality.getByRole("heading", { name: "Качество и доказательства" })).toBeVisible();
  await expect(quality.getByRole("heading", { name: "Качество анализа" })).toBeVisible();
  await expect(quality.getByRole("heading", { name: "Документация", exact: true })).toBeVisible();
  await expect(quality.getByRole("heading", { name: "E2E и Page Objects" })).toBeVisible();
});

test("docs coverage opens from the sidebar and explains missing nodes", async ({ page }) => {
  await page.goto(baseUrl);
  await page.getByText("Advanced", { exact: true }).click();

  const coverageButton = page.getByRole("button", { name: /docs: \d+\/\d+/i });
  await expect(coverageButton).toBeVisible();
  await coverageButton.click();

  const coverageDialog = page.getByRole("dialog", { name: "Docs coverage" });
  await expect(coverageDialog).toBeVisible();
  await expect(coverageDialog.getByText("Documented", { exact: true })).toBeVisible();
  await expect(coverageDialog.getByText(/Не покрыто · \d+/)).toBeVisible();
  await expect(coverageDialog.getByText("Документ отсутствует.").first()).toBeVisible();
});

test("page dossier renders typed docs and opens the page documentation modal", async ({ page }) => {
  const graph = JSON.parse(
    await fs.readFile(path.join(tempRoot, ".project-map", "graph.json"), "utf8")
  ) as ProjectMapGraph;
  const pageNode = graph.nodes.find((node) =>
    node.type === "page" && node.name === "user"
  );
  if (!pageNode) throw new Error("Golden fixture user page node not found");
  const widgetNode = graph.nodes.find((node) =>
    node.type === "component" && node.name === "UserProfileWidget"
  );
  if (!widgetNode) throw new Error("Golden fixture profile widget node not found");
  const relativeDocsPath = resolveV2DocsPathForNode(pageNode);
  if (!relativeDocsPath) throw new Error("Golden fixture user page has no docs path");
  const docsPath = path.join(tempRoot, relativeDocsPath);
  const widgetDocsPath = path.join(tempRoot, resolveV2DocsPathForNode(widgetNode)!);
  await fs.mkdir(path.dirname(docsPath), { recursive: true });
  await fs.mkdir(path.dirname(widgetDocsPath), { recursive: true });
  await fs.writeFile(
    docsPath,
    `---
schema: project-map.docs/v2
owner: ${pageNode.id}
generatedAt: 2026-07-30T14:00:00Z
review: unreviewed
graphSchema: 1.1.0
flowSchema: 1.2.0
---

<!-- project-map:block
{"id":"summary","kind":"summary","targets":[{"type":"node","id":"${pageNode.id}"}]}
-->
Управляет просмотром профиля текущего пользователя.
<!-- /project-map:block -->

<!-- project-map:block
{"id":"profile-flow","kind":"user-flow","targets":[{"type":"node","id":"${pageNode.id}"}]}
-->
Пользователь открывает страницу и проверяет актуальные данные профиля.
<!-- /project-map:block -->

<!-- project-map:block
{"id":"profile-role","kind":"role-rule","targets":[{"type":"node","id":"${pageNode.id}"}]}
-->
Доступ разрешён авторизованному пользователю.
<!-- /project-map:block -->
`,
    "utf8"
  );
  await fs.writeFile(
    widgetDocsPath,
    `---
schema: project-map.docs/v2
owner: ${widgetNode.id}
generatedAt: 2026-08-09T14:00:00Z
review: reviewed
graphSchema: 1.1.0
flowSchema: 1.4.0
---

<!-- project-map:block
{"id":"summary","kind":"summary","targets":[{"type":"node","id":"${widgetNode.id}"}]}
-->
Показывает данные профиля.
<!-- /project-map:block -->

<!-- project-map:block
{"id":"profile-owner-rule","kind":"business-rule","targets":[{"type":"node","id":"${widgetNode.id}"}]}
-->
Редактирование профиля доступно только его владельцу.
<!-- /project-map:block -->
`,
    "utf8"
  );

  try {
    await page.goto(baseUrl);
    await page.getByRole("button", { name: "user", exact: true }).click();
    await page.getByRole("button", { name: "Summary", exact: true }).click();

    const dossier = page.locator(".page-dossier");
    await expect(dossier.getByText(
      "Управляет просмотром профиля текущего пользователя."
    )).toBeVisible();
    await expect(dossier.getByRole("heading", { name: "User flow" })).toBeVisible();
    await expect(dossier.getByRole("heading", {
      name: "Role / permission",
    })).toBeVisible();
    const businessContext = dossier.locator("[data-page-business-context]");
    await expect(businessContext.getByRole("heading", { name: "Business logic" })).toBeVisible();
    await expect(businessContext.getByText(
      "Редактирование профиля доступно только его владельцу."
    )).toBeVisible();
    await expect(businessContext.getByRole("button", {
      name: "UserProfileWidget",
    })).toBeVisible();

    await dossier.locator(".dossier-header-actions [data-docs-node]").click();
    const docsDialog = page.getByRole("dialog", {
      name: `Документация: ${pageNode.name}`,
    });
    await expect(docsDialog.getByText(
      "Пользователь открывает страницу и проверяет актуальные данные профиля."
    )).toBeVisible();
  } finally {
    await fs.unlink(docsPath).catch(() => undefined);
    await fs.unlink(widgetDocsPath).catch(() => undefined);
  }
});

test("business search opens the canonical value trace", async ({ page }) => {
  const graph = JSON.parse(
    await fs.readFile(path.join(tempRoot, ".project-map", "graph.json"), "utf8")
  ) as ProjectMapGraph;
  const flowIndex = JSON.parse(
    await fs.readFile(path.join(tempRoot, ".project-map", "flows.json"), "utf8")
  ) as FlowIndex;
  const widgetNode = graph.nodes.find((node) =>
    node.type === "component" && node.name === "UserProfileWidget"
  );
  const value = flowIndex.nodes.find((node) =>
    node.kind === "component-value" && node.path === "profile.name"
  );
  if (!widgetNode || !value) throw new Error("Golden fixture profile value not found");
  const relativeDocsPath = resolveV2DocsPathForNode(widgetNode);
  if (!relativeDocsPath) throw new Error("Golden fixture widget has no docs path");
  const docsPath = path.join(tempRoot, relativeDocsPath);
  await fs.mkdir(path.dirname(docsPath), { recursive: true });
  await fs.writeFile(
    docsPath,
    `---
schema: project-map.docs/v2
owner: ${widgetNode.id}
generatedAt: 2026-08-09T14:00:00Z
review: reviewed
graphSchema: 1.1.0
flowSchema: 1.4.0
---

<!-- project-map:block
{"id":"summary","kind":"summary","targets":[{"type":"node","id":"${widgetNode.id}"}]}
-->
Показывает профиль пользователя.
<!-- /project-map:block -->

<!-- project-map:block
{"id":"service-name-rule","kind":"business-rule","targets":[
  {"type":"node","id":"${widgetNode.id}"},
  {"type":"flow-node","id":"${value.id}"}
]}
-->
Служебное имя профиля показывается только после успешной загрузки пользователя.
<!-- /project-map:block -->
`,
    "utf8"
  );

  try {
    await page.goto(baseUrl);
    await page.keyboard.press("Control+K");
    const palette = page.locator(".command-palette");
    await palette.locator("input").fill("служебное имя");
    const valueResult = palette.getByRole("button", {
      name: /component-value profile\.name Служебное имя профиля/,
    });
    await expect(valueResult).toContainText(
      "Служебное имя профиля показывается только после успешной загрузки пользователя."
    );
    await valueResult.click();
    await expect(page.locator(".value-journey-screen")).toBeVisible();
    await expect(page.locator(".value-journey-header h1")).toHaveText("profile.name");
  } finally {
    await fs.unlink(docsPath).catch(() => undefined);
  }
});

test("business logic catalog maps a rule back to inherited values", async ({ page }) => {
  const graph = JSON.parse(
    await fs.readFile(path.join(tempRoot, ".project-map", "graph.json"), "utf8")
  ) as ProjectMapGraph;
  const flowIndex = JSON.parse(
    await fs.readFile(path.join(tempRoot, ".project-map", "flows.json"), "utf8")
  ) as FlowIndex;
  const widgetNode = graph.nodes.find((node) =>
    node.type === "component" && node.name === "UserProfileWidget"
  );
  const source = flowIndex.nodes.find((node) =>
    node.kind === "hook-return" && node.name === "useUserProfile.name"
  );
  if (!widgetNode || !source) throw new Error("Golden fixture profile identity flow not found");
  const relativeDocsPath = resolveV2DocsPathForNode(widgetNode);
  if (!relativeDocsPath) throw new Error("Golden fixture widget has no docs path");
  const docsPath = path.join(tempRoot, relativeDocsPath);
  await fs.mkdir(path.dirname(docsPath), { recursive: true });
  await fs.writeFile(
    docsPath,
    `---
schema: project-map.docs/v2
owner: ${widgetNode.id}
generatedAt: 2026-08-09T14:00:00Z
review: reviewed
graphSchema: 1.1.0
flowSchema: 1.4.0
---

<!-- project-map:block
{"id":"profile-catalog-rule","kind":"business-rule","targets":[
  {"type":"node","id":"${widgetNode.id}"},
  {"type":"flow-node","id":"${source.id}"}
]}
-->
В публичный профиль передаётся только подготовленное отображаемое имя.
<!-- /project-map:block -->
`,
    "utf8"
  );

  try {
    await page.goto(baseUrl);
    await page.getByRole("button", { name: "Business logic", exact: true }).click();

    const catalog = page.locator("[data-business-catalog]");
    await expect(catalog.getByRole("heading", { name: "Business logic catalog" })).toBeVisible();
    await catalog.getByPlaceholder("Search business meaning, page, unit, or value…")
      .fill("подготовленное отображаемое имя");
    await expect(catalog.getByText("1 items", { exact: true })).toBeVisible();

    const details = catalog.locator("[data-business-rule]");
    await expect(details.getByText(
      "В публичный профиль передаётся только подготовленное отображаемое имя."
    ).first()).toBeVisible();
    await expect(details.getByRole("heading", { name: /^Direct/ })).toBeVisible();
    await expect(details.getByRole("heading", { name: /^Inherited/ })).toBeVisible();
    await expect(details.getByRole("button", { name: "user", exact: true })).toBeVisible();

    const inherited = details.locator(".association-inherited .business-target-card", {
      hasText: "profile.name",
    }).first();
    await expect(inherited).toContainText("returns");
    await inherited.getByRole("button", { name: "profile.name →" }).click();
    await expect(page.locator(".value-journey-screen")).toBeVisible();
    await expect(page.locator(".value-journey-header h1")).toHaveText("profile.name");
  } finally {
    await fs.unlink(docsPath).catch(() => undefined);
  }
});

test("docs modal opens from structure and unit and exposes generation", async ({ page }) => {
  await page.goto(baseUrl);
  await page.getByRole("button", { name: "user", exact: true }).click();

  const profileCard = page.locator(".structure-unit-card", {
    has: page.getByRole("button", { name: "UserProfileWidget", exact: true }),
  });
  await profileCard.locator("[data-docs-node]").click();

  const docsDialog = page.getByRole("dialog", { name: "Документация: UserProfileWidget" });
  await expect(docsDialog).toBeVisible();
  await expect(docsDialog.getByText("Документация отсутствует")).toBeVisible();
  await docsDialog.getByRole("button", { name: "Сгенерировать", exact: true }).click();

  const generationDialog = page.getByRole("dialog", { name: "Generate docs for UserProfileWidget" });
  await expect(generationDialog).toBeVisible();
  await expect(
    generationDialog.getByText("UserProfileWidget.docs/UserProfileWidget.md")
  ).toBeVisible();
  await generationDialog.locator(".docs-value-batch-toggle input").check();
  await expect(generationDialog.getByText("Последовательно документировать значения", { exact: true })).toBeVisible();
  const profileBatchValue = generationDialog.locator(".docs-value-batch-list > label", {
    hasText: "profile.name",
  });
  await expect(profileBatchValue).toContainText("Не документировано");
  await generationDialog.getByRole("button", { name: "Снять выбор" }).click();
  await profileBatchValue.locator("input").check();
  await generationDialog.getByRole("button", { name: "Добавить в очередь" }).click();
  await docsDialog.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Открыть очередь генерации docs" }).click();
  const queueDialog = page.getByRole("dialog", { name: "Очередь генерации docs" });
  const queueItems = queueDialog.locator(".docs-queue-item");
  await expect(queueItems).toHaveCount(2);
  await expect(queueItems.nth(0)).toContainText("UserProfileWidget");
  await expect(queueItems.nth(1)).toContainText("UserProfileWidget · profile.name");
  await queueDialog.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "UserProfileWidget", exact: true }).click();
  await expect(page.locator(".unit-screen")).toBeVisible();
  await page.locator(".unit-header-actions [data-docs-node]").click();
  await expect(page.getByRole("dialog", { name: "Документация: UserProfileWidget" })).toBeVisible();
});

test("owner generation starts selected value jobs strictly after the owner job", async ({ page }) => {
  const generationBodies: Array<Record<string, unknown>> = [];
  await page.route("**/api/docs/node/**/generate", async (route) => {
    generationBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    const jobId = `batch-job-${generationBodies.length}`;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ jobId, status: "running" }) });
  });
  await page.route("**/api/docs/jobs/**", async (route) => {
    const jobId = route.request().url().split("/").at(-1) ?? "batch-job";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        jobId,
        status: "success",
        nodeId: "component:profile",
        docsPath: "src/Profile.docs/Profile.md",
        startedAt: "2026-08-10T00:00:00.000Z",
        finishedAt: "2026-08-10T00:00:01.000Z",
        logs: ["done"],
      }),
    });
  });

  await page.goto(baseUrl);
  await page.getByRole("button", { name: "user", exact: true }).click();
  const profileCard = page.locator(".structure-unit-card", {
    has: page.getByRole("button", { name: "UserProfileWidget", exact: true }),
  });
  await profileCard.locator("[data-docs-node]").click();
  const docsDialog = page.getByRole("dialog", { name: "Документация: UserProfileWidget" });
  await docsDialog.getByRole("button", { name: "Сгенерировать", exact: true }).click();
  const generationDialog = page.getByRole("dialog", { name: "Generate docs for UserProfileWidget" });
  await generationDialog.locator(".docs-value-batch-toggle input").check();
  await generationDialog.getByRole("button", { name: "Снять выбор" }).click();
  const profileBatchValue = generationDialog.locator(".docs-value-batch-list > label", { hasText: "profile.name" });
  await profileBatchValue.locator("input").check();
  await generationDialog.getByRole("button", { name: "Сгенерировать документацию + 1 значение" }).click();

  await expect.poll(() => generationBodies.length, { timeout: 8_000 }).toBe(2);
  expect(generationBodies[0]?.scope).toBeUndefined();
  expect(generationBodies[1]?.scope).toMatchObject({
    type: "target",
    target: { type: "flow-node" },
    createIfMissing: true,
    ensureValueMeaning: true,
    includeBusinessLogic: true,
  });
});

test("existing owner docs can generate selected values without regenerating the owner", async ({ page }) => {
  const docsPath = path.join(
    tempRoot,
    "src/widgets/user-profile/ui/UserProfileWidget.docs/UserProfileWidget.md"
  );
  const owner = "component:src/widgets/user-profile/ui/UserProfileWidget#UserProfileWidget";
  const generationBodies: Array<Record<string, unknown>> = [];
  await fs.mkdir(path.dirname(docsPath), { recursive: true });
  await fs.writeFile(
    docsPath,
    `---
schema: project-map.docs/v2
owner: ${owner}
generatedAt: 2026-08-10T00:00:00.000Z
review: reviewed
graphSchema: 1.1.0
flowSchema: 1.4.0
---

<!-- project-map:block
{"id":"summary","kind":"summary","targets":[{"type":"node","id":"${owner}"}]}
-->
Показывает профиль пользователя.
<!-- /project-map:block -->

<!-- project-map:block
{"id":"profile-name-meaning","kind":"value-meaning","targets":[{"type":"node","id":"${owner}"},{"type":"flow-node","id":"component-value:${owner}#profile.name"}]}
-->
Подробно объясняет отображаемое имя пользователя.
<!-- /project-map:block -->
`,
    "utf8"
  );
  await page.route("**/api/docs/node/**/generate", async (route) => {
    generationBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ jobId: "values-only-job", status: "running" }),
    });
  });
  await page.route("**/api/docs/jobs/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        jobId: "values-only-job",
        status: "success",
        nodeId: owner,
        docsPath,
        startedAt: "2026-08-10T00:00:00.000Z",
        finishedAt: "2026-08-10T00:00:01.000Z",
        logs: ["done"],
      }),
    });
  });

  try {
    await page.goto(baseUrl);
    await page.getByRole("button", { name: "user", exact: true }).click();
    const profileCard = page.locator(".structure-unit-card", {
      has: page.getByRole("button", { name: "UserProfileWidget", exact: true }),
    });
    await profileCard.locator("[data-docs-node]").click();
    const docsDialog = page.getByRole("dialog", { name: "Документация: UserProfileWidget" });
    await docsDialog.getByRole("tab", { name: "Сгенерировать" }).click();
    await docsDialog.getByRole("button", { name: "Перегенерировать с уточнением" }).click();

    const generationDialog = page.getByRole("dialog", {
      name: "Regenerate docs for UserProfileWidget",
    });
    await generationDialog.locator(".docs-value-batch-toggle input").check();
    const valuesOnlyMode = generationDialog.locator(".docs-value-batch-mode label", {
      hasText: "Только выбранные значения",
    });
    await expect(valuesOnlyMode.locator("input")).toBeChecked();
    await expect(generationDialog.locator(".docs-value-batch-list > label", {
      hasText: "profile.name",
    })).toContainText("Есть подробное · нет краткого описания");
    await generationDialog.getByRole("button", { name: "Снять выбор" }).click();
    await generationDialog.locator(".docs-value-batch-list > label", {
      hasText: "profile.name",
    }).locator("input").check();
    await generationDialog.getByRole("button", { name: "Сгенерировать 1 значение" }).click();

    await expect.poll(() => generationBodies.length, { timeout: 8_000 }).toBe(1);
    expect(generationBodies[0]?.scope).toMatchObject({
      type: "target",
      target: { type: "flow-node" },
      createIfMissing: true,
      ensureValueMeaning: true,
      includeBusinessLogic: true,
    });
  } finally {
    await fs.unlink(docsPath).catch(() => undefined);
  }
});

test("structured v1 docs expose an explicit non-destructive migration to v2", async ({ page }) => {
  const docsPath = path.join(
    tempRoot,
    "src/widgets/user-profile/ui/UserProfileWidget.docs.md"
  );
  const owner = "component:src/widgets/user-profile/ui/UserProfileWidget#UserProfileWidget";
  await fs.writeFile(
    docsPath,
    `---
node: ${owner}
sourceHash: 000000000000
generated: 2026-07-30T14:00:00Z
schema: 1
reviewed: true
---

## Summary
Показывает профиль пользователя.

## Business rules
Нет

## Scenarios
Нет

## Gotchas
Нет

## Open questions
Нужно уточнить роли.
`,
    "utf8"
  );

  try {
    await page.goto(baseUrl);
    await page.getByRole("button", { name: "user", exact: true }).click();
    const profileCard = page.locator(".structure-unit-card", {
      has: page.getByRole("button", { name: "UserProfileWidget", exact: true }),
    });
    await profileCard.locator("[data-docs-node]").click();

    const docsDialog = page.getByRole("dialog", {
      name: "Документация: UserProfileWidget",
    });
    await docsDialog.getByRole("tab", { name: "Сгенерировать" }).click();
    await docsDialog.getByRole("button", {
      name: "Мигрировать в docs v2",
    }).click();

    const migrationDialog = page.getByRole("dialog", {
      name: "Migrate docs v1 → v2 for UserProfileWidget",
    });
    await expect(migrationDialog).toBeVisible();
    await expect(migrationDialog.getByText(
      "UserProfileWidget.docs/UserProfileWidget.md"
    )).toBeVisible();
    await migrationDialog.getByRole("button", { name: "Preview prompt" }).click();
    await expect(migrationDialog.locator("pre")).toContainText(
      "Режим миграции v1 → v2"
    );
    await expect(migrationDialog.locator("pre")).toContainText(
      "Показывает профиль пользователя."
    );
    expect((await fs.stat(docsPath)).isFile()).toBe(true);
  } finally {
    await fs.unlink(docsPath).catch(() => undefined);
  }
});

test("existing docs can be read fully and regenerated with clarification", async ({ page }) => {
  const docsPath = path.join(
    tempRoot,
    "src/widgets/user-profile/ui/UserProfileWidget.docs.md"
  );
  await fs.writeFile(
    docsPath,
    `---
schema: project-map.docs/v2
owner: component:src/widgets/user-profile/ui/UserProfileWidget#UserProfileWidget
generatedAt: 2026-07-30T14:00:00Z
review: unreviewed
graphSchema: 1.1.0
flowSchema: 1.2.0
---

# UserProfileWidget

<!-- project-map:block
{"id":"summary","kind":"summary","targets":[
  {"type":"node","id":"component:src/widgets/user-profile/ui/UserProfileWidget#UserProfileWidget"}
]}
-->
Показывает профиль пользователя и связанные действия.
<!-- /project-map:block -->
`,
    "utf8"
  );

  try {
    await page.goto(baseUrl);
    await page.getByRole("button", { name: "user", exact: true }).click();
    const profileCard = page.locator(".structure-unit-card", {
      has: page.getByRole("button", { name: "UserProfileWidget", exact: true }),
    });
    await profileCard.locator("[data-docs-node]").click();

    const docsDialog = page.getByRole("dialog", { name: "Документация: UserProfileWidget" });
    await expect(docsDialog.getByText("Документация выбранного блока")).toBeVisible();
    await expect(docsDialog.getByText("Показывает профиль пользователя и связанные действия.")).toBeVisible();
    await docsDialog.getByRole("tab", { name: "Полный документ" }).click();
    await expect(docsDialog.locator(".documentation-source")).toContainText(
      "Показывает профиль пользователя и связанные действия."
    );
    await docsDialog.getByRole("tab", { name: "Документация" }).click();
    await docsDialog.getByRole("button", {
      name: "Отметить блок проверенным",
    }).click();
    await expect(docsDialog.getByText("reviewed", { exact: true }).first()).toBeVisible();
    await expect(docsDialog.getByRole("button", {
      name: "Снять review блока",
    })).toBeVisible();
    await docsDialog.getByRole("button", { name: "Уточнить этот блок" }).click();

    const blockDialog = page.getByRole("dialog", {
      name: "Regenerate docs block for UserProfileWidget",
    });
    await expect(blockDialog).toBeVisible();
    await blockDialog.getByRole("button", { name: "Preview prompt" }).click();
    await expect(blockDialog.getByText("Частичная перегенерация документации")).toBeVisible();
    await blockDialog.getByRole("button", { name: "Close" }).click();

    await docsDialog.getByRole("tab", { name: "Сгенерировать" }).click();
    await docsDialog.getByRole("button", {
      name: "Перегенерировать с уточнением",
    }).click();

    const generationDialog = page.getByRole("dialog", {
      name: "Regenerate docs for UserProfileWidget",
    });
    await expect(generationDialog.getByText("Что изменить?")).toBeVisible();
    await expect(generationDialog.getByRole("textbox")).toHaveAttribute(
      "placeholder",
      /loading state/
    );
  } finally {
    await fs.unlink(docsPath).catch(() => undefined);
  }
});

test("stale docs explain which dependency changed", async ({ page }) => {
  const docsPath = path.join(
    tempRoot,
    "src/widgets/user-profile/ui/UserProfileWidget.docs.md"
  );
  const owner = "component:src/widgets/user-profile/ui/UserProfileWidget#UserProfileWidget";
  await fs.writeFile(
    docsPath,
    `---
schema: project-map.docs/v2
owner: ${owner}
generatedAt: 2026-07-30T14:00:00Z
review: unreviewed
graphSchema: 1.1.0
flowSchema: 1.2.0
sources:
  - path: "src/widgets/user-profile/ui/UserProfileWidget.tsx"
    hash: sha256:${"0".repeat(64)}
---

<!-- project-map:block
{"id":"summary","kind":"summary","targets":[{"type":"node","id":"${owner}"}]}
-->
Показывает профиль пользователя.
<!-- /project-map:block -->
`,
    "utf8"
  );

  try {
    await page.goto(baseUrl);
    await page.getByText("Advanced", { exact: true }).click();
    await page.getByRole("button", { name: /docs: \d+\/\d+/i }).click();
    const coverageDialog = page.getByRole("dialog", { name: "Docs coverage" });
    await expect(coverageDialog.getByRole("button", {
      name: "Перегенерировать stale v2 · 1",
    })).toBeEnabled();
    await coverageDialog.getByRole("button", { name: "Close" }).click();

    await page.getByRole("button", { name: "user", exact: true }).click();
    const profileCard = page.locator(".structure-unit-card", {
      has: page.getByRole("button", { name: "UserProfileWidget", exact: true }),
    });
    await profileCard.locator("[data-docs-node]").click();

    const docsDialog = page.getByRole("dialog", {
      name: "Документация: UserProfileWidget",
    });
    await expect(docsDialog.getByText("Почему документация устарела")).toBeVisible();
    await expect(docsDialog.getByText(
      "Изменился source-файл: src/widgets/user-profile/ui/UserProfileWidget.tsx"
    )).toBeVisible();
  } finally {
    await fs.unlink(docsPath).catch(() => undefined);
  }
});

test("flow value opens target-aware docs and partial generation", async ({ page }) => {
  const docsPath = path.join(
    tempRoot,
    "src/widgets/user-profile/ui/UserProfileWidget.docs.md"
  );
  const owner = "component:src/widgets/user-profile/ui/UserProfileWidget#UserProfileWidget";
  const flowNodeId = `component-value:${owner}#profile.name`;
  await fs.writeFile(
    docsPath,
    `---
schema: project-map.docs/v2
owner: ${owner}
generatedAt: 2026-07-30T14:00:00Z
review: unreviewed
graphSchema: 1.1.0
flowSchema: 1.2.0
---

<!-- project-map:block
{"id":"summary","kind":"summary","targets":[{"type":"node","id":"${owner}"}]}
-->
Показывает профиль пользователя.
<!-- /project-map:block -->

<!-- project-map:block
{"id":"profile-name","kind":"value-meaning","targets":[
  {"type":"node","id":"${owner}"},
  {"type":"flow-node","id":"${flowNodeId}"}
]}
-->
Отображаемое имя текущего пользователя.
<!-- /project-map:block -->

<!-- project-map:block
{"id":"profile-visibility","kind":"business-rule","targets":[
  {"type":"node","id":"${owner}"},
  {"type":"flow-node","id":"${flowNodeId}"}
]}
-->
Имя показывается только для загруженного профиля.
<!-- /project-map:block -->
`,
    "utf8"
  );

  try {
    await page.goto(baseUrl);
    await page.getByRole("button", { name: "user", exact: true }).click();
    await page.getByRole("button", { name: "UserProfileWidget", exact: true }).click();
    await page.getByRole("button", { name: /^(Contract|Контракт)$/ }).click();

    const valueShell = page.locator(".unit-value-row-shell", {
      has: page.locator('[data-unit-value="profile.name"]'),
    });
    const inlineDocs = valueShell.locator(`[data-docs-value-details="${flowNodeId}"]`);
    await expect(inlineDocs.getByText("Отображаемое имя текущего пользователя.")).toBeVisible();
    await expect(inlineDocs.getByText("Имя показывается только для загруженного профиля.")).toBeVisible();
    await valueShell.locator("[data-docs-flow-node]").click();

    const docsDialog = page.getByRole("dialog", {
      name: "Документация: profile.name",
    });
    await expect(docsDialog.getByText("Отображаемое имя текущего пользователя.")).toBeVisible();
    await docsDialog.getByRole("button", {
      name: "Уточнить документацию значения",
    }).click();

    const generationDialog = page.getByRole("dialog", {
      name: "Regenerate target docs for UserProfileWidget",
    });
    await generationDialog.getByRole("button", { name: "Preview prompt" }).click();
    await expect(generationDialog.getByText("Частичная перегенерация документации")).toBeVisible();
    await expect(generationDialog.locator("pre")).toContainText("profile-name");
    await expect(generationDialog.locator("pre")).toContainText(
      "canonical id: component-value:"
    );
    await expect(generationDialog.locator("pre")).toContainText("origin=");
    await generationDialog.getByRole("button", { name: "Close" }).click();
    await docsDialog.getByRole("button", { name: "Close" }).click();

    await valueShell.locator('[data-unit-value="profile.name"]').click();
    await page.getByRole("tab", { name: "Steps", exact: true }).click();
    const journeyStep = page.locator('[data-flow-step="profile.name"]');
    await expect(journeyStep.getByText("Отображаемое имя текущего пользователя.")).toBeVisible();
    await expect(journeyStep.getByText("Имя показывается только для загруженного профиля.")).toBeVisible();
    await page.getByRole("tab", { name: "Graph", exact: true }).click();
    await flowNode(page, "profile.name").click();
    const traceDetails = page.locator("aside.detail-panel");
    await expect(traceDetails.getByText("Documentation", { exact: true })).toBeVisible();
    await expect(traceDetails.getByText("Отображаемое имя текущего пользователя.")).toBeVisible();
    await expect(traceDetails.getByRole("button", {
      name: "Открыть документацию значения: profile.name",
    })).toBeVisible();
  } finally {
    await fs.unlink(docsPath).catch(() => undefined);
  }
});

test("business context is inherited across an identity value flow", async ({ page }) => {
  const docsPath = path.join(
    tempRoot,
    "src/widgets/user-profile/ui/UserProfileWidget.docs.md"
  );
  const owner = "component:src/widgets/user-profile/ui/UserProfileWidget#UserProfileWidget";
  const valueId = `component-value:${owner}#profile.name`;
  const flowIndex = JSON.parse(
    await fs.readFile(path.join(tempRoot, ".project-map", "flows.json"), "utf8")
  ) as FlowIndex;
  const source = flowIndex.nodes.find((node) =>
    node.kind === "hook-return" && node.name === "useUserProfile.name"
  );
  expect(source).toBeDefined();

  await fs.writeFile(
    docsPath,
    `---
schema: project-map.docs/v2
owner: ${owner}
generatedAt: 2026-08-09T14:00:00Z
review: reviewed
graphSchema: 1.1.0
flowSchema: 1.4.0
---

<!-- project-map:block
{"id":"summary","kind":"summary","targets":[{"type":"node","id":"${owner}"}]}
-->
Показывает профиль пользователя.
<!-- /project-map:block -->

<!-- project-map:block
{"id":"profile-name-source","kind":"value-meaning","summary":"Отображаемое имя пользователя из контракта профиля.","valueCategory":"domain-data","targets":[
  {"type":"node","id":"${owner}"},
  {"type":"flow-node","id":"${source!.id}"}
]}
-->
Имя пользователя, подготовленное контрактом хука.
<!-- /project-map:block -->

<!-- project-map:block
{"id":"profile-name-rule","kind":"business-rule","targets":[
  {"type":"node","id":"${owner}"},
  {"type":"flow-node","id":"${source!.id}"}
]}
-->
В интерфейс передаётся только отображаемое имя текущего пользователя.
<!-- /project-map:block -->
`,
    "utf8"
  );

  try {
    await page.goto(baseUrl);
    await page.getByRole("button", { name: "RU", exact: true }).click();
    await page.getByRole("button", { name: "user", exact: true }).click();
    await page.getByRole("button", { name: "UserProfileWidget", exact: true }).click();
    const overviewProfile = page.locator('[data-symbol-story-value="profile.name"]');
    await expect(overviewProfile.locator(
      '[data-symbol-overview-value-docs="profile.name"]'
    )).toBeVisible();
    await expect(overviewProfile.locator(
      ":scope > .symbol-story-value-documentation + .symbol-story-value-body"
    )).toHaveCount(1);
    await expect(overviewProfile.getByText("Отображаемое имя пользователя из контракта профиля.")).toBeVisible();
    await expect(overviewProfile.getByText("domain data", { exact: true })).toBeVisible();
    await expect(overviewProfile.getByText("Бизнес-правил: 1")).toBeVisible();
    await expect(overviewProfile.getByText("Имя пользователя, подготовленное контрактом хука.")).toHaveCount(0);
    const detailsButton = overviewProfile.getByRole("button", { name: "Подробнее" });
    await expect(detailsButton).toHaveAttribute("aria-expanded", "false");
    await detailsButton.click();
    await expect(overviewProfile.getByRole("button", { name: "Свернуть" })).toHaveAttribute("aria-expanded", "true");
    await expect(overviewProfile.getByText("Имя пользователя, подготовленное контрактом хука.")).toBeVisible();
    await expect(overviewProfile.getByText("Поведение и ограничения")).toBeVisible();
    await expect(overviewProfile.getByText(/Унаследовано от/).first()).toContainText("useUserProfile.name");
    await expect(page.locator(
      '[data-symbol-overview-docs] [data-overview-value-docs="profile.name"]'
    )).toHaveCount(0);
    await page.getByRole("button", { name: "Контракт", exact: true }).click();

    const valueShell = page.locator(".unit-value-row-shell", {
      has: page.locator('[data-unit-value="profile.name"]'),
    });
    const inherited = valueShell.locator(`[data-docs-value-details="${valueId}"]`);
    await expect(inherited.getByText("Имя пользователя, подготовленное контрактом хука.")).toBeVisible();
    await expect(inherited.getByText(
      "В интерфейс передаётся только отображаемое имя текущего пользователя."
    )).toBeVisible();
    await expect(inherited.getByText(/Унаследовано от/).first()).toContainText(
      "useUserProfile.name"
    );
    await expect(valueShell.getByRole("button", {
      name: "Создать документацию значения: profile.name",
    })).toBeVisible();

    await valueShell.locator('[data-unit-value="profile.name"]').click();
    await page.getByRole("tab", { name: "Шаги", exact: true }).click();
    const journeyStep = page.locator('[data-flow-step="profile.name"]');
    await expect(journeyStep.getByText(
      "Имя пользователя, подготовленное контрактом хука."
    )).toBeVisible();
    await expect(journeyStep.getByText(/Унаследовано от/).first()).toContainText(
      "useUserProfile.name"
    );
  } finally {
    await fs.unlink(docsPath).catch(() => undefined);
  }
});

test("undocumented flow value can create a value-meaning block", async ({ page }) => {
  const docsPath = path.join(
    tempRoot,
    "src/widgets/user-profile/ui/UserProfileWidget.docs.md"
  );
  const owner = "component:src/widgets/user-profile/ui/UserProfileWidget#UserProfileWidget";
  await fs.writeFile(
    docsPath,
    `---
schema: project-map.docs/v2
owner: ${owner}
generatedAt: 2026-07-30T14:00:00Z
review: unreviewed
graphSchema: 1.1.0
flowSchema: 1.2.0
---

<!-- project-map:block
{"id":"summary","kind":"summary","targets":[{"type":"node","id":"${owner}"}]}
-->
Показывает профиль пользователя.
<!-- /project-map:block -->
`,
    "utf8"
  );

  try {
    await page.goto(baseUrl);
    await page.getByRole("button", { name: "user", exact: true }).click();
    await page.getByRole("button", { name: "UserProfileWidget", exact: true }).click();
    await page.getByRole("button", { name: /^(Contract|Контракт)$/ }).click();

    const valueShell = page.locator(".unit-value-row-shell", {
      has: page.locator('[data-unit-value="profile.name"]'),
    });
    await valueShell.getByRole("button", {
      name: "Создать документацию значения: profile.name",
    }).click();

    const docsDialog = page.getByRole("dialog", {
      name: "Документация: profile.name",
    });
    await expect(docsDialog.getByText("Это значение ещё не документировано")).toBeVisible();
    await docsDialog.getByRole("button", { name: "Документировать значение" }).click();

    const generationDialog = page.getByRole("dialog", {
      name: "Regenerate target docs for UserProfileWidget",
    });
    await generationDialog.getByRole("button", { name: "Preview prompt" }).click();
    await expect(generationDialog.locator("pre")).toContainText(
      "value-meaning-profile-name"
    );
    await expect(generationDialog.locator("pre")).toContainText(
      "Создай ровно один обязательный block"
    );
    await expect(generationDialog.locator("pre")).toContainText(
      "business-rule, role-rule, gotcha или open-question"
    );
  } finally {
    await fs.unlink(docsPath).catch(() => undefined);
  }
});

test("React structure keeps Fragment, repeated callsites and JSX prop slots", async ({ page }) => {
  await page.goto(baseUrl);
  await page.getByRole("button", { name: "structure-demo", exact: true }).click();

  const structure = page.locator(".structure-screen");
  await expect(structure.getByRole("button", { name: "Semantic", exact: true })).toHaveClass(/active/);
  await expect(structure.getByText("Logic before return", { exact: true })).toHaveCount(0);
  await expect(structure.getByText("Return", { exact: true })).toHaveCount(0);
  await expect(structure.getByText("Fragment", { exact: true })).toHaveCount(0);
  await expect(structure.getByRole("button", { name: "InfoPanel", exact: true })).toHaveCount(2);
  await expect(structure.locator(".structure-occurrence-label")).toHaveText([
    "usage 1 / 2",
    "usage 2 / 2",
  ]);
  const semanticEditInfo = structure.locator(".structure-unit-card", { hasText: "EditInfo" });
  await expect(semanticEditInfo.locator(".unit-relation-chip", { hasText: "addon" })).toBeVisible();

  await structure.getByRole("button", { name: "Exact structure", exact: true }).click();
  await expect(structure.getByText("Return", { exact: true }).first()).toBeVisible();
  await expect(structure.getByText("Fragment", { exact: true })).toBeVisible();
  await expect(structure.getByRole("button", { name: "InfoPanel", exact: true })).toHaveCount(2);

  const slot = structure.locator(".structure-item-slot", { hasText: "addon" });
  await expect(slot).toBeVisible();
  await expect(slot.getByRole("button", { name: "EditInfo", exact: true })).toBeVisible();

  const infoCard = structure.locator(".structure-unit-card").filter({ hasText: "InfoPanel" }).first();
  await expect(infoCard.locator(".structure-unit-tags > span")).toHaveText(["SHARED", "COMPONENT"]);
  await expect(infoCard.locator(".unit-slice-chip")).toHaveCount(0);
});

test("page actions explain initiator, API, state changes and UI outcomes", async ({ page }) => {
  await page.goto(baseUrl);
  await page.getByRole("button", { name: "RU", exact: true }).click();
  await page.getByRole("button", { name: "user", exact: true }).click();
  await page.getByRole("button", { name: "Действия", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Действия и эффекты" })).toBeVisible();
  const fetchUser = page.locator('[data-page-operation="fetchUser"]');
  await expect(fetchUser).toBeVisible();
  await expect(fetchUser).toContainText("useUserProfile");
  await expect(fetchUser).toContainText("GET /api/users/${userId}");
  await expect(fetchUser).toContainText("state.user.current");
  await expect(fetchUser).toContainText("точное поле");
  await expect(fetchUser).toContainText("UserCard.name");

  const topologyOnly = page.locator('[data-page-operation="user.touch"]');
  await expect(topologyOnly).toContainText("Операция доказана структурой");

  await fetchUser.getByRole("button", { name: "Открыть доказательство операции" }).click();
  const sourceDialog = page.getByRole("dialog", { name: "fetchUser" });
  await expect(sourceDialog).toContainText("useUserProfile.ts");
  await sourceDialog.getByRole("button", { name: "Закрыть" }).click();

  await fetchUser.locator(".page-action-values button", { hasText: "profile.name" }).click();
  await expect(page.getByRole("heading", { name: "Как движется значение" })).toBeVisible();
});

test("page impact separates proven blast radius from possible paths", async ({ page }) => {
  await page.goto(baseUrl);
  await page.getByRole("button", { name: "RU", exact: true }).click();
  await page.getByRole("button", { name: "user", exact: true }).click();
  await page.getByRole("button", { name: "Влияние", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Влияние изменений" })).toBeVisible();
  await expect(page.locator(".page-impact-answer")).toContainText("точек изменения влияют на страницу");

  const api = page.locator('[data-impact-target="GET /api/users/${userId}"]');
  await expect(api).toBeVisible();
  await expect(api).toContainText("profile.name");
  await expect(api).toContainText("UserCard.name");
  await expect(api).toContainText("user");

  await api.getByRole("button", { name: "Доказательство" }).click();
  const evidence = page.getByRole("dialog", { name: "GET /api/users/${userId}" });
  await expect(evidence).toContainText("thunks.ts");
  await evidence.getByRole("button", { name: "Закрыть" }).click();

  await api.getByRole("button", { name: "Открыть граф" }).click();
  await expect(page.locator(".react-flow")).toBeVisible();
  await expect(page.locator("aside.detail-panel").getByRole("heading", {
    name: "GET /api/users/${userId}",
  })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Влияние изменений" })).toBeVisible();

  await page.locator(".page-impact-stage").filter({ hasText: "Поля состояния" }).locator(":scope > summary").click();
  const status = page.locator('[data-impact-target="state.user.status"]');
  await expect(status).toBeVisible();
  await expect(status.locator(".page-impact-possible")).toHaveCount(0);
  await expect(status.getByRole("button", { name: "status", exact: true })).toBeVisible();

  await api.getByRole("button", { name: "profile.name", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Как движется значение" })).toBeVisible();
});

test("analysis gaps explain the reason, affected value and evidence", async ({ page }) => {
  const hookPath = path.join(tempRoot, "src/features/user-profile/model/useUserProfile.ts");
  const widgetPath = path.join(tempRoot, "src/widgets/user-profile/ui/UserProfileWidget.tsx");
  const selectorsPath = path.join(tempRoot, "src/entities/user/model/selectors.ts");
  const entityIndexPath = path.join(tempRoot, "src/entities/user/index.ts");
  const hookSource = await fs.readFile(hookPath, "utf8");
  const widgetSource = await fs.readFile(widgetPath, "utf8");
  const selectorsSource = await fs.readFile(selectorsPath, "utf8");
  const entityIndexSource = await fs.readFile(entityIndexPath, "utf8");

  await fs.writeFile(selectorsPath, `${selectorsSource}
export const selectDiagnosticBase = (state: unknown) =>
  (state as Record<string, unknown>)[getDiagnosticSliceKey()];
export const selectDiagnostic = (state: unknown) =>
  selectDiagnosticBase(state).diagnostic;
`);
  await fs.writeFile(entityIndexPath, entityIndexSource.replace(
    "selectCurrentUser, selectUserError, selectUserSummary",
    "selectCurrentUser, selectUserError, selectUserSummary, selectDiagnostic"
  ));

  await fs.writeFile(hookPath, hookSource
    .replace(
      "selectCurrentUser, selectUserError, selectUserSummary",
      "selectCurrentUser, selectUserError, selectUserSummary, selectDiagnostic"
    )
    .replace(
      "  const query = useGetUserQuery(user?.id);",
      "  const diagnostic = useAppSelector(selectDiagnostic);\n  const query = useGetUserQuery(user?.id);"
    )
    .replace(
      "    displayStatus: status ?? query.data?.name,",
      "    displayStatus: status ?? query.data?.name,\n    diagnostic,"
    ));
  await fs.writeFile(widgetPath, widgetSource.replace(
    "  return <UserCard name={profile.name} />;",
    "  return <><UserCard name={profile.name} /><span>{profile.diagnostic ? \"debug\" : \"ready\"}</span></>;"
  ));
  await runScan({ projectRoot: tempRoot });

  await page.goto(baseUrl);
  await page.getByRole("button", { name: "RU", exact: true }).click();
  await page.getByRole("button", { name: "user", exact: true }).click();

  const issues = page.locator(".page-analysis-issues");
  await expect(page.getByRole("heading", { name: "Кратко о странице" })).toBeVisible();
  await expect(issues.getByText("Почему анализ неполон", { exact: true })).toBeVisible();
  await issues.locator("summary").click();
  await expect(issues.getByText("Источник селектора не записан", { exact: true })).toBeVisible();
  await expect(issues.getByText(/Блокирует источник/)).toBeVisible();
  await expect(issues.getByText("diagnostic", { exact: true }).first()).toBeVisible();

  await issues.getByRole("button", { name: "Открыть доказательство" }).click();
  const sourceDialog = page.getByRole("dialog", { name: "Источник селектора не записан" });
  await expect(sourceDialog).toContainText("src/entities/user/model/selectors.ts");
  await sourceDialog.getByRole("button", { name: "Закрыть" }).click();

  await issues.locator(".page-analysis-issue-values button").first().click();
  await expect(page.locator(".value-journey-screen")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Как движется значение" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Доказательства" })).toBeVisible();
  await expect(page.locator(".journey-gap-reason")).toContainText("Источник селектора не записан");
  await expect(page.locator(".journey-gap-reason")).toContainText("Код анализатора: selector-source-not-recorded");
});
