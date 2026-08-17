import type {
  EnrichmentTarget,
  EnrichmentValueCategory,
} from "../../../enrichmentTypes.js";
import { DOCS_SUMMARY_LIMIT } from "./docsFileFormat.js";

export const DOCS_V2_SCHEMA = "project-map.docs/v2";
export const DOCS_VALUE_SUMMARY_LIMIT = 200;
export const DOCS_VALUE_MEANING_LIMIT = 900;

export type DocsV2Review = "unreviewed" | "reviewed";

export type DocsV2Source = {
  path: string;
  hash: `sha256:${string}`;
};

export type DocsV2Frontmatter = {
  schema: typeof DOCS_V2_SCHEMA;
  owner?: string;
  generatedAt?: string;
  review?: DocsV2Review;
  graphSchema?: string;
  flowSchema?: string;
  sources?: DocsV2Source[];
};

export type DocsV2BlockMetadata = {
  id: string;
  kind: string;
  targets: EnrichmentTarget[];
  summary?: string;
  valueCategory?: EnrichmentValueCategory;
  confidence?: "high" | "medium" | "low";
  review?: DocsV2Review;
};

export type DocsV2Block = {
  metadata: DocsV2BlockMetadata;
  markdown: string;
  source: {
    start: number;
    end: number;
  };
};

export type DocsV2Diagnostic = {
  severity: "error" | "warning";
  code: string;
  message: string;
  blockId?: string;
};

export type ParsedDocsV2File = {
  kind: "structured-v2";
  frontmatter: DocsV2Frontmatter;
  blocks: DocsV2Block[];
  diagnostics: DocsV2Diagnostic[];
  content: string;
};

export type ParsedDocsV2BlockFragment = {
  blocks: DocsV2Block[];
  diagnostics: DocsV2Diagnostic[];
  content: string;
};

const BLOCK_OPEN = "<!-- project-map:block";
const BLOCK_CLOSE = "<!-- /project-map:block -->";
const TARGET_TYPES = new Set<EnrichmentTarget["type"]>([
  "node",
  "flow-node",
  "occurrence",
]);
const CONFIDENCE_VALUES = new Set(["high", "medium", "low"]);
const VALUE_CATEGORIES = new Set<EnrichmentValueCategory>([
  "domain-data",
  "decision",
  "ui-state",
  "user-input",
  "handler",
  "technical",
]);

/**
 * Parse docs v2 without interpreting presentation headings. Returns null for
 * legacy/v1 files, allowing callers to keep the existing reader unchanged.
 */
export function parseDocsV2File(content: string): ParsedDocsV2File | null {
  const parsedFrontmatter = parseFrontmatter(content);
  if (!parsedFrontmatter || parsedFrontmatter.fields.schema !== DOCS_V2_SCHEMA) {
    return null;
  }

  const fragment = parseBlockContent(
    parsedFrontmatter.body,
    parsedFrontmatter.frontmatterEnd
  );
  validateDocument(
    parsedFrontmatter.fields,
    fragment.blocks,
    fragment.diagnostics
  );

  return {
    kind: "structured-v2",
    frontmatter: parsedFrontmatter.fields,
    blocks: fragment.blocks,
    diagnostics: fragment.diagnostics,
    content,
  };
}

/**
 * Parse one or more standalone machine-addressable blocks produced for a
 * partial regeneration. Presentation headings around them are allowed.
 */
export function parseDocsV2BlockFragment(
  content: string
): ParsedDocsV2BlockFragment {
  const parsed = parseBlockContent(content, 0);
  return { ...parsed, content };
}

