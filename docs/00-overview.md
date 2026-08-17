# Обзор проекта

Дата актуализации: 2026-08-04.

## Цель

Project Map — локальный статический анализатор React/FSD/Redux-проектов,
который превращает исходный код в доказуемую карту структуры и потока данных.

Инструмент должен быстро отвечать разработчику на три вопроса:

- что входит в страницу или компонент и почему;
- откуда пришло конкретное UI-значение и куда оно передаётся;
- какие страницы и компоненты затронет изменение selector, hook, state или API.

## Главная идея

Обычный import graph показывает:

```text
file A imports file B
```

Project Map должен показывать два связанных уровня.

Topology:

```text
UserPage рендерит UserProfileWidget
UserProfileWidget рендерит UserCard
UserProfileWidget использует useUserProfile
```

Value flow:

```text
GET /api/users/:id
  → fetchUser.fulfilled
  → state.user.current
  → selectCurrentUser
  → useUserProfile.name
  → profile.name
  → UserCard.name
```

Каждый доказанный шаг несёт `confidence` и `evidence`. Если статический анализ
не может продолжить цепочку, инструмент показывает честный gap, а не выдуманную
связь.

## Текущее состояние

Работоспособный MVP и основной продуктовый маршрут завершены:

- `project-map open` проверяет артефакты, при необходимости запускает scan,
  поднимает локальный Explorer и открывает браузер;
- scanner извлекает React/FSD/Redux/value-flow facts и строит topology graph;
- канонический `FlowIndex` записывается в `flows.json`; page flow, dossier,
  trace и impact используют единый query API вместо самостоятельной склейки
  raw facts;
- Explorer ведёт пользователя по маршруту
  `страница → структура → юнит → значение → трасса → evidence → impact`;
- origin и continuation оцениваются отдельно, неподдержанные участки
  показываются как явные gaps;
- occurrence-aware React structure сохраняет повторные JSX-callsite, Fragment,
  вложенность и prop slots;
- Docs v2 встроен в Structure, Unit Screen, Page Dossier и value trace;
- E2E остаётся отдельным enrichment-модулем и ожидает продуктовой интеграции в
  Overview/Coverage;
- URL-state, re-scan, recovery states и browser golden flow реализованы.

Текущий продуктовый долг сосредоточен в качестве анализаторов на реальных
формах кода и в проверке полезности ответов, а не в согласованности основных
product views.

## Артефакты

Текущий scan пишет:

```text
.project-map/
  graph.json
  flows.json
  facts.json
  unresolved.json
  stats.json
  config.json
  manifest.json
```

Где:

- `graph.json` — нормализованная topology-модель;
- `flows.json` — канонические value flows, gaps, completeness и metadata;
- `facts.json` — сырые факты scanner и диагностический источник;
- `unresolved.json` — конструкции, которые не удалось разрешить;
- `stats.json` — статистика анализа;
- `config.json` — нормализованная конфигурация scan run;
- `manifest.json` — общий run id, timestamp, source fingerprint, schema и digest
  каждого артефакта; записывается последним.

`flows.json` строится тем же scan run и доступен через `/api/flows` с проверкой
schema version. `/api/artifacts/status` возвращает `fresh`, `stale` или
`incompatible`. Семантика значений описана в
[`09-flow-value-semantics.md`](./09-flow-value-semantics.md).

## Основной пользовательский маршрут

```text
поиск page/component/selector/value
  → Overview выбранного scope
  → список значимых flows
  → одна раскрытая трасса source → consumer
  → evidence или impact того же flow
```

Большой node-link graph остаётся topology/debug-инструментом. Перечисление
состава лучше показывать деревом или документом, а поток — одной выбранной
трассой.

## Границы

В текущий этап не входят:

- runtime tracing и запись действий в браузере;
- автоматическое исправление архитектуры;
- поддержка новых state managers до стабилизации Redux flow;
- дополнительные canvas/layout-режимы;
- автоматическое создание или применение изменений кода из документации;
- генерация изменений исходного проекта без явного подтверждения пользователя.
