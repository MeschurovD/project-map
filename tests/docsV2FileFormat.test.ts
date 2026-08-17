import { describe, expect, it } from "vitest";
import {
  DOCS_V2_SCHEMA,
  isV2FullyReviewed,
  parseDocsV2BlockFragment,
  parseDocsV2File,
  validateDocsV2File,
  withV2ReviewStatus,
  withV2BlockReviewStatus,
  withV2SourceManifest,
} from "../src/modules/docs/server/services/docsV2FileFormat.js";

const OWNER = "component:src/features/delete/ui/DeleteButton#DeleteButton";
const VALUE = `component-value:${OWNER}#showButton`;

const VALID_V2 = `---
schema: ${DOCS_V2_SCHEMA}
owner: ${OWNER}
generatedAt: 2026-07-30T14:00:00Z
review: unreviewed
graphSchema: 1.1.0
flowSchema: 1.2.0
---

# DeleteButton

## Назначение

<!-- project-map:block
{"id":"summary","kind":"summary","targets":[{"type":"node","id":"${OWNER}"}]}
-->
Удаляет подтверждённую запись после явного подтверждения.
<!-- /project-map:block -->

## Правила

<!-- project-map:block
{"id":"availability","kind":"business-rule","confidence":"high","targets":[
  {"type":"node","id":"${OWNER}"},
  {"type":"flow-node","id":"${VALUE}"}
]}
-->
Действие доступно только владельцу записи.
<!-- /project-map:block -->
`;