function parseBlockContent(
  content: string,
  sourceOffset: number
): Pick<ParsedDocsV2BlockFragment, "blocks" | "diagnostics"> {
  const diagnostics: DocsV2Diagnostic[] = [];
  const blocks: DocsV2Block[] = [];
  const seenIds = new Set<string>();
  let cursor = 0;

  while (cursor < content.length) {
    const open = content.indexOf(BLOCK_OPEN, cursor);
    const strayClose = content.indexOf(BLOCK_CLOSE, cursor);
    if (strayClose !== -1 && (open === -1 || strayClose < open)) {
      diagnostics.push({
        severity: "error",
        code: "unexpected-block-close",
        message: "Закрывающий marker docs-блока найден без открывающего marker.",
      });
      cursor = strayClose + BLOCK_CLOSE.length;
      continue;
    }
    if (open === -1) break;

    const metadataEnd = content.indexOf("-->", open + BLOCK_OPEN.length);
    if (metadataEnd === -1) {
      diagnostics.push({
        severity: "error",
        code: "unterminated-block-metadata",
        message: "Metadata docs-блока не закрыта marker `-->`.",
      });
      break;
    }

    const close = content.indexOf(BLOCK_CLOSE, metadataEnd + 3);
    if (close === -1) {
      diagnostics.push({
        severity: "error",
        code: "unterminated-block",
        message: "Docs-блок не закрыт marker `<!-- /project-map:block -->`.",
      });
      break;
    }

    const nestedOpen = content.indexOf(BLOCK_OPEN, metadataEnd + 3);
    if (nestedOpen !== -1 && nestedOpen < close) {
      diagnostics.push({
        severity: "error",
        code: "nested-block",
        message: "Вложенные project-map:block запрещены.",
      });
      cursor = close + BLOCK_CLOSE.length;
      continue;
    }

    const rawMetadata = content
      .slice(open + BLOCK_OPEN.length, metadataEnd)
      .trim();
    const markdown = content.slice(metadataEnd + 3, close).trim();
    const metadata = parseBlockMetadata(rawMetadata, diagnostics);
    const end = close + BLOCK_CLOSE.length;
    cursor = end;
    if (!metadata) continue;

    if (seenIds.has(metadata.id)) {
      diagnostics.push({
        severity: "error",
        code: "duplicate-block-id",
        blockId: metadata.id,
        message: `Block id "${metadata.id}" повторяется в документе.`,
      });
      continue;
    }
    seenIds.add(metadata.id);

    if (!markdown) {
      diagnostics.push({
        severity: "error",
        code: "empty-block",
        blockId: metadata.id,
        message: `Docs-блок "${metadata.id}" не содержит Markdown.`,
      });
      continue;
    }
    blocks.push({
      metadata,
      markdown,
      source: {
        start: sourceOffset + open,
        end: sourceOffset + end,
      },
    });
  }

  return { blocks, diagnostics };
}

export function validateDocsV2File(parsed: ParsedDocsV2File): DocsV2Diagnostic[] {
  return parsed.diagnostics;
}

export function withV2ReviewStatus(content: string, reviewed: boolean): string {
  const parsed = parseFrontmatter(content);
  if (!parsed || parsed.fields.schema !== DOCS_V2_SCHEMA) {
    throw Object.assign(new Error("Docs file is not project-map.docs/v2"), {
      statusCode: 409,
    });
  }

  const value = reviewed ? "reviewed" : "unreviewed";
  const head = content.slice(0, parsed.frontmatterEnd);
  const tail = content.slice(parsed.frontmatterEnd);
  if (/^[ \t]*review[ \t]*:/m.test(head)) {
    return head.replace(/^([ \t]*review[ \t]*:).*$/m, `$1 ${value}`) + tail;
  }
  const closingFence = head.lastIndexOf("\n---");
  return `${head.slice(0, closingFence)}\nreview: ${value}${head.slice(closingFence)}${tail}`;
}

export function isV2FullyReviewed(parsed: ParsedDocsV2File) {
  return parsed.blocks.length > 0 && parsed.blocks.every((block) =>
    (block.metadata.review ?? parsed.frontmatter.review) === "reviewed"
  );
}

/**
 * Update review metadata only inside selected block comments. Markdown and
 * every unrelated byte remain untouched; file-level review is then derived
 * from the effective state of all blocks.
 */
