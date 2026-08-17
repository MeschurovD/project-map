import type { EnrichmentTarget } from "../../../enrichmentTypes.js";
import {
  DOCS_VALUE_SUMMARY_LIMIT,
  DOCS_VALUE_MEANING_LIMIT,
  parseDocsV2BlockFragment,
  parseDocsV2File,
  valueMeaningTechnicalSignals,
  type DocsV2Block,
  type DocsV2BlockMetadata,
  type ParsedDocsV2File,
} from "./docsV2FileFormat.js";

export type DocsV2MergeScope =
  | { type: "annotation"; annotationIds: string[] }
  | {
      type: "target";
      target: EnrichmentTarget;
      createIfMissing?: boolean;
      ensureValueMeaning?: boolean;
      includeBusinessLogic?: boolean;
    };

export type DocsV2MergeResult = {
  content: string;
  parsed: ParsedDocsV2File;
  replacedAnnotationIds: string[];
};

const BUSINESS_LOGIC_KINDS = new Set([
  "business-rule",
  "role-rule",
  "gotcha",
  "open-question",
]);

/**
 * Merge regenerated blocks into an existing v2 document. Only the exact
 * source ranges of selected blocks are replaced; headings, prose and all
 * unrelated blocks remain byte-for-byte unchanged.
 */
export function mergeDocsV2Blocks(params: {
  content: string;
  fragment: string;
  scope: DocsV2MergeScope;
}): DocsV2MergeResult {
  const original = parseDocsV2File(params.content);
  if (!original) {
    fail("Исходный документ не использует формат project-map.docs/v2.");
  }
  assertNoErrors(original, "Исходный документ docs v2 невалиден");

  const replacement = parseDocsV2BlockFragment(params.fragment);
  assertNoErrors(replacement, "Сгенерированный docs-фрагмент невалиден");
  if (replacement.blocks.length === 0) {
    fail("Сгенерированный docs-фрагмент не содержит project-map:block.");
  }

  const selected = selectBlocks(original.blocks, params.scope);
  const hasValueMeaning = selected.some((block) => block.metadata.kind === "value-meaning");
  const appending =
    params.scope.type === "target" &&
    ((selected.length === 0 && params.scope.createIfMissing === true) ||
      (params.scope.ensureValueMeaning === true && !hasValueMeaning));
  if (selected.length === 0 && !appending) {
    fail("В документе не найдены annotations для выбранной области обновления.");
  }
  if (params.scope.type === "target") {
    const scopedTarget = params.scope.target;
    for (const block of replacement.blocks) {
      if (!block.metadata.targets.some((target) =>
        sameTarget(target, scopedTarget)
      )) {
        fail(
          `Annotation "${block.metadata.id}" не адресует выбранный target.`
        );
      }
    }
  }
  for (const block of replacement.blocks) {
    if (block.metadata.kind === "value-meaning" && !block.metadata.summary) {
      fail(`Value-meaning "${block.metadata.id}" не содержит metadata summary.`);
    }
    if (block.metadata.kind === "value-meaning" && !block.metadata.valueCategory) {
      fail(`Value-meaning "${block.metadata.id}" не содержит metadata valueCategory.`);
    }
    if (
      block.metadata.kind === "value-meaning" &&
      block.metadata.summary &&
      block.metadata.summary.length > DOCS_VALUE_SUMMARY_LIMIT
    ) {
      fail(`Value-meaning "${block.metadata.id}" содержит summary длиннее ${DOCS_VALUE_SUMMARY_LIMIT} символов.`);
    }
    if (
      block.metadata.kind === "value-meaning" &&
      block.markdown.length > DOCS_VALUE_MEANING_LIMIT
    ) {
      fail(`Value-meaning "${block.metadata.id}" длиннее ${DOCS_VALUE_MEANING_LIMIT} символов.`);
    }
    const technicalSignals = valueMeaningTechnicalSignals(
      `${block.metadata.summary ?? ""}\n${block.markdown}`
    );
    if (block.metadata.kind === "value-meaning" && technicalSignals.length >= 2) {
      fail(
        `Value-meaning "${block.metadata.id}" пересказывает техническую трассировку: ` +
        `${technicalSignals.join(", ")}.`
      );
    }
  }

  const selectedIds = selected.map((block) => block.metadata.id);
  const originalIds = new Set(original.blocks.map((block) => block.metadata.id));
  const replacementExistingIds = replacement.blocks
    .filter((block) => originalIds.has(block.metadata.id))
    .map((block) => block.metadata.id);
  const newBlocks = replacement.blocks.filter((block) => !originalIds.has(block.metadata.id));
  const allowNewBusinessLogic = params.scope.type === "target" &&
    params.scope.includeBusinessLogic === true;
  const blocksToReplace = appending ? [] : selected;

  for (const block of newBlocks) {
    const ownerNodeId = original.frontmatter.owner;
    if (
      ownerNodeId &&
      !block.metadata.targets.some((target) =>
        target.type === "node" && target.id === ownerNodeId
      )
    ) {
      fail(`Новый annotation "${block.metadata.id}" не адресует owner node.`);
    }
  }

  if (appending) {
    if (replacementExistingIds.length > 0) {
      fail("Создание value documentation не должно изменять существующие annotations.");
    }
    const meanings = newBlocks.filter((block) => block.metadata.kind === "value-meaning");
    if (meanings.length !== 1) {
      fail("Создание value documentation должно вернуть ровно один value-meaning.");
    }
    for (const block of newBlocks) {
      if (
        block.metadata.kind !== "value-meaning" &&
        (!allowNewBusinessLogic || !BUSINESS_LOGIC_KINDS.has(block.metadata.kind))
      ) {
        fail(`Новый annotation kind "${block.metadata.kind}" не разрешён для value bundle.`);
      }
    }
  } else if (allowNewBusinessLogic) {
    assertSameIds(selectedIds, replacementExistingIds);
    for (const block of newBlocks) {
      if (!BUSINESS_LOGIC_KINDS.has(block.metadata.kind)) {
        fail(`Новый annotation kind "${block.metadata.kind}" не разрешён для business-logic bundle.`);
      }
    }
  } else {
    assertSameIds(selectedIds, replacement.blocks.map((block) => block.metadata.id));
  }
  const replacementById = new Map(
    replacement.blocks.map((block) => [block.metadata.id, block])
  );

  let content = params.content;
  if (!appending) {
    for (const block of [...blocksToReplace].sort((left, right) =>
      right.source.start - left.source.start
    )) {
      const next = replacementById.get(block.metadata.id);
      if (!next) fail(`Не найден replacement для annotation "${block.metadata.id}".`);
      content =
        content.slice(0, block.source.start) +
        serializeDocsV2Block(next) +
        content.slice(block.source.end);
    }
  }
  if (newBlocks.length > 0) {
    content = `${content.trimEnd()}\n\n${newBlocks.map(serializeDocsV2Block).join("\n\n")}\n`;
  }

  const parsed = parseDocsV2File(content);
  if (!parsed) fail("После merge документ перестал быть docs v2.");
  assertNoErrors(parsed, "Результат docs merge невалиден");
  assertUntouchedBlocksPreserved(
    params.content,
    original,
    content,
    parsed,
    new Set(blocksToReplace.map((block) => block.metadata.id))
  );

  return {
    content,
    parsed,
    replacedAnnotationIds: [
      ...blocksToReplace.map((block) => block.metadata.id),
      ...newBlocks.map((block) => block.metadata.id),
    ],
  };
}

