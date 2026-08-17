import type { ProjectMapNode } from "../../../../graph/types.js";
import { FLOW_SCHEMA_VERSION } from "../../../../flow/types.js";
import {
  DOCS_SUMMARY_LIMIT,
  EMPTY_SECTION_TEXT,
  requiredSectionsFor,
} from "./docsFileFormat.js";
import type { DocsContextItem, DocsPromptMode } from "./docsTypes.js";
import type { DocsGenerationScope } from "./docsTypes.js";
import {
  DOCS_V2_SCHEMA,
  DOCS_VALUE_MEANING_LIMIT,
  DOCS_VALUE_SUMMARY_LIMIT,
  parseDocsV2File,
  type DocsV2BlockMetadata,
  type DocsV2Source,
} from "./docsV2FileFormat.js";

export const DOCS_PARTIAL_OUTPUT_TOKEN = "{{PROJECT_MAP_DOCS_OUTPUT_PATH}}";

// The prompt enforces the addressable v2 format from docs/26: the graph answers
// "what", the docs answer "why". The AI must not restate graph-derivable
// facts (composition, selectors, links) — only intent, rules, scenarios.

export async function buildDocsPrompt(params: {
  node: ProjectMapNode;
  docsPath: string;
  mode: DocsPromptMode;
  userComment?: string;
  selectedContext: DocsContextItem[];
  sourceManifest: DocsV2Source[];
  existingDocs?: string;
  graphSummary?: string;
  valueFlowSummary?: string;
}): Promise<string> {
  const contextFiles = contextFilesBlock(params.selectedContext);
  const generatedAt = new Date().toISOString();

  return `# Задача

Напиши структурированную документацию для элемента React/FSD/Redux-проекта.

## Документируемый элемент

- Тип: ${params.node.type}
- Имя: ${params.node.name}
- Файл: ${params.node.file ?? "нет"}
- Файл документации: ${params.docsPath}

## Принцип

Граф проекта уже знает «что»: состав, селекторы, dispatch-вызовы, связи,
потоки данных. НЕ пересказывай это. Документируй только то, что из структуры
кода не выводится: намерение, бизнес-правила, сценарии, подводные камни.
Не перечисляй селекторы, компоненты и связи — объясняй, зачем они и какие
правила реализуют.

## Жёсткие требования

1. Создай или обнови только файл документации: ${params.docsPath}. Не изменяй другие файлы и исходный код.
2. Пиши на русском языке.
3. Не выдумывай поведение: опирайся только на граф-контекст и файлы проекта, которые откроешь сам.
4. Файл начинается ровно с этого frontmatter-блока (скопируй без изменений):

\`\`\`
---
schema: ${DOCS_V2_SCHEMA}
owner: ${params.node.id}
generatedAt: ${generatedAt}
review: unreviewed
graphSchema: 1.1.0
flowSchema: ${FLOW_SCHEMA_VERSION}
${sourceManifestYaml(params.sourceManifest)}
---
\`\`\`

5. После frontmatter используй обычные Markdown-заголовки, но каждое
   утверждение, которое UI должен адресно показать или обновить, обязательно
   заключай в markers \`project-map:block\`.
6. Metadata marker — валидный JSON с уникальным стабильным \`id\`, смысловым
   \`kind\` и непустым \`targets\`. Для этой генерации каждый блок обязан иметь
   target \`{"type":"node","id":"${params.node.id}"}\`.
7. Сгенерируй следующие блоки в указанном порядке:

${v2BlocksTemplate(params.node)}

8. Блок обязателен даже если сказать нечего — тогда его Markdown одна строка
   «${EMPTY_SECTION_TEXT}». Summary и Open questions пустыми быть не могут.
9. Summary — одно-два предложения, не длиннее ${DOCS_SUMMARY_LIMIT} символов:
   это подпись на карточке узла.
10. Не добавляй сгенерированные факты вне machine-addressable блоков. Вне них
    допустимы только заголовки и навигационный текст.
11. Open questions — честность: что нельзя уверенно понять из кода. Не пиши
    туда то, что просто не проверил.
12. Используй canonical flow-node targets из Value-flow summary. Если правило
    непосредственно определяет смысл, доступность, видимость или поведение
    конкретного значения, добавь его точный target в metadata блока
    business-rule, role-rule или gotcha вместе с owner node target.
13. Для значимых selector results, hook returns, props, component values и
    UI-effects создавай отдельные блоки value-meaning с их точным flow-node
    target. Для каждого сначала выбери metadata \`valueCategory\` по инструкции
    ниже, затем добавь plain-text \`summary\`: одно предложение до
    ${DOCS_VALUE_SUMMARY_LIMIT} символов о предметной роли или наблюдаемом
    поведении. Markdown — 2–4 коротких предложения до
    ${DOCS_VALUE_MEANING_LIMIT} символов только о смысле, поведении и границах
    влияния. Условия и ограничения с самостоятельным смыслом выноси в отдельные
    business-rule/role-rule/gotcha blocks. Если правило относится к нескольким
    values, используй один block со всеми точными targets. Не создавай
    value-meaning для механических промежуточных значений.
14. Никогда не придумывай target id и не сопоставляй значения только по имени:
    разрешены лишь canonical id, дословно присутствующие в Value-flow summary.

${valueMeaningPolicy()}

${params.mode === "migrate" ? `## Режим миграции v1 → v2

Это явная миграция structured docs v1 в owner-specific docs v2. Используй
старый документ как источник подтверждённых бизнес-смыслов, но преобразуй
sections в typed blocks. Не изменяй и не удаляй исходный v1-файл: новый
результат записывается только в \`${params.docsPath}\`.
` : ""}
${params.mode !== "create" && params.existingDocs ? `## Текущая документация

Ниже текущая документация. Перепиши её в требуемый формат с учётом актуального кода${params.userComment?.trim() ? " и комментария пользователя" : ""}; сохрани верные утверждения, убери пересказ структуры.

\`\`\`md
${params.existingDocs}
\`\`\`
` : ""}
${params.userComment?.trim() ? `## Комментарий пользователя

${params.userComment.trim()}
` : ""}
## Граф-контекст (источник знаний, не план пересказа)

