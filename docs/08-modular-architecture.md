# Модульная архитектура Project Map

## Цель

Project Map должен уметь расширяться функциональными модулями без ручного вшивания каждого модуля в ядро dev server и основной React UI.

Базовая цель модульной архитектуры:

- каждый модуль живет в отдельной папке;
- серверная логика модуля подключается через registry;
- UI модуля подключается через slots;
- общие механики генерации, jobs и runner не дублируются между модулями;
- ядро знает только о контрактах модулей, а не о конкретных сценариях вроде docs или e2e.

Первыми модулями, приведёнными к этой схеме, стали генерация документации и
e2e-покрытие: page object files для компонентов и business-flow тесты для страниц.

## Целевая структура

```text
src/
  modules/
    types.ts
    registry.ts

    docs/
      index.ts
      shared/
        apiTypes.ts
        config.ts
      server/
        index.ts
        routes.ts
        services/
      ui/
        index.tsx
        components/

    e2e/
      index.ts
      shared/
        apiTypes.ts
        config.ts
      server/
        index.ts
        routes.ts
        services/
      ui/
        index.tsx
        components/

  generation/
    jobs/
      createJobStore.ts
      types.ts
    prompts/
      contextTypes.ts
    runners/
      opencodeRunner.ts

  dev/
    startDevServer.ts
    services/

  ui/src/
    moduleRegistry.tsx
    slots/
      NodeDetailsSlot.tsx
```

На промежуточном этапе допускается оставить часть существующих путей на месте, если уже есть рабочие импорты и тесты. Важнее сначала ввести контракты и убрать прямые подключения из ядра.

## Контракт модуля

Модуль описывается декларативно:

```ts
export type ProjectMapModule = {
  id: string;
  server?: ProjectMapServerModule;
  ui?: ProjectMapUiModule;
};
```

Серверная часть:

```ts
export type ProjectMapServerModule = {
  registerRoutes(ctx: ServerModuleContext): Connect.NextHandleFunction[];
};
```

UI-часть:

```ts
export type ProjectMapUiModule = {
  nodeDetailsPanels?: NodeDetailsPanelRegistration[];
};
```

Панель detail-view:

```ts
export type NodeDetailsPanelRegistration = {
  id: string;
  order: number;
  supportsNode?: (ctx: NodeDetailsPanelContext) => boolean;
  Component: React.ComponentType<NodeDetailsPanelContext>;
};
```

## Server Registry

Dev server должен регистрировать модули через общий список:

```ts
for (const module of projectMapModules) {
  for (const route of module.server?.registerRoutes(ctx) ?? []) {
    server.middlewares.use(route);
  }
}
```

Ядро dev server сохраняет только базовые endpoints:

- `/api/graph`;
- `/api/facts`;
- `/api/stats`;
- `/api/unresolved`;
- `/api/source/*`.

Функциональные endpoints должны принадлежать модулям:

- `/api/docs/*`;
- позже `/api/e2e/*`.

На первом этапе можно сохранить существующий путь `/api/docs/*`, чтобы не ломать UI. Позже можно перейти к namespace `/api/modules/docs/*`, если появится необходимость в строгой изоляции.

## UI Slots

Основной UI не должен импортировать `DocsPanel`, `E2ePanel` и другие панели напрямую.

Вместо этого detail-view рендерит слот:

```tsx
<NodeDetailsSlot node={node} graph={graph} />
```

Слот берет регистрации из `uiModules` и рендерит подходящие панели по `supportsNode` и `order`.

Это позволит добавить e2e-панель без правки `App.tsx`:

```ts
export const e2eUiModule = {
  nodeDetailsPanels: [
    {
      id: "e2e.node-details",
      order: 30,
      supportsNode: ({ node }) => node.type === "component" || node.type === "page",
      Component: E2ePanel,
    },
  ],
};
```

## Общий Generation Layer

Docs и e2e используют один и тот же workflow:

```text
selected node
  -> build context
  -> choose context files
  -> build prompt
  -> preview/copy prompt
  -> run generator
  -> track job
  -> verify target files
```

Поэтому общие части нужно вынести из docs:

- job lifecycle;
- log redaction;
- process runner;
- generator config;
- базовые API-типы jobs;
- возможно, общий UI для prompt preview и job logs.

Модуль должен владеть только специфичными частями:

- какие node types поддерживаются;
- как резолвится target path;
- какой контекст нужен;
- какой prompt строится;
- какие файлы считаются успешным результатом.

## Docs Module

Текущий docs-модуль должен стать первым модулем:

```text
src/modules/docs/
  index.ts
  server/
    routes.ts
    services/
  ui/
    DocsPanel.tsx
    DocsModal.tsx
    GenerateDocsModal.tsx
  shared/
    apiTypes.ts
```

Текущий API можно сохранить:

```text
GET  /api/docs/node/:nodeId/status
GET  /api/docs/node/:nodeId/context
POST /api/docs/node/:nodeId/prompt
POST /api/docs/node/:nodeId/generate
GET  /api/docs/node/:nodeId
GET  /api/docs/jobs/:jobId
```

## E2E Module

Будущий e2e-модуль должен повторить тот же контракт.

Ожидаемые сценарии:

- для component node: генерация page object или component object;
- для page node: генерация e2e business flow spec;
- для page focus view: контекст должен включать composition, rendered widgets/features/entities, value-flow и source snippets;
- для generated files: модуль должен показывать статус, preview prompt, job logs и список целевых файлов.

Возможные endpoints:

```text
GET  /api/e2e/node/:nodeId/status
GET  /api/e2e/node/:nodeId/context
POST /api/e2e/node/:nodeId/prompt
POST /api/e2e/node/:nodeId/generate
GET  /api/e2e/jobs/:jobId
```

## План внедрения

1. Добавить архитектурный документ и зафиксировать целевую схему.
2. Ввести `src/modules/types.ts` и registry.
3. Подключить docs routes через server registry.
4. Подключить `DocsPanel` через UI slot, убрав прямой импорт из `App.tsx`.
5. Перенести docs-код физически в `src/modules/docs`.
6. Вынести общий job/generator слой в `src/generation`.
7. Перевести docs на общий generation слой.
8. Добавить e2e-модуль поверх тех же контрактов.

## Архитектурные правила

- Новый функциональный модуль не должен требовать правок в `startDevServer.ts`, кроме добавления в registry.
- Новый UI-модуль не должен требовать прямого импорта в `App.tsx`; он должен регистрировать panels/actions через slots.
- Серверный модуль не должен импортировать React UI.
- UI-модуль не должен импортировать server-only код.
- Shared-типы API должны жить рядом с модулем и переиспользоваться клиентом и сервером.
- Общие jobs/runners должны находиться вне конкретного модуля.
- Модуль может зависеть от graph/source/config сервисов ядра, но ядро не должно зависеть от внутренностей модуля.