export function serializeDocsV2Block(block: DocsV2Block): string {
  const metadata: DocsV2BlockMetadata = {
    ...block.metadata,
    review: "unreviewed",
  };
  return `<!-- project-map:block
${JSON.stringify(metadata, null, 2)}
-->
${block.markdown.trim()}
<!-- /project-map:block -->`;
}

function selectBlocks(
  blocks: DocsV2Block[],
  scope: DocsV2MergeScope
): DocsV2Block[] {
  if (scope.type === "annotation") {
    const ids = new Set(scope.annotationIds);
    if (ids.size === 0) fail("Annotation scope не содержит идентификаторов.");
    return blocks.filter((block) => ids.has(block.metadata.id));
  }
  return blocks.filter((block) =>
    block.metadata.targets.some((target) => sameTarget(target, scope.target))
  );
}

function assertSameIds(expected: string[], actual: string[]) {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const equal =
    expectedSet.size === actualSet.size &&
    [...expectedSet].every((id) => actualSet.has(id));
  if (!equal) {
    fail(
      `Состав annotations в partial regeneration изменился: ожидались ` +
      `${[...expectedSet].join(", ")}, получены ${[...actualSet].join(", ")}.`
    );
  }
}

function assertUntouchedBlocksPreserved(
  originalContent: string,
  original: ParsedDocsV2File,
  mergedContent: string,
  merged: ParsedDocsV2File,
  replacedIds: Set<string>
) {
  const mergedById = new Map(
    merged.blocks.map((block) => [block.metadata.id, block])
  );
  for (const block of original.blocks) {
    if (replacedIds.has(block.metadata.id)) continue;
    const next = mergedById.get(block.metadata.id);
    if (!next) {
      fail(`Незатронутая annotation "${block.metadata.id}" исчезла после merge.`);
    }
    const before = originalContent.slice(block.source.start, block.source.end);
    const after = mergedContent.slice(next.source.start, next.source.end);
    if (before !== after) {
      fail(`Незатронутая annotation "${block.metadata.id}" изменилась после merge.`);
    }
  }
}

function assertNoErrors(
  parsed: { diagnostics: Array<{ severity: string; message: string }> },
  prefix: string
) {
  const errors = parsed.diagnostics.filter((diagnostic) =>
    diagnostic.severity === "error"
  );
  if (errors.length > 0) {
    fail(`${prefix}: ${errors.map((diagnostic) => diagnostic.message).join(" ")}`);
  }
}

function sameTarget(left: EnrichmentTarget, right: EnrichmentTarget) {
  return left.type === right.type && left.id === right.id;
}

function fail(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 422 });
}
