import { describe, expect, it } from "vitest";
import {
  mergeDocsV2Blocks,
} from "../src/modules/docs/server/services/docsV2MergeService.js";
import {
  isV2FullyReviewed,
  parseDocsV2File,
} from "../src/modules/docs/server/services/docsV2FileFormat.js";

const OWNER = "component:a";
const TARGET = "component-value:component:a#visible";

const DOCUMENT = `---
schema: project-map.docs/v2
owner: ${OWNER}
generatedAt: 2026-07-30T14:00:00Z
review: reviewed
graphSchema: 1.1.0
flowSchema: 1.2.0
---

# A

Этот ручной текст должен сохраниться.

<!-- project-map:block
{"id":"summary","kind":"summary","review":"reviewed","targets":[{"type":"node","id":"${OWNER}"}]}
-->
Старое summary.
<!-- /project-map:block -->

## Правила

<!-- project-map:block
{"id":"visibility","kind":"business-rule","review":"reviewed","targets":[{"type":"node","id":"${OWNER}"},{"type":"flow-node","id":"${TARGET}"}]}
-->
Старое правило.
<!-- /project-map:block -->

Ручное заключение.
`;

describe("mergeDocsV2Blocks", () => {
  it("replaces only selected annotations and resets their review", () => {
    const before = parseDocsV2File(DOCUMENT)!;
    const summaryBefore = DOCUMENT.slice(
      before.blocks[0]!.source.start,
      before.blocks[0]!.source.end
    );
    const result = mergeDocsV2Blocks({
      content: DOCUMENT,
      fragment: `<!-- project-map:block
{"id":"visibility","kind":"gotcha","review":"reviewed","targets":[{"type":"node","id":"${OWNER}"},{"type":"flow-node","id":"${TARGET}"}]}
-->
Новое правило.
<!-- /project-map:block -->`,
      scope: { type: "annotation", annotationIds: ["visibility"] },
    });

    expect(result.replacedAnnotationIds).toEqual(["visibility"]);
    expect(result.content).toContain("Новое правило.");
    expect(result.content).not.toContain("Старое правило.");
    expect(result.content).toContain("Этот ручной текст должен сохраниться.");
    expect(result.content).toContain("Ручное заключение.");
    expect(result.parsed.blocks.find((block) =>
      block.metadata.id === "visibility"
    )?.metadata.review).toBe("unreviewed");
    expect(isV2FullyReviewed(result.parsed)).toBe(false);

    const summaryAfter = result.parsed.blocks.find((block) =>
      block.metadata.id === "summary"
    )!;
    expect(
      result.content.slice(summaryAfter.source.start, summaryAfter.source.end)
    ).toBe(summaryBefore);
  });

  it("replaces every annotation addressed to a target", () => {
    const result = mergeDocsV2Blocks({
      content: DOCUMENT,
      fragment: `<!-- project-map:block
{"id":"summary","kind":"summary","targets":[{"type":"node","id":"${OWNER}"}]}
-->
Новое summary.
<!-- /project-map:block -->

<!-- project-map:block
{"id":"visibility","kind":"business-rule","targets":[{"type":"node","id":"${OWNER}"},{"type":"flow-node","id":"${TARGET}"}]}
-->
Новое правило.
<!-- /project-map:block -->`,
      scope: { type: "target", target: { type: "node", id: OWNER } },
    });

    expect(result.replacedAnnotationIds).toEqual(["summary", "visibility"]);
    expect(result.parsed.blocks.map((block) => block.markdown)).toEqual([
      "Новое summary.",
      "Новое правило.",
    ]);
  });

  it("rejects changed annotation sets and fragments outside the target scope", () => {
    const mismatched = `<!-- project-map:block
{"id":"other","kind":"gotcha","targets":[{"type":"node","id":"${OWNER}"}]}
-->
Другое.
<!-- /project-map:block -->`;
    expect(() => mergeDocsV2Blocks({
      content: DOCUMENT,
      fragment: mismatched,
      scope: { type: "annotation", annotationIds: ["visibility"] },
    })).toThrow(/состав annotations/i);

    const wrongTarget = `<!-- project-map:block
{"id":"visibility","kind":"gotcha","targets":[{"type":"flow-node","id":"other"}]}
-->
Другое.
<!-- /project-map:block -->`;
    expect(() => mergeDocsV2Blocks({
      content: DOCUMENT,
      fragment: wrongTarget,
      scope: { type: "target", target: { type: "flow-node", id: TARGET } },
    })).toThrow(/не адресует выбранный target/i);
  });

  it("rejects malformed source and generated fragments", () => {
    expect(() => mergeDocsV2Blocks({
      content: DOCUMENT.replace("<!-- /project-map:block -->", ""),
      fragment: "",
      scope: { type: "annotation", annotationIds: ["summary"] },
    })).toThrow(/исходный документ docs v2 невалиден/i);

    expect(() => mergeDocsV2Blocks({
      content: DOCUMENT,
      fragment: "Только обычный Markdown",
      scope: { type: "annotation", annotationIds: ["summary"] },
    })).toThrow(/не содержит project-map:block/i);
  });

  it("appends one new target annotation without changing existing blocks", () => {
    const target = { type: "flow-node" as const, id: "component-value:component:a#new" };
    const result = mergeDocsV2Blocks({
      content: DOCUMENT,
      fragment: `<!-- project-map:block
{"id":"value-meaning-new","kind":"value-meaning","summary":"Новое бизнес-значение.","valueCategory":"domain-data","targets":[{"type":"node","id":"${OWNER}"},{"type":"flow-node","id":"${target.id}"}]}
-->
Новое значение.
<!-- /project-map:block -->`,
      scope: { type: "target", target, createIfMissing: true },
    });

    expect(result.replacedAnnotationIds).toEqual(["value-meaning-new"]);
    expect(result.parsed.blocks.map((block) => block.metadata.id)).toEqual([
      "summary",
      "visibility",
      "value-meaning-new",
    ]);
    expect(result.content).toContain("Старое summary.");
    expect(result.content).toContain("Старое правило.");
    expect(result.content).toContain("Новое значение.");
  });

  it("appends value-meaning without replacing an existing rule for the same target", () => {
    const before = parseDocsV2File(DOCUMENT)!;
    const rule = before.blocks.find((block) => block.metadata.id === "visibility")!;
    const ruleBefore = DOCUMENT.slice(rule.source.start, rule.source.end);
    const result = mergeDocsV2Blocks({
      content: DOCUMENT,
      fragment: `<!-- project-map:block
{"id":"value-meaning-visible","kind":"value-meaning","summary":"Итоговое решение о видимости.","valueCategory":"decision","targets":[{"type":"node","id":"${OWNER}"},{"type":"flow-node","id":"${TARGET}"}]}
-->
Показывает итоговое решение о видимости.
<!-- /project-map:block -->`,
      scope: {
        type: "target",
        target: { type: "flow-node", id: TARGET },
        createIfMissing: true,
        ensureValueMeaning: true,
      },
    });

    const ruleAfter = result.parsed.blocks.find((block) => block.metadata.id === "visibility")!;
    expect(result.content.slice(ruleAfter.source.start, ruleAfter.source.end)).toBe(ruleBefore);
    expect(result.replacedAnnotationIds).toEqual(["value-meaning-visible"]);
  });

  it("rejects a generated value-meaning without a compact summary", () => {
    expect(() => mergeDocsV2Blocks({
      content: DOCUMENT,
      fragment: `<!-- project-map:block
{"id":"value-meaning-new","kind":"value-meaning","targets":[{"type":"node","id":"${OWNER}"},{"type":"flow-node","id":"component-value:component:a#new"}]}
-->
Подробное описание без краткого summary.
<!-- /project-map:block -->`,
      scope: {
        type: "target",
        target: { type: "flow-node", id: "component-value:component:a#new" },
        createIfMissing: true,
      },
    })).toThrow(/metadata summary/i);
  });

  it("rejects a generated value-meaning without category or with technical flow narration", () => {
    const target = { type: "flow-node" as const, id: "component-value:component:a#new" };
    expect(() => mergeDocsV2Blocks({
      content: DOCUMENT,
      fragment: `<!-- project-map:block
{"id":"value-meaning-new","kind":"value-meaning","summary":"Состояние загрузки контактов.","targets":[{"type":"node","id":"${OWNER}"},{"type":"flow-node","id":"${target.id}"}]}
-->
Контакты ещё загружаются.
<!-- /project-map:block -->`,
      scope: { type: "target", target, createIfMissing: true },
    })).toThrow(/valueCategory/i);

    expect(() => mergeDocsV2Blocks({
      content: DOCUMENT,
      fragment: `<!-- project-map:block
{"id":"value-meaning-new","kind":"value-meaning","summary":"Состояние загрузки контактов.","valueCategory":"ui-state","targets":[{"type":"node","id":"${OWNER}"},{"type":"flow-node","id":"${target.id}"}]}
-->
Значение берётся из store через selector selectContactsLoading и передаётся в downstream prop; origin=proven.
<!-- /project-map:block -->`,
      scope: { type: "target", target, createIfMissing: true },
    })).toThrow(/техническую трассировку/i);
  });

  it("appends a value meaning and proven business logic without changing existing rules", () => {
    const before = parseDocsV2File(DOCUMENT)!;
    const existingRule = before.blocks.find((block) => block.metadata.id === "visibility")!;
    const existingRuleRaw = DOCUMENT.slice(existingRule.source.start, existingRule.source.end);
    const result = mergeDocsV2Blocks({
      content: DOCUMENT,
      fragment: `<!-- project-map:block
{"id":"value-meaning-visible","kind":"value-meaning","summary":"Показывает доступность действия.","valueCategory":"decision","targets":[{"type":"node","id":"${OWNER}"},{"type":"flow-node","id":"${TARGET}"}]}
-->
Подробно описывает вычисление и использование доступности действия.
<!-- /project-map:block -->

<!-- project-map:block
{"id":"role-rule-visible-owner","kind":"role-rule","targets":[{"type":"node","id":"${OWNER}"},{"type":"flow-node","id":"${TARGET}"}]}
-->
Действие доступно только владельцу записи.
<!-- /project-map:block -->`,
      scope: {
        type: "target",
        target: { type: "flow-node", id: TARGET },
        createIfMissing: true,
        ensureValueMeaning: true,
        includeBusinessLogic: true,
      },
    });

    const preservedRule = result.parsed.blocks.find((block) => block.metadata.id === "visibility")!;
    expect(result.content.slice(preservedRule.source.start, preservedRule.source.end)).toBe(existingRuleRaw);
    expect(result.replacedAnnotationIds).toEqual([
      "value-meaning-visible",
      "role-rule-visible-owner",
    ]);
    expect(result.parsed.blocks.map((block) => block.metadata.id)).toContain("role-rule-visible-owner");
  });
});