describe("parseDocsV2File", () => {
  it("parses typed blocks independently of Markdown headings", () => {
    const parsed = parseDocsV2File(VALID_V2);

    expect(parsed).not.toBeNull();
    expect(parsed?.frontmatter).toMatchObject({
      schema: DOCS_V2_SCHEMA,
      owner: OWNER,
      review: "unreviewed",
      graphSchema: "1.1.0",
      flowSchema: "1.2.0",
    });
    expect(parsed?.blocks).toEqual([
      expect.objectContaining({
        metadata: {
          id: "summary",
          kind: "summary",
          targets: [{ type: "node", id: OWNER }],
          summary: undefined,
          valueCategory: undefined,
          confidence: undefined,
          review: undefined,
        },
        markdown: expect.stringContaining("Удаляет"),
      }),
      expect.objectContaining({
        metadata: {
          id: "availability",
          kind: "business-rule",
          targets: [
            { type: "node", id: OWNER },
            { type: "flow-node", id: VALUE },
          ],
          summary: undefined,
          valueCategory: undefined,
          confidence: "high",
          review: undefined,
        },
      }),
    ]);
    expect(validateDocsV2File(parsed!)).toEqual([]);
    expect(
      VALID_V2.slice(
        parsed!.blocks[0]!.source.start,
        parsed!.blocks[0]!.source.end
      )
    ).toContain('"id":"summary"');
  });

  it("parses standalone blocks with fragment-relative source ranges", () => {
    const fragment = `Heading before

<!-- project-map:block
{"id":"rule","kind":"business-rule","targets":[{"type":"node","id":"${OWNER}"}]}
-->
Правило.
<!-- /project-map:block -->
`;
    const parsed = parseDocsV2BlockFragment(fragment);

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.blocks).toHaveLength(1);
    expect(
      fragment.slice(parsed.blocks[0]!.source.start, parsed.blocks[0]!.source.end)
    ).toContain("Правило.");
  });

  it("preserves compact value summaries and warns without invalidating legacy value meanings", () => {
    const withSummary = `${VALID_V2}
<!-- project-map:block
{"id":"value-meaning","kind":"value-meaning","summary":"Показывает доступность удаления записи.","valueCategory":"decision","targets":[{"type":"node","id":"${OWNER}"},{"type":"flow-node","id":"${VALUE}"}]}
-->
Подробно объясняет, как доступность зависит от владельца и состояния записи.
<!-- /project-map:block -->
`;
    const parsed = parseDocsV2File(withSummary)!;

    expect(parsed.blocks.at(-1)?.metadata.summary).toBe(
      "Показывает доступность удаления записи."
    );
    expect(parsed.blocks.at(-1)?.metadata.valueCategory).toBe("decision");
    expect(parsed.diagnostics).toEqual([]);

    const legacy = parseDocsV2File(withSummary.replace(
      ',"summary":"Показывает доступность удаления записи."',
      ""
    ))!;
    expect(legacy.diagnostics).toContainEqual(expect.objectContaining({
      severity: "warning",
      code: "missing-value-summary",
      blockId: "value-meaning",
    }));
  });

  it("returns null for v1 and free-form Markdown", () => {
    expect(parseDocsV2File("# Legacy")).toBeNull();
    expect(parseDocsV2File("---\nschema: 1\n---\n\n## Summary\nText")).toBeNull();
  });

  it("reports malformed blocks, duplicate ids and missing required content", () => {
    const invalid = VALID_V2
      .replace(`owner: ${OWNER}\n`, "")
      .replace(
        /<!-- project-map:block[\s\S]*?<!-- \/project-map:block -->/,
        ""
      )
      .replace('"id":"availability"', '"id":"duplicate"')
      .replace(
        "<!-- /project-map:block -->",
        `<!-- /project-map:block -->

<!-- project-map:block
{"id":"duplicate","kind":"gotcha","targets":[{"type":"node","id":"${OWNER}"}]}
-->
Повтор.
<!-- /project-map:block -->`
      );
    const parsed = parseDocsV2File(invalid)!;

    expect(parsed.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(["missing-owner", "missing-summary", "duplicate-block-id"])
    );
  });

  it("updates v2 review without changing block content", () => {
    const reviewed = withV2ReviewStatus(VALID_V2, true);

    expect(reviewed).toContain("review: reviewed");
    expect(reviewed.replace("review: reviewed", "review: unreviewed")).toBe(VALID_V2);
    expect(parseDocsV2File(reviewed)?.frontmatter.review).toBe("reviewed");
  });

  it("round-trips a targeted source manifest update", () => {
    const sources = [
      {
        path: "src/features/delete/ui/DeleteButton.tsx",
        hash: `sha256:${"a".repeat(64)}` as const,
      },
      {
        path: "src/entities/record/model/selectors.ts",
        hash: `sha256:${"b".repeat(64)}` as const,
      },
    ];
    const updated = withV2SourceManifest(
      VALID_V2,
      sources,
      "2026-07-30T18:00:00Z"
    );
    const parsed = parseDocsV2File(updated)!;

    expect(parsed.frontmatter.generatedAt).toBe("2026-07-30T18:00:00Z");
    expect(parsed.frontmatter.sources).toEqual(sources);
    expect(parsed.blocks.map((block) => block.markdown)).toEqual(
      parseDocsV2File(VALID_V2)!.blocks.map((block) => block.markdown)
    );
  });

  it("updates review per block and derives the document review state", () => {
    const original = parseDocsV2File(VALID_V2)!;
    const availabilityRaw = VALID_V2.slice(
      original.blocks[1]!.source.start,
      original.blocks[1]!.source.end
    );
    const summaryReviewed = withV2BlockReviewStatus(
      VALID_V2,
      ["summary"],
      true
    );
    const partial = parseDocsV2File(summaryReviewed)!;

    expect(partial.blocks[0]!.metadata.review).toBe("reviewed");
    expect(partial.frontmatter.review).toBe("unreviewed");
    expect(isV2FullyReviewed(partial)).toBe(false);
    expect(summaryReviewed).toContain(availabilityRaw);

    const allReviewed = parseDocsV2File(withV2BlockReviewStatus(
      summaryReviewed,
      ["availability"],
      true
    ))!;
    expect(allReviewed.frontmatter.review).toBe("reviewed");
    expect(isV2FullyReviewed(allReviewed)).toBe(true);

    const reset = parseDocsV2File(withV2BlockReviewStatus(
      allReviewed.content,
      ["summary"],
      false
    ))!;
    expect(reset.frontmatter.review).toBe("unreviewed");
    expect(reset.blocks[1]!.metadata.review).toBe("reviewed");
    expect(isV2FullyReviewed(reset)).toBe(false);
  });
});