${params.graphSummary ?? "Граф-контекст не передан."}

## Value-flow summary

${params.valueFlowSummary ?? "Value-flow summary не передан."}

## Контекстные файлы

Открой эти файлы при необходимости. Их содержимое намеренно не включено в промпт.

${contextFiles}
`;
}

export function buildDocsPartialPrompt(params: {
  node: ProjectMapNode;
  docsPath: string;
  scope: Exclude<DocsGenerationScope, { type: "document" }>;
  userComment?: string;
  selectedContext: DocsContextItem[];
  existingDocs: string;
  graphSummary?: string;
  valueFlowSummary?: string;
  suggestedValueCategory?: DocsV2BlockMetadata["valueCategory"];
}): string {
  const parsed = parseDocsV2File(params.existingDocs);
  if (!parsed) {
    throw Object.assign(new Error("Partial regeneration доступна только для docs v2."), {
      statusCode: 409,
    });
  }
  const scopedTarget = params.scope.type === "target"
    ? params.scope.target
    : undefined;
  const selected = parsed.blocks.filter((block) => {
    if (params.scope.type === "annotation") {
      return params.scope.annotationIds.includes(block.metadata.id);
    }
    if (!scopedTarget) return false;
    const targetType = scopedTarget.type;
    const targetId = scopedTarget.id;
    return block.metadata.targets.some((target) =>
      target.type === targetType &&
      target.id === targetId
    );
  });
  const hasValueMeaning = selected.some((block) => block.metadata.kind === "value-meaning");
  const creating =
    params.scope.type === "target" &&
    ((selected.length === 0 && params.scope.createIfMissing === true) ||
      (params.scope.ensureValueMeaning === true && !hasValueMeaning));
  if (selected.length === 0 && !creating) {
    throw Object.assign(new Error("В документе нет annotations для выбранного scope."), {
      statusCode: 422,
    });
  }

  const newBlockId = creating && scopedTarget
    ? availableValueBlockId(scopedTarget.id, parsed.blocks.map((block) => block.metadata.id))
    : undefined;
  const selectedBlocks = selected
    .map((block) => params.existingDocs.slice(block.source.start, block.source.end))
    .join("\n\n");
  const currentBlocks = creating && scopedTarget && newBlockId
    ? `Value-meaning ещё не существует. Создай этот обязательный fragment:

