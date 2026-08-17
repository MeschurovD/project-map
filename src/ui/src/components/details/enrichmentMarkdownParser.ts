// Renderer-agnostic parser for the small markdown subset enrichment sections
// carry (docs/16): paragraphs (Summary, Contract), bullet lists (Business
// rules, Scenarios, Gotchas, Open questions) and trailing identifier tags
// `[name, name]` on Business-rule items. Kept JSX-free so it can be unit-tested
// as a plain module; EnrichmentMarkdown.tsx turns the blocks into React.

export type InlineSpan =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "em"; text: string }
  | { kind: "code"; text: string };

export type ListItem = {
  spans: InlineSpan[];
  /** Identifier tags from the trailing [name, name] marker; semantic markers
   * the data-flow trace will later use to attach a rule to a step. */
  tags: string[];
};

export type EnrichmentBlock =
  | { type: "paragraph"; spans: InlineSpan[] }
  | { type: "list"; items: ListItem[] };

const BULLET = /^[-*]\s+(.+)$/;
const TRAILING_TAGS = /\s*\[([^\]]+)\]\s*$/;
const INLINE = /\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*|_([^_]+)_/g;

export function parseEnrichmentMarkdown(markdown: string): EnrichmentBlock[] {
  const blocks: EnrichmentBlock[] = [];
  let listItems: ListItem[] | null = null;
  let paragraph: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph && paragraph.length > 0) {
      blocks.push({ type: "paragraph", spans: parseInline(paragraph.join(" ")) });
    }
    paragraph = null;
  };
  const flushList = () => {
    if (listItems && listItems.length > 0) blocks.push({ type: "list", items: listItems });
    listItems = null;
  };

  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    const bullet = BULLET.exec(line);
    if (bullet) {
      flushParagraph();
      (listItems ??= []).push(parseListItem(bullet[1]));
      continue;
    }
    flushList();
    if (line === "") {
      flushParagraph();
      continue;
    }
    (paragraph ??= []).push(line);
  }

  flushParagraph();
  flushList();
  return blocks;
}

function parseListItem(text: string): ListItem {
  const tagsMatch = TRAILING_TAGS.exec(text);
  return {
    spans: parseInline(text.replace(TRAILING_TAGS, "").trim()),
    tags: tagsMatch ? tagsMatch[1].split(",").map((tag) => tag.trim()).filter(Boolean) : [],
  };
}

function parseInline(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  let last = 0;
  INLINE.lastIndex = 0;
  for (let match = INLINE.exec(text); match; match = INLINE.exec(text)) {
    if (match.index > last) spans.push({ kind: "text", text: text.slice(last, match.index) });
    if (match[1] !== undefined) spans.push({ kind: "strong", text: match[1] });
    else if (match[2] !== undefined) spans.push({ kind: "code", text: match[2] });
    else spans.push({ kind: "em", text: (match[3] ?? match[4]) as string });
    last = match.index + match[0].length;
  }
  if (last < text.length) spans.push({ kind: "text", text: text.slice(last) });
  return spans;
}
