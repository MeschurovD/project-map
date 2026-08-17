import type { MergedEnrichmentAnnotation } from "../../enrichmentTypes.js";

export type DocsValuePresentation = {
  meaning?: MergedEnrichmentAnnotation;
  rules: MergedEnrichmentAnnotation[];
  cautions: MergedEnrichmentAnnotation[];
};

const VALUE_SUMMARY_LIMIT = 200;

const RULE_KINDS = new Set(["business-rule", "role-rule"]);
const CAUTION_KINDS = new Set(["gotcha", "open-question"]);

export function docsValuePresentation(
  annotations: MergedEnrichmentAnnotation[]
): DocsValuePresentation {
  const docs = annotations.filter((annotation) => annotation.moduleId === "docs");
  const ordered = [...docs].sort((left, right) =>
    associationRank(left) - associationRank(right)
  );
  return {
    meaning: ordered.find((annotation) => annotation.kind === "value-meaning") ??
      ordered.find((annotation) => annotation.kind === "contract"),
    rules: ordered.filter((annotation) => RULE_KINDS.has(annotation.kind)),
    cautions: ordered.filter((annotation) => CAUTION_KINDS.has(annotation.kind)),
  };
}

function associationRank(annotation: MergedEnrichmentAnnotation) {
  if (!annotation.association) return 0;
  return annotation.association.kind === "inherited" ? 1 : 2;
}

export function hasDocsValueDetails(presentation: DocsValuePresentation) {
  return Boolean(
    presentation.meaning ||
    presentation.rules.length > 0 ||
    presentation.cautions.length > 0
  );
}

export function docsValueSummary(presentation: DocsValuePresentation) {
  const source = presentation.meaning?.summary ??
    presentation.meaning?.markdown ??
    presentation.rules[0]?.summary ??
    presentation.rules[0]?.markdown ??
    presentation.cautions[0]?.summary ??
    presentation.cautions[0]?.markdown;
  return source ? compactPlainText(source, VALUE_SUMMARY_LIMIT) : undefined;
}

function compactPlainText(markdown: string, limit: number) {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(^|\s)[~-]+\s/g, "$1")
    .replace(/[`*_>#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= limit) return plain;
  const sentence = plain.slice(0, limit + 1).match(/^(.{1,200}?[.!?])(?:\s|$)/)?.[1];
  if (sentence) return sentence;
  const clipped = plain.slice(0, limit - 1).replace(/\s+\S*$/, "").trim();
  return `${clipped || plain.slice(0, limit - 1)}…`;
}
