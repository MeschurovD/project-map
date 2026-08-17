# Архитектура проекта

Документ описывает pipeline scanner → artifacts → UI, включая canonical
`flows.json` между сырыми facts и продуктовыми запросами.

## Общая схема

```text
React/FSD/Redux проект
        ↓
CLI
        ↓
Scanner Core
        ↓
Raw Facts
        ↓
Graph Builder
        ↓
graph.json
        ↓
Visual Explorer
```

## Основные модули

### 1. CLI

CLI отвечает за пользовательские команды.

Минимальные команды для MVP:

```bash
project-map scan
project-map dev
```

Будущие команды:

```bash
project-map init
project-map check
project-map stats
```

### 2. Config Loader

Отвечает за загрузку конфигурации.

Источники конфигурации:

```text
.project-map/config.json
project-map.config.ts
package.json
tsconfig.json
```

На первом этапе достаточно поддержать:

```text
.project-map/config.json
tsconfig.json
```

Config Loader должен вернуть нормализованный конфиг, чтобы остальные модули не думали о дефолтах.

### 3. File Scanner

Отвечает за поиск файлов проекта.

Должен:

- найти `.ts` файлы;
- найти `.tsx` файлы;
- исключить `node_modules`;
- исключить `dist`;
- исключить `build`;
- исключить `.next`;
- исключить `.turbo`;
- нормализовать пути.

### 4. Parser

Отвечает за парсинг TypeScript/TSX.

Можно использовать:

- `ts-morph`;
- либо TypeScript Compiler API напрямую.

Для MVP удобнее использовать `ts-morph`, потому что он проще для быстрого развития анализатора.

Parser не должен строить граф напрямую. Он только извлекает сырые факты.

### 5. Import Resolver

Отвечает за разрешение импортов.

Должен поддерживать:

- относительные импорты;
- alias imports из `tsconfig.paths`;
- `index.ts`;
- `index.tsx`;
- простые barrel exports;
- внешние пакеты;
- unresolved imports.

Пример:

```ts
import { UserCard } from "@/entities/user";
```

Должен быть разрешён до конкретного публичного API или файла, если это возможно.

### 6. FSD Classifier

Определяет FSD-метаданные файла.

Пример:

```text
src/features/user-edit/ui/UserEditForm.tsx
```

Результат:

```json
{
  "layer": "features",
  "slice": "user-edit",
  "segment": "ui"
}
```

### 7. React Analyzer

Отвечает за React-специфичные факты:

- компоненты;
- JSX-использования;
- custom hooks;
- связи component → hook;
- связи component → rendered component.

### 8. Redux Analyzer

Отвечает за Redux-специфичные факты:

- selector hooks;
- dispatch hooks;
- action calls;
- selectors;
- slices;
- RTK Query hooks.

В MVP можно сделать базовый уровень.

### 9. Graph Builder

Преобразует сырые факты в нормализованный граф.

На входе:

```text
facts.json
```

На выходе:

```text
graph.json
```

Graph Builder отвечает за:

- создание nodes;
- создание edges;
- дедупликацию;
- проставление confidence;
- добавление evidence;
- агрегацию file-level фактов в FSD-level связи.

### 10. Visual Explorer

Локальный UI для просмотра графа.

Рекомендуемый стек:

```text
React
React Flow
Vite
```

Visual Explorer должен:

- загружать `graph.json`;
- показывать граф;
- фильтровать узлы и связи;
- показывать детали выбранного узла;
- показывать evidence;
- показывать unresolved элементы.

## Разделение пакетов

На старте можно держать всё в одном пакете:

```text
src/
  cli/
  config/
  scanner/
  resolver/
  analyzers/
  graph/
  ui/
```

Позже можно разделить на workspace-пакеты:

```text
packages/
  cli/
  core/
  graph/
  ui/
```

Для MVP лучше не усложнять и начать с одной codebase.

## Предлагаемая структура src

```text
src/
  cli/
    index.ts
    commands/
      scan.ts
      dev.ts

  config/
    loadConfig.ts
    defaultConfig.ts
    types.ts

  scanner/
    scanFiles.ts
    parseProject.ts
    facts.ts

  resolver/
    resolveImport.ts
    tsconfigPaths.ts
    barrelResolver.ts

  analyzers/
    fsd/
      classifyFsdFile.ts
    react/
      detectComponents.ts
      detectJsxUsages.ts
      detectHooks.ts
    redux/
      detectSelectors.ts
      detectDispatches.ts
      detectRtkQuery.ts

  graph/
    buildGraph.ts
    nodeFactory.ts
    edgeFactory.ts
    graphTypes.ts

  output/
    writeArtifacts.ts

  ui/
    app/
```