<!-- project-map:block
${JSON.stringify({
  id: newBlockId,
  kind: "value-meaning",
  summary: "<Одно предложение о бизнес-роли значения>",
  valueCategory: params.suggestedValueCategory ?? "domain-data",
  targets: [
    { type: "node", id: params.node.id },
    scopedTarget,
  ],
}, null, 2)}
-->
<Опиши в 2–4 предложениях наблюдаемое поведение и границы влияния без пересказа трассировки>
<!-- /project-map:block -->${selectedBlocks
  ? `\n\nУже существующие связанные blocks приведены только как контекст. Не возвращай и не изменяй их:\n\n${selectedBlocks}`
  : ""}`
    : selectedBlocks;
  const businessLogicRule = params.scope.type === "target" && params.scope.includeBusinessLogic
    ? `Можешь дополнительно вернуть ноль или несколько НОВЫХ blocks kind business-rule, role-rule, gotcha или open-question. Создавай их только для доказанных кодом самостоятельных условий, ограничений, решений или рисков — не дублируй value-meaning и существующие rules. Каждый новый block обязан иметь уникальный id, отсутствующий среди: ${parsed.blocks.map((block) => block.metadata.id).join(", ")}, а также targets owner node и ${JSON.stringify(params.scope.target)}. Если одно правило доказанно относится к нескольким values, добавь в один block все их точные canonical flow-node targets из Value-flow summary вместо копирования правила в несколько blocks.`
    : "Не добавляй новые annotations.";
  const targetRule = params.scope.type === "target"
    ? creating
      ? `Создай ровно один обязательный block id \`${newBlockId}\` kind \`value-meaning\`; сохрани targets owner node и ${JSON.stringify(params.scope.target)}. ${businessLogicRule}`
      : `Верни все существующие block id без удаления: ${selected.map((block) => block.metadata.id).join(", ")}. Каждый блок обязан сохранить target ${JSON.stringify(params.scope.target)}. ${businessLogicRule}`
    : "Сохрани тот же набор block id без добавления и удаления annotations.";

  return `# Частичная перегенерация документации

Обнови только выбранные machine-addressable blocks документа
\`${params.docsPath}\` для узла \`${params.node.id}\`.

## Жёсткие требования

1. Запиши результат только в \`${DOCS_PARTIAL_OUTPUT_TOKEN}\`.
2. Результат — только project-map:block fragments без frontmatter и без
   Markdown вне markers.
3. ${creating
  ? `Создай block id: ${newBlockId}.`
  : `Сохрани block id: ${selected.map((block) => block.metadata.id).join(", ")}.`}
4. ${targetRule}
5. Не изменяй исходный документ напрямую: validated merge выполнит сервер.
6. Пиши по-русски, не выдумывай поведение и учитывай уточнение пользователя.
7. Каждый возвращаемый value-meaning обязан иметь metadata \`summary\`: одно
   plain-text предложение до ${DOCS_VALUE_SUMMARY_LIMIT} символов, и metadata
   \`valueCategory\`. Markdown — 2–4 предложения до
   ${DOCS_VALUE_MEANING_LIMIT} символов о смысле, наблюдаемом поведении и
   границах влияния; он не должен повторять summary.

${valueMeaningPolicy(params.suggestedValueCategory)}

## Текущие blocks

\`\`\`md
${currentBlocks}
\`\`\`

${params.userComment?.trim() ? `## Уточнение пользователя

${params.userComment.trim()}
` : ""}
## Граф-контекст

${params.graphSummary ?? "Граф-контекст не передан."}

## Value-flow summary

${params.valueFlowSummary ?? "Value-flow summary не передан."}

## Контекстные файлы

${contextFilesBlock(params.selectedContext)}
`;
}

function valueMeaningPolicy(suggested?: DocsV2BlockMetadata["valueCategory"]) {
  return `## Политика value-meaning

Value-flow summary ниже служит только доказательством и источником точных
targets. НЕ пересказывай его в документации и не доказывай полноту анализа.
${suggested ? `Предварительная категория анализатора: \`${suggested}\`. Проверь её по коду и измени только при явном основании.` : ""}

