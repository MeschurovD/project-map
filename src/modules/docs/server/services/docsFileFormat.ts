// Structured .docs.md format (docs/16): frontmatter + fixed sections per node
// type. The parser never trusts the generator — any field can be missing or
// malformed; files without frontmatter are treated as legacy, not as errors.

export const DOCS_SCHEMA_VERSION = 1;
export const DOCS_SUMMARY_LIMIT = 160;

/** Body a generator writes when a mandatory section has nothing to say. */
export const EMPTY_SECTION_TEXT = "Нет";

export type DocsFrontmatter = {
  node?: string;
  sourceHash?: string;
  generated?: string;
  schema?: number;
  reviewed?: boolean;
};

export type DocsSection = {
  title: string;
  /** Section body without the heading, trimmed. */
  markdown: string;
  /** True when the body is the explicit single-line "Нет". */
  empty: boolean;
};

export type DocsRule = {
  text: string;
  /** Identifier tags from the trailing [name, name] marker. */
  tags: string[];
};

export type ParsedDocsFile =
  | { kind: "legacy"; content: string }
  | {
      kind: "structured";
      frontmatter: DocsFrontmatter;
      sections: DocsSection[];
      summary: string | null;
      rules: DocsRule[];
      content: string;
    };

const SECTIONS_BY_NODE_TYPE: Record<string, readonly string[]> = {
  component: ["Summary", "Business rules", "Scenarios", "Gotchas", "Open questions"],
  hook: ["Summary", "Contract", "Business rules", "Gotchas", "Open questions"],
  page: ["Summary", "User flows", "Roles / permissions", "Gotchas", "Open questions"],
};

export function requiredSectionsFor(nodeType: string): readonly string[] {
  return SECTIONS_BY_NODE_TYPE[nodeType] ?? SECTIONS_BY_NODE_TYPE.component;
}

export function parseDocsFile(content: string): ParsedDocsFile {
  const frontmatter = parseFrontmatter(content);
  if (!frontmatter) return { kind: "legacy", content };

  const sections = parseSections(frontmatter.body);
  const summarySection = findSection(sections, "Summary");
  const rulesSection = findSection(sections, "Business rules");

  return {
    kind: "structured",
    frontmatter: frontmatter.fields,
    sections,
    summary: summarySection && !summarySection.empty ? summarySection.markdown : null,
    rules: rulesSection ? parseRules(rulesSection.markdown) : [],
    content,
  };
}

/**
 * Post-generation validation: required sections present, Summary within the
 * limit, frontmatter fields sane. Messages are in Russian because they feed
 * the corrective retry prompt of the (Russian-language) generator.
 */
export function validateDocsFile(parsed: ParsedDocsFile, params: { nodeId: string; nodeType: string }): string[] {
  if (parsed.kind === "legacy") {
    return ["Файл не начинается с frontmatter-блока `---` (node, sourceHash, generated, schema, reviewed)."];
  }

  const errors: string[] = [];
  const { frontmatter } = parsed;

  if (frontmatter.node !== params.nodeId) {
    errors.push(`Поле frontmatter "node" должно быть ровно "${params.nodeId}".`);
  }
  if (!frontmatter.sourceHash) {
    errors.push('Поле frontmatter "sourceHash" отсутствует или пустое.');
  }
  if (frontmatter.schema !== DOCS_SCHEMA_VERSION) {
    errors.push(`Поле frontmatter "schema" должно быть ${DOCS_SCHEMA_VERSION}.`);
  }

  for (const title of requiredSectionsFor(params.nodeType)) {
    if (!findSection(parsed.sections, title)) {
      errors.push(`Отсутствует обязательная секция "## ${title}". Если сказать нечего — секция с одной строкой "${EMPTY_SECTION_TEXT}".`);
    }
  }

  const summary = findSection(parsed.sections, "Summary");
  if (summary) {
    if (summary.empty || !summary.markdown) {
      errors.push('Секция "## Summary" не может быть пустой или "Нет".');
    } else if (summary.markdown.length > DOCS_SUMMARY_LIMIT) {
      errors.push(`Summary длиннее ${DOCS_SUMMARY_LIMIT} символов (сейчас ${summary.markdown.length}) — сократи до одного-двух коротких предложений.`);
    }
  }

  return errors;
}