export function withV2BlockReviewStatus(
  content: string,
  annotationIds: string[],
  reviewed: boolean
): string {
  const parsed = parseDocsV2File(content);
  if (!parsed) {
    throw Object.assign(new Error("Docs file is not project-map.docs/v2"), {
      statusCode: 409,
    });
  }
  const requested = new Set(annotationIds);
  const known = new Set(parsed.blocks.map((block) => block.metadata.id));
  const missing = [...requested].filter((id) => !known.has(id));
  if (requested.size === 0 || missing.length > 0) {
    throw Object.assign(
      new Error(`Не найдены docs annotations: ${missing.join(", ") || "пустой список"}`),
      { statusCode: 422 }
    );
  }

  let updated = content;
  for (const block of [...parsed.blocks]
    .filter((entry) => requested.has(entry.metadata.id))
    .sort((left, right) => right.source.start - left.source.start)) {
    const raw = updated.slice(block.source.start, block.source.end);
    const metadataStart = raw.indexOf(BLOCK_OPEN) + BLOCK_OPEN.length;
    const metadataEnd = raw.indexOf("-->", metadataStart);
    const metadata = {
      ...block.metadata,
      review: reviewed ? "reviewed" : "unreviewed",
    };
    const nextRaw =
      raw.slice(0, metadataStart) +
      `\n${JSON.stringify(metadata, null, 2)}\n` +
      raw.slice(metadataEnd);
    updated =
      updated.slice(0, block.source.start) +
      nextRaw +
      updated.slice(block.source.end);
  }

  const next = parseDocsV2File(updated);
  if (!next) throw new Error("Docs v2 review update produced invalid content.");
  return withV2ReviewStatus(updated, isV2FullyReviewed(next));
}

/** Replace only the generated source manifest and timestamp in frontmatter. */
export function withV2SourceManifest(
  content: string,
  sources: DocsV2Source[],
  generatedAt = new Date().toISOString()
): string {
  const parsed = parseFrontmatter(content);
  if (!parsed || parsed.fields.schema !== DOCS_V2_SCHEMA) {
    throw Object.assign(new Error("Docs file is not project-map.docs/v2"), {
      statusCode: 409,
    });
  }

  const frontmatter = content.slice(0, parsed.frontmatterEnd);
  const body = content.slice(parsed.frontmatterEnd);
  const lines = frontmatter.replace(/\n$/, "").split("\n");
  replaceScalarLine(lines, "generatedAt", generatedAt);

  const sourceIndex = lines.findIndex((line) => /^sources\s*:/.test(line));
  if (sourceIndex !== -1) {
    let end = sourceIndex + 1;
    while (end < lines.length && /^\s/.test(lines[end]!)) end += 1;
    lines.splice(sourceIndex, end - sourceIndex);
  }
  const closingFence = lines.lastIndexOf("---");
  lines.splice(closingFence, 0, ...serializeSources(sources));
  return `${lines.join("\n")}\n${body}`;
}

function parseFrontmatter(content: string): {
  fields: DocsV2Frontmatter;
  body: string;
  frontmatterEnd: number;
} | null {
  if (!content.startsWith("---")) return null;
  const closingFence = content.indexOf("\n---", 3);
  if (closingFence === -1) return null;
  const bodyStart = content.indexOf("\n", closingFence + 1);
  const fields = {} as DocsV2Frontmatter;
  const lines = content.slice(3, closingFence).split("\n");
  const sources: DocsV2Source[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (/^\s/.test(line)) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).replace(/\s+#.*$/, "").trim();
    if (key === "sources") {
      for (let sourceIndex = index + 1; sourceIndex < lines.length; sourceIndex += 1) {
        const sourceLine = lines[sourceIndex]!;
        if (!/^\s/.test(sourceLine)) break;
        const pathMatch = /^\s*-\s+path\s*:\s*(.+?)\s*$/.exec(sourceLine);
        if (!pathMatch) continue;
        const hashLine = lines[sourceIndex + 1] ?? "";
        const hashMatch = /^\s+hash\s*:\s*(sha256:[a-f0-9]{64})\s*$/i.exec(hashLine);
        const sourcePath = parseYamlScalar(pathMatch[1]!);
        if (sourcePath && hashMatch) {
          sources.push({
            path: sourcePath,
            hash: hashMatch[1]!.toLowerCase() as DocsV2Source["hash"],
          });
          sourceIndex += 1;
        }
      }
      continue;
    }
    if (!value) continue;

    if (key === "schema") fields.schema = value as typeof DOCS_V2_SCHEMA;
    if (key === "owner") fields.owner = value;
    if (key === "generatedAt") fields.generatedAt = value;
    if (key === "review" && (value === "reviewed" || value === "unreviewed")) {
      fields.review = value;
    }
    if (key === "graphSchema") fields.graphSchema = value;
    if (key === "flowSchema") fields.flowSchema = value;
  }
  if (sources.length > 0) fields.sources = sources;

  return {
    fields,
    body: bodyStart === -1 ? "" : content.slice(bodyStart + 1),
    frontmatterEnd: bodyStart === -1 ? content.length : bodyStart + 1,
  };
}

