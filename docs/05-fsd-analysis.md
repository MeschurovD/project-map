# FSD-анализ

## Цель

FSD-анализ должен классифицировать файлы и модули проекта по слоям Feature-Sliced Design.

Основная задача — понять, где находится сущность проекта:

```text
pages → widgets → features → entities → shared
```

## Поддерживаемые слои по умолчанию

```text
app
pages
widgets
features
entities
shared
```

## Поддерживаемые сегменты по умолчанию

```text
ui
model
api
lib
config
types
consts
```

## Пример классификации

Файл:

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

## Правила классификации

### app

```text
src/app/providers/AppProvider.tsx
```

```json
{
  "layer": "app",
  "slice": null,
  "segment": "providers"
}
```

### pages

```text
src/pages/user-profile/ui/UserProfilePage.tsx
```

```json
{
  "layer": "pages",
  "slice": "user-profile",
  "segment": "ui"
}
```

### widgets

```text
src/widgets/user-profile/ui/UserProfileWidget.tsx
```

```json
{
  "layer": "widgets",
  "slice": "user-profile",
  "segment": "ui"
}
```

### features

```text
src/features/user-edit/model/useUserEditForm.ts
```

```json
{
  "layer": "features",
  "slice": "user-edit",
  "segment": "model"
}
```

### entities

```text
src/entities/user/model/selectors.ts
```

```json
{
  "layer": "entities",
  "slice": "user",
  "segment": "model"
}
```

### shared

```text
src/shared/ui/Button/Button.tsx
```

```json
{
  "layer": "shared",
  "slice": "ui",
  "segment": "Button"
}
```

Для `shared` структура может отличаться, поэтому правила нужно сделать настраиваемыми.

## FSD module

FSD module — это агрегированная сущность уровня layer/slice.

Например:

```text
src/features/user-edit/*
```

Создаёт узел:

```json
{
  "id": "feature:user-edit",
  "type": "feature",
  "name": "user-edit",
  "fsd": {
    "layer": "features",
    "slice": "user-edit"
  }
}
```

## Public API

В FSD часто используется public API:

```text
src/entities/user/index.ts
```

Пример импорта:

```ts
import { UserCard } from "@/entities/user";
```

Реальное расположение:

```text
src/entities/user/ui/UserCard/UserCard.tsx
```

Анализатор должен попытаться пройти через `index.ts` и понять, откуда реально экспортируется `UserCard`.

## MVP public API support

На первом этапе поддержать простые формы:

```ts
export { UserCard } from "./ui/UserCard";
export { selectCurrentUser } from "./model/selectors";
export * from "./model/slice";
```

Можно отложить:

```ts
export { UserCard as ProfileCard } from "./ui/UserCard";
export type { User } from "./model/types";
```

## FSD dependency edges

На основе импортов можно строить связи между FSD-модулями.

Пример:

```text
src/widgets/user-profile/ui/UserProfileWidget.tsx
imports
src/entities/user/index.ts
```

Связь:

```json
{
  "from": "widget:user-profile",
  "to": "entity:user",
  "type": "dependsOn",
  "confidence": "medium"
}
```

## Проверки, которые можно добавить позже

Позже можно использовать FSD-граф для архитектурных проверок:

- feature не должна импортировать другую feature напрямую;
- entity не должна импортировать feature;
- shared не должен импортировать вышестоящие слои;
- page может импортировать widgets/features/entities/shared;
- widget может импортировать features/entities/shared.

Но в MVP это не обязательно. В MVP главное — построить карту.