/**
 * Set (or insert) the frontmatter `reviewed` flag without touching the rest of
 * the file — a targeted text edit, not a full re-serialization, so comments and
 * formatting in the body survive. Only valid on structured files.
 */
export function withReviewedFlag(content: string, reviewed: boolean): string {
  if (!content.startsWith("---")) {
    throw Object.assign(new Error("Docs file has no frontmatter to update"), { statusCode: 409 });
  }
  const end = content.indexOf("\n---", 3);
  if (end === -1) {
    throw Object.assign(new Error("Docs frontmatter is not terminated"), { statusCode: 409 });
  }

  const head = content.slice(0, end);
  const tail = content.slice(end);
  if (/^[ \t]*reviewed[ \t]*:/m.test(head)) {
    return head.replace(/^([ \t]*reviewed[ \t]*:).*$/m, `$1 ${reviewed}`) + tail;
  }
  return `${head}\nreviewed: ${reviewed}${tail}`;
}

/** Index "identifier -> rules" for attaching rules to data-flow trace steps. */
export function buildRuleTagIndex(parsed: ParsedDocsFile): Map<string, DocsRule[]> {
  const index = new Map<string, DocsRule[]>();
  if (parsed.kind === "legacy") return index;

  for (const rule of parsed.rules) {
    for (const tag of rule.tags) {
      const existing = index.get(tag);
      if (existing) {
        existing.push(rule);
      } else {
        index.set(tag, [rule]);
      }
    }
  }
  return index;
}

export function findSection(sections: DocsSection[], title: string): DocsSection | undefined {
  const normalized = title.toLowerCase();
  return sections.find((section) => section.title.toLowerCase() === normalized);
}

function parseFrontmatter(content: string): { fields: DocsFrontmatter; body: string } | null {
  if (!content.startsWith("---")) return null;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return null;

  const fields: DocsFrontmatter = {};
  for (const line of content.slice(3, end).split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    // Values may carry trailing comments (`sourceHash: a3f9c1  # hash`), but
    // a comment needs whitespace before "#" — node ids contain bare "#".
    const value = line.slice(colon + 1).replace(/\s+#.*$/, "").trim();
    if (!key || !value) continue;

    if (key === "node") fields.node = value;
    if (key === "sourceHash") fields.sourceHash = value;
    if (key === "generated") fields.generated = value;
    if (key === "schema") {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) fields.schema = parsed;
    }
    if (key === "reviewed") fields.reviewed = value === "true";
  }

  const bodyStart = content.indexOf("\n", end + 1);
  return { fields, body: bodyStart === -1 ? "" : content.slice(bodyStart + 1) };
}

function parseSections(body: string): DocsSection[] {
  const sections: DocsSection[] = [];
  let current: { title: string; lines: string[] } | null = null;

  for (const line of body.split("\n")) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      if (current) sections.push(finishSection(current));
      current = { title: heading[1], lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) sections.push(finishSection(current));

  return sections;
}

function finishSection(section: { title: string; lines: string[] }): DocsSection {
  const markdown = section.lines.join("\n").trim();
  return {
    title: section.title,
    markdown,
    empty: markdown.toLowerCase() === EMPTY_SECTION_TEXT.toLowerCase(),
  };
}

const RULE_TAGS_PATTERN = /\s*\[([^\]]+)\]\s*$/;

function parseRules(markdown: string): DocsRule[] {
  const rules: DocsRule[] = [];
  for (const line of markdown.split("\n")) {
    const item = /^[-*]\s+(.+)$/.exec(line.trim());
    if (!item) continue;

    const tagsMatch = RULE_TAGS_PATTERN.exec(item[1]);
    rules.push({
      text: item[1].replace(RULE_TAGS_PATTERN, "").trim(),
      tags: tagsMatch
        ? tagsMatch[1].split(",").map((tag) => tag.trim()).filter(Boolean)
        : [],
    });
  }
  return rules;
}