Выбери ровно одну metadata \`valueCategory\`:
- \`domain-data\` — предметная сущность или её содержательные данные;
- \`decision\` — решение «можно/нужно/доступно/показывать»;
- \`ui-state\` — наблюдаемое состояние интерфейса: загрузка, ошибка, раскрытие;
- \`user-input\` — введённое или выбранное пользователем значение;
- \`handler\` — пользовательское действие и его ожидаемый результат;
- \`technical\` — механическое значение без самостоятельного смысла.

Пиши по категории:
- domain-data: что представляет сущность и для какой задачи нужна;
- decision: какое решение выражает и при каких предметных условиях;
- ui-state: что видит пользователь, пока состояние активно, и на какую часть UI
  оно влияет или принципиально не влияет;
- user-input: что задаёт пользователь, как значение интерпретируется и какие
  ограничения имеет;
- handler: намерение действия, доступность и наблюдаемый результат;
- technical: одна честная фраза «Техническое промежуточное значение; отдельный
  бизнес-смысл не установлен». Не пытайся искусственно придать ему смысл.

Запрещено включать в summary или Markdown value-meaning:
- canonical ids, flow ids, названия kinds и метрики origin/continuation/completeness/confidence;
- названия selector, store, state paths, hooks и технических переменных как
  объяснение смысла;
- список компонентов, props и downstream consumers;
- фразы «берётся из», «возвращается хуком», «передаётся в компонент/prop»;
- пересказ происхождения, преобразования и маршрута данных — это уже показывает UI.

Допустимо назвать пользовательский экран, поле или действие, если без этого
невозможно объяснить наблюдаемое поведение.`;
}

function availableValueBlockId(targetId: string, existingIds: string[]) {
  const tail = targetId.split("#").at(-1) ?? targetId;
  const slug = tail
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "value";
  const base = `value-meaning-${slug}`;
  const existing = new Set(existingIds);
  if (!existing.has(base)) return base;
  let suffix = 2;
  while (existing.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

const SECTION_GUIDANCE: Record<string, string> = {
  Summary: "одно-два предложения: зачем элемент существует с точки зрения пользователя/бизнеса",
  Contract: "что элемент семантически возвращает/гарантирует и при каких условиях",
  "Business rules": "бизнес-правила, которые реализует код; каждый пункт с тегами идентификаторов",
  Scenarios: "пользовательские сценарии от действия до результата (включая ошибки)",
  "User flows": "пользовательские потоки страницы от входа до результата",
  "Roles / permissions": "кто и при каких правах видит/использует; различия поведения по ролям",
  Gotchas: "неочевидное поведение, ловушки, race conditions, легаси-причуды",
  "Open questions": "что нельзя уверенно понять из кода; требует ревью человеком",
};

const SECTION_KINDS: Record<string, string> = {
  Summary: "summary",
  Contract: "contract",
  "Business rules": "business-rule",
  Scenarios: "scenario",
  "User flows": "user-flow",
  "Roles / permissions": "role-rule",
  Gotchas: "gotcha",
  "Open questions": "open-question",
};

function v2BlocksTemplate(node: ProjectMapNode) {
  return requiredSectionsFor(node.type)
    .map((title) => {
      const id = title.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");
      const kind = SECTION_KINDS[title] ?? id;
      return `### \`${id}\` — ${SECTION_GUIDANCE[title] ?? ""}

\`\`\`md
## ${title}

<!-- project-map:block
{"id":"${id}","kind":"${kind}","targets":[{"type":"node","id":"${node.id}"}]}
-->
<Markdown блока>
<!-- /project-map:block -->
\`\`\``;
    })
    .join("\n\n");
}

function contextFilesBlock(selectedContext: DocsContextItem[]) {
  const files = uniqueByFile(selectedContext.filter((entry) => entry.file));
  return files.map((entry) => `- ${entry.file} - ${entry.reason}`).join("\n") || "Контекстные файлы не выбраны.";
}

function sourceManifestYaml(sources: DocsV2Source[]) {
  return `sources:
${sources.map((source) =>
  `  - path: ${JSON.stringify(source.path)}
    hash: ${source.hash}`
).join("\n")}`;
}

function uniqueByFile<TItem extends { file?: string }>(items: TItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!item.file || seen.has(item.file)) return false;
    seen.add(item.file);
    return true;
  });
}
