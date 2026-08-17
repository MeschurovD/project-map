import { describe, expect, it } from "vitest";
import type { MergedEnrichmentAnnotation } from "../src/modules/enrichmentTypes.js";
import {
  docsValuePresentation,
  docsValueSummary,
  hasDocsValueDetails,
} from "../src/modules/docs/ui/docsValuePresentation.js";

describe("docsValuePresentation", () => {
  it("selects meaning, business rules, and cautions for a canonical value", () => {
    const presentation = docsValuePresentation([
      annotation("meaning", "value-meaning", "Controls delete availability."),
      annotation("rule", "business-rule", "Only the owner can delete."),
      annotation("role", "role-rule", "Managers can override the restriction."),
      annotation("gotcha", "gotcha", "Permissions load asynchronously."),
      annotation("question", "open-question", "Legacy fallback is unclear."),
    ]);

    expect(presentation.meaning?.id).toBe("meaning");
    expect(presentation.rules.map((entry) => entry.id)).toEqual(["rule", "role"]);
    expect(presentation.cautions.map((entry) => entry.id)).toEqual(["gotcha", "question"]);
    expect(hasDocsValueDetails(presentation)).toBe(true);
  });

  it("uses a contract when value-meaning is absent", () => {
    const presentation = docsValuePresentation([
      annotation("contract", "contract", "Returns a stable permission flag."),
    ]);

    expect(presentation.meaning?.id).toBe("contract");
  });

  it("prefers structured value summary and falls back to compact Markdown", () => {
    const explicit = {
      ...annotation("meaning", "value-meaning", "Подробное описание формирования значения."),
      summary: "Краткий бизнес-смысл значения.",
    };
    expect(docsValueSummary(docsValuePresentation([explicit]))).toBe(
      "Краткий бизнес-смысл значения."
    );

    const fallback = annotation(
      "legacy",
      "value-meaning",
      "**Компания нового кредитора** используется для отображения реквизитов.\n\nДальнейшие подробности."
    );
    expect(docsValueSummary(docsValuePresentation([fallback]))).toBe(
      "Компания нового кредитора используется для отображения реквизитов. Дальнейшие подробности."
    );
  });

  it("prefers direct meaning and rules over computed matches", () => {
    const inheritedMeaning = {
      ...annotation("inherited-meaning", "value-meaning", "Inherited meaning"),
      association: {
        kind: "inherited" as const,
        sourceTargetId: "selector-result:selector:a#result",
        relations: ["binds"],
      },
    };
    const relatedRule = {
      ...annotation("related-rule", "business-rule", "Related rule"),
      association: {
        kind: "related" as const,
        sourceTargetId: "component-value:component:a#source",
        relations: ["derives"],
      },
    };
    const presentation = docsValuePresentation([
      inheritedMeaning,
      relatedRule,
      annotation("direct-meaning", "value-meaning", "Direct meaning"),
      annotation("direct-rule", "business-rule", "Direct rule"),
    ]);

    expect(presentation.meaning?.id).toBe("direct-meaning");
    expect(presentation.rules.map((entry) => entry.id)).toEqual([
      "direct-rule",
      "related-rule",
    ]);
  });

  it("ignores annotations from other modules and unrelated kinds", () => {
    const otherModule = {
      ...annotation("other", "value-meaning", "E2E meaning"),
      moduleId: "e2e",
    };
    const presentation = docsValuePresentation([
      otherModule,
      annotation("scenario", "scenario", "Delete flow"),
    ]);

    expect(presentation).toEqual({ meaning: undefined, rules: [], cautions: [] });
    expect(hasDocsValueDetails(presentation)).toBe(false);
  });
});

function annotation(
  id: string,
  kind: string,
  markdown: string
): MergedEnrichmentAnnotation {
  return {
    moduleId: "docs",
    id,
    ownerNodeId: "component:a",
    kind,
    targets: [{ type: "flow-node", id: "component-value:component:a#canDelete" }],
    markdown,
  };
}
