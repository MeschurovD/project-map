import { describe, expect, it } from "vitest";
import {
  buildRuleTagIndex,
  parseDocsFile,
  validateDocsFile,
  withReviewedFlag,
} from "../src/modules/docs/server/services/docsFileFormat.js";

const VALID_DOCS = `---
node: component:src/features/delete-record/ui/DeleteRecordButton#DeleteRecordButton
sourceHash: a3f9c1d2e4b5   # хеш исходника
generated: 2026-06-12
schema: 1
reviewed: false
---

## Summary
Кнопка удаления записи; видна только владельцу при подтверждённой записи.

## Business rules
- Кнопка скрыта, пока запись не подтверждена менеджером. [showButton, selectCanDelete]
- Удаление необратимо: подтверждение через модалку, без undo. [handleDelete]

## Scenarios
- Удаление записи: клик → модалка → DELETE /records/:id → редирект в список.

## Gotchas
Нет

## Open questions
- Неясно, почему доступ проверяется и на фронте, и в thunk.
`;

const NODE_ID = "component:src/features/delete-record/ui/DeleteRecordButton#DeleteRecordButton";

describe("parseDocsFile", () => {
  it("parses frontmatter, sections, summary and tagged rules", () => {
    const parsed = parseDocsFile(VALID_DOCS);

    expect(parsed.kind).toBe("structured");
    if (parsed.kind !== "structured") return;

    expect(parsed.frontmatter).toEqual({
      node: NODE_ID,
      sourceHash: "a3f9c1d2e4b5",
      generated: "2026-06-12",
      schema: 1,
      reviewed: false,
    });
    expect(parsed.summary).toBe("Кнопка удаления записи; видна только владельцу при подтверждённой записи.");
    expect(parsed.sections.map((section) => section.title)).toEqual([
      "Summary",
      "Business rules",
      "Scenarios",
      "Gotchas",
      "Open questions",
    ]);
    expect(parsed.sections.find((section) => section.title === "Gotchas")?.empty).toBe(true);
    expect(parsed.rules).toEqual([
      {
        text: "Кнопка скрыта, пока запись не подтверждена менеджером.",
        tags: ["showButton", "selectCanDelete"],
      },
      {
        text: "Удаление необратимо: подтверждение через модалку, без undo.",
        tags: ["handleDelete"],
      },
    ]);
  });

  it("treats files without frontmatter as legacy", () => {
    expect(parseDocsFile("# Old free-form docs\n\nText.\n")).toEqual({
      kind: "legacy",
      content: "# Old free-form docs\n\nText.\n",
    });
  });

  it("treats an unterminated frontmatter block as legacy", () => {
    expect(parseDocsFile("---\nnode: x\nno closing fence").kind).toBe("legacy");
  });
});

describe("validateDocsFile", () => {
  const params = { nodeId: NODE_ID, nodeType: "component" };

  it("accepts a valid file", () => {
    expect(validateDocsFile(parseDocsFile(VALID_DOCS), params)).toEqual([]);
  });

  it("rejects legacy files", () => {
    expect(validateDocsFile(parseDocsFile("# Docs"), params)).toEqual([
      expect.stringContaining("frontmatter"),
    ]);
  });

  it("reports a missing required section", () => {
    const withoutScenarios = VALID_DOCS.replace(/## Scenarios[\s\S]*?(?=## Gotchas)/, "");
    expect(validateDocsFile(parseDocsFile(withoutScenarios), params)).toEqual([
      expect.stringContaining('"## Scenarios"'),
    ]);
  });

  it("reports a summary over the limit and a wrong node id", () => {
    const longSummary = VALID_DOCS.replace(
      /## Summary\n.*\n/,
      `## Summary\n${"о".repeat(200)}\n`
    );
    const errors = validateDocsFile(parseDocsFile(longSummary), { ...params, nodeId: "component:other" });

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Summary длиннее"),
        expect.stringContaining('"node"'),
      ])
    );
  });

  it("requires hook-specific sections for hooks", () => {
    const errors = validateDocsFile(parseDocsFile(VALID_DOCS), { nodeId: NODE_ID, nodeType: "hook" });
    expect(errors).toEqual([expect.stringContaining('"## Contract"')]);
  });
});

describe("withReviewedFlag", () => {
  it("replaces an existing reviewed line without touching the body", () => {
    const updated = withReviewedFlag(VALID_DOCS, true);

    expect(updated).toContain("reviewed: true");
    expect(updated).not.toContain("reviewed: false");
    expect(parseDocsFile(updated)).toMatchObject({ frontmatter: { reviewed: true } });
    // Body and other frontmatter fields stay byte-for-byte the same.
    expect(updated).toBe(VALID_DOCS.replace("reviewed: false", "reviewed: true"));
  });

  it("can clear the flag back to false", () => {
    const reviewed = withReviewedFlag(VALID_DOCS, true);
    expect(withReviewedFlag(reviewed, false)).toBe(VALID_DOCS);
  });

  it("inserts a reviewed line when frontmatter omits it", () => {
    const source = "---\nnode: component:a\nschema: 1\n---\n\n## Summary\nТекст.\n";
    const updated = withReviewedFlag(source, true);

    expect(updated).toBe("---\nnode: component:a\nschema: 1\nreviewed: true\n---\n\n## Summary\nТекст.\n");
    expect(parseDocsFile(updated)).toMatchObject({ frontmatter: { reviewed: true } });
  });

  it("rejects files without frontmatter", () => {
    expect(() => withReviewedFlag("# Legacy docs\n", true)).toThrow(/frontmatter/);
  });
});

describe("buildRuleTagIndex", () => {
  it("indexes rules by identifier tag", () => {
    const index = buildRuleTagIndex(parseDocsFile(VALID_DOCS));

    expect([...index.keys()].sort()).toEqual(["handleDelete", "selectCanDelete", "showButton"]);
    expect(index.get("showButton")).toEqual([
      expect.objectContaining({ text: expect.stringContaining("скрыта") }),
    ]);
  });
});