function serializeSources(sources: DocsV2Source[]) {
  return [
    "sources:",
    ...sources.flatMap((source) => [
      `  - path: ${JSON.stringify(source.path)}`,
      `    hash: ${source.hash}`,
    ]),
  ];
}

function replaceScalarLine(lines: string[], key: string, value: string) {
  const index = lines.findIndex((line) => new RegExp(`^${key}\\s*:`).test(line));
  if (index !== -1) {
    lines[index] = `${key}: ${value}`;
    return;
  }
  lines.splice(lines.lastIndexOf("---"), 0, `${key}: ${value}`);
}

function parseYamlScalar(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed);
      return typeof parsed === "string" ? parsed : "";
    } catch {
      return "";
    }
  }
  return trimmed.replace(/\s+#.*$/, "");
}

function parseBlockMetadata(
  raw: string,
  diagnostics: DocsV2Diagnostic[]
): DocsV2BlockMetadata | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    diagnostics.push({
      severity: "error",
      code: "invalid-block-json",
      message: `Metadata docs-блока не является валидным JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
    return null;
  }

  if (!isRecord(value)) {
    diagnostics.push({
      severity: "error",
      code: "invalid-block-metadata",
      message: "Metadata docs-блока должна быть JSON-объектом.",
    });
    return null;
  }

  const id = typeof value.id === "string" ? value.id.trim() : "";
  const kind = typeof value.kind === "string" ? value.kind.trim() : "";
  if (!id || !kind) {
    diagnostics.push({
      severity: "error",
      code: "missing-block-identity",
      message: "Docs-блок обязан содержать непустые `id` и `kind`.",
      blockId: id || undefined,
    });
    return null;
  }

  const targets = Array.isArray(value.targets)
    ? value.targets.flatMap((target) => parseTarget(target, id, diagnostics))
    : [];
  if (targets.length === 0) {
    diagnostics.push({
      severity: "error",
      code: "missing-block-target",
      blockId: id,
      message: `Docs-блок "${id}" не содержит корректных targets.`,
    });
    return null;
  }

  const confidence = typeof value.confidence === "string" &&
    CONFIDENCE_VALUES.has(value.confidence)
    ? value.confidence as DocsV2BlockMetadata["confidence"]
    : undefined;
  const review = value.review === "reviewed" || value.review === "unreviewed"
    ? value.review
    : undefined;
  const summary = typeof value.summary === "string" && value.summary.trim()
    ? value.summary.trim()
    : undefined;
  if (value.summary !== undefined && !summary) {
    diagnostics.push({
      severity: "warning",
      code: "invalid-value-summary",
      blockId: id,
      message: `Поле summary блока "${id}" должно быть непустой строкой.`,
    });
  }
  const valueCategory = typeof value.valueCategory === "string" &&
    VALUE_CATEGORIES.has(value.valueCategory as EnrichmentValueCategory)
    ? value.valueCategory as EnrichmentValueCategory
    : undefined;
  if (value.valueCategory !== undefined && !valueCategory) {
    diagnostics.push({
      severity: "warning",
      code: "invalid-value-category",
      blockId: id,
      message: `Value-meaning "${id}" содержит неизвестную valueCategory.`,
    });
  }

  return { id, kind, targets, summary, valueCategory, confidence, review };
}

function parseTarget(
  value: unknown,
  blockId: string,
  diagnostics: DocsV2Diagnostic[]
): EnrichmentTarget[] {
  if (
    !isRecord(value) ||
    typeof value.type !== "string" ||
    !TARGET_TYPES.has(value.type as EnrichmentTarget["type"]) ||
    typeof value.id !== "string" ||
    !value.id.trim()
  ) {
    diagnostics.push({
      severity: "error",
      code: "invalid-block-target",
      blockId,
      message: `Docs-блок "${blockId}" содержит некорректный target.`,
    });
    return [];
  }
  return [{
    type: value.type as EnrichmentTarget["type"],
    id: value.id.trim(),
  } as EnrichmentTarget];
}

function validateDocument(
  frontmatter: DocsV2Frontmatter,
  blocks: DocsV2Block[],
  diagnostics: DocsV2Diagnostic[]
) {
  if (!frontmatter.owner) {
    diagnostics.push({
      severity: "error",
      code: "missing-owner",
      message: "Frontmatter docs v2 обязан содержать canonical `owner`.",
    });
  }

  const summaries = blocks.filter((block) => block.metadata.kind === "summary");
  if (summaries.length === 0) {
    diagnostics.push({
      severity: "error",
      code: "missing-summary",
      message: "Документ docs v2 обязан содержать блок `summary`.",
    });
  }
  for (const summary of summaries) {
    if (summary.markdown.length > DOCS_SUMMARY_LIMIT) {
      diagnostics.push({
        severity: "error",
        code: "summary-too-long",
        blockId: summary.metadata.id,
        message: `Summary длиннее ${DOCS_SUMMARY_LIMIT} символов.`,
      });
    }
  }
  for (const block of blocks.filter((entry) => entry.metadata.kind === "value-meaning")) {
    if (!block.metadata.summary) {
      diagnostics.push({
        severity: "warning",
        code: "missing-value-summary",
        blockId: block.metadata.id,
        message: `Value-meaning "${block.metadata.id}" не содержит краткое поле summary.`,
      });
    } else if (block.metadata.summary.length > DOCS_VALUE_SUMMARY_LIMIT) {
      diagnostics.push({
        severity: "warning",
        code: "value-summary-too-long",
        blockId: block.metadata.id,
        message: `Value summary длиннее ${DOCS_VALUE_SUMMARY_LIMIT} символов.`,
      });
    }
    if (!block.metadata.valueCategory) {
      diagnostics.push({
        severity: "warning",
        code: "missing-value-category",
        blockId: block.metadata.id,
        message: `Value-meaning "${block.metadata.id}" не содержит valueCategory.`,
      });
    }
    if (block.markdown.length > DOCS_VALUE_MEANING_LIMIT) {
      diagnostics.push({
        severity: "warning",
        code: "value-meaning-too-long",
        blockId: block.metadata.id,
        message: `Value-meaning длиннее ${DOCS_VALUE_MEANING_LIMIT} символов.`,
      });
    }
    const technicalSignals = valueMeaningTechnicalSignals(
      `${block.metadata.summary ?? ""}\n${block.markdown}`
    );
    if (technicalSignals.length >= 2) {
      diagnostics.push({
        severity: "warning",
        code: "value-meaning-technical-narration",
        blockId: block.metadata.id,
        message: `Value-meaning пересказывает техническую трассировку: ${technicalSignals.join(", ")}.`,
      });
    }
  }
}

export function valueMeaningTechnicalSignals(markdown: string) {
  const normalized = markdown.toLowerCase();
  return [
    ["canonical/flow id", /canonical\s+id|flow[- ]?node|component-value:|hook-return:|selector-result:/],
    ["analysis metrics", /origin\s*=|continuation\s*=|completeness\s*=|confidence\s*=/],
    ["store/state path", /\bstore\b|\bstate\.[a-z0-9_.]+/],
    ["selector", /\bselector\b|\bselect[a-z0-9_]+/],
    ["route narration", /бер[её]тся\s+из|возвращается\s+(?:из|хуком)|переда[её]тся\s+(?:в|как)|downstream|upstream/],
  ].flatMap(([label, pattern]) => (pattern as RegExp).test(normalized) ? [label as string] : []);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
