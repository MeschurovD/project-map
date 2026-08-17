# Ключевые проектные решения

## Решение 1. Сначала данные, потом визуализация

Основной результат сканирования — стабильный `graph.json`.

UI не должен зависеть от AST, ts-morph, TypeScript Compiler API или внутренних деталей анализатора.

Правильный поток данных:

```text
код проекта
  ↓
анализатор
  ↓
сырые факты
  ↓
построитель графа
  ↓
graph.json
  ↓
визуальный интерфейс
```

Это позволит отдельно развивать анализатор и UI.

## Решение 2. Под капотом граф, а не дерево

Визуально проект можно показывать как дерево или mind map, но модель данных должна быть графом.

Причина:

- одна `entity` может использоваться в нескольких `features`;
- одна `feature` может использоваться в нескольких `pages`;
- один `shared/ui` компонент может использоваться во всём проекте;
- один hook может использоваться несколькими компонентами;
- один selector может использоваться в разных hooks и components.

Поэтому храним:

```text
nodes + edges
```

А дерево — это только один из способов отображения графа.

## Решение 3. Первый этап — статический анализ

На первом этапе работаем только со статическим анализом.

Анализируем:

- файлы;
- импорты;
- экспорты;
- FSD-структуру;
- React-компоненты;
- JSX;
- вызовы хуков;
- Redux selectors;
- Redux dispatch;
- RTK Query hooks.

Не анализируем runtime-поведение приложения.

## Решение 4. Сырые факты отделены от графа

Анализатор сначала собирает факты.

Пример факта:

```json
{
  "type": "jsxUsage",
  "sourceFile": "src/widgets/user-profile/ui/UserProfileWidget.tsx",
  "componentName": "UserCard",
  "location": {
    "line": 18,
    "column": 7
  }
}
```

Потом Graph Builder превращает факты в связи:

```json
{
  "from": "component:widgets/user-profile/UserProfileWidget",
  "to": "component:entities/user/UserCard",
  "type": "renders",
  "confidence": "high"
}
```

Так проще:

- тестировать анализатор;
- отлаживать ошибки;
- добавлять новые типы анализа;
- менять модель графа без переписывания парсера.

## Решение 5. У каждой связи должны быть confidence и evidence

Каждая найденная связь должна содержать:

- тип связи;
- уровень уверенности;
- доказательство;
- исходный файл;
- строку, если возможно;
- фрагмент кода, если возможно.

Пример:

```json
{
  "from": "component:features/user-edit/UserEditForm",
  "to": "selector:entities/user/selectCurrentUser",
  "type": "usesSelector",
  "confidence": "high",
  "evidence": {
    "file": "src/features/user-edit/ui/UserEditForm.tsx",
    "line": 12,
    "code": "useAppSelector(selectCurrentUser)"
  }
}
```

## Решение 6. Анализ должен быть честным, а не магическим

Не нужно пытаться идеально понять весь проект.

Если связь найдена точно — ставим `high`.

Если связь найдена через barrel export, alias или обёртку — ставим `medium`.

Если связь найдена эвристически — ставим `low`.

Если не удалось разрешить — пишем в `unresolved.json`.

## Решение 7. Конвенции проекта должны быть настраиваемыми

В разных проектах могут отличаться:

- source root;
- alias imports;
- названия FSD-слоёв;
- названия Redux hooks;
- расположение slices/selectors/actions;
- правила public API.

Поэтому нужен конфиг.

Пример:

```json
{
  "sourceRoot": "src",
  "fsd": {
    "layers": ["app", "pages", "widgets", "features", "entities", "shared"],
    "segments": ["ui", "model", "api", "lib", "config"]
  },
  "redux": {
    "selectorHooks": ["useSelector", "useAppSelector"],
    "dispatchHooks": ["useDispatch", "useAppDispatch"]
  }
}
```

## Решение 8. UI работает только с нормализованными артефактами

Актуализация 2026-07-11: исходный принцип «UI работает только с `graph.json`»
сохраняется по смыслу — UI не должен сам анализировать код или интерпретировать
raw facts. Для topology одного `graph.json` достаточно, но value-flow требует
отдельного нормализованного контракта.

Целевой набор продуктовых артефактов:

- `graph.json` — topology и крупные семантические связи;
- `flows.json` — значения, state-пути, источники, потребители и gaps;
- `unresolved.json` — диагностика неразрешённых конструкций;
- `facts.json` — отладочный артефакт scanner/normalizer, не API продуктового UI.

UI должен:

- загружать версионированные `graph.json` и `flows.json`;
- получать Overview / Flow / Impact через query-слой;
- показывать evidence, confidence и gaps;
- проверять совместимость schema и свежесть одного scan run;
- не собирать продуктовую семантику напрямую из AST или `facts.json`.

Семантика значений в flow-контракте описана в
[`09-flow-value-semantics.md`](./09-flow-value-semantics.md).
