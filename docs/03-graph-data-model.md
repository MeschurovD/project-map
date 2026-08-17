# Модель графа

`graph.json` хранит topology-модель проекта. Детальный value-flow не
встраивается в неё UI-преобразованиями, а хранится отдельно в `flows.json`.

## Главный принцип

Проект представляется как граф:

```text
nodes + edges
```

Где:

- `node` — сущность проекта;
- `edge` — связь между сущностями.

## Graph file

Итоговый файл:

```text
.project-map/graph.json
```

Пример верхнего уровня:

```json
{
  "schemaVersion": "1.1.0",
  "project": {
    "name": "example-project",
    "root": "/path/to/project",
    "sourceRoot": "src"
  },
  "nodes": [],
  "edges": [],
  "stats": {
    "nodesCount": 0,
    "edgesCount": 0
  }
}
```

## Node

Базовая структура node:

```json
{
  "id": "component:features/user-edit/UserEditForm",
  "type": "component",
  "name": "UserEditForm",
  "file": "src/features/user-edit/ui/UserEditForm.tsx",
  "fsd": {
    "layer": "features",
    "slice": "user-edit",
    "segment": "ui"
  },
  "meta": {}
}
```

## Node types

Поддерживаемые типы узлов:

```text
project
layer
slice
segment
page
widget
feature
entity
shared
component
hook
selector
action
thunk
slice-model
api
file
external-package
unknown
```

## FSD node

Пример feature node:

```json
{
  "id": "feature:user-edit",
  "type": "feature",
  "name": "user-edit",
  "fsd": {
    "layer": "features",
    "slice": "user-edit"
  },
  "meta": {
    "filesCount": 12
  }
}
```

## Component node

```json
{
  "id": "component:features/user-edit/UserEditForm",
  "type": "component",
  "name": "UserEditForm",
  "file": "src/features/user-edit/ui/UserEditForm.tsx",
  "fsd": {
    "layer": "features",
    "slice": "user-edit",
    "segment": "ui"
  },
  "meta": {
    "exported": true,
    "declaration": "function"
  }
}
```

## Hook node

```json
{
  "id": "hook:features/user-edit/useUserEditForm",
  "type": "hook",
  "name": "useUserEditForm",
  "file": "src/features/user-edit/model/useUserEditForm.ts",
  "fsd": {
    "layer": "features",
    "slice": "user-edit",
    "segment": "model"
  },
  "meta": {
    "exported": true
  }
}
```

## Selector node

```json
{
  "id": "selector:entities/user/selectCurrentUser",
  "type": "selector",
  "name": "selectCurrentUser",
  "file": "src/entities/user/model/selectors.ts",
  "fsd": {
    "layer": "entities",
    "slice": "user",
    "segment": "model"
  }
}
```

## Action node

```json
{
  "id": "action:entities/user/userActions.updateUser",
  "type": "action",
  "name": "userActions.updateUser",
  "file": "src/entities/user/model/slice.ts",
  "fsd": {
    "layer": "entities",
    "slice": "user",
    "segment": "model"
  }
}
```

## Edge

Базовая структура edge:

```json
{
  "id": "edge:component-a:renders:component-b",
  "from": "component:a",
  "to": "component:b",
  "type": "renders",
  "confidence": "high",
  "evidence": []
}
```

## Edge types

Поддерживаемые типы связей:

```text
contains
imports
reExports
dependsOn
renders
usesHook
usesSelector
dispatchesAction
readsSlice
writesSlice
callsApi
belongsToLayer
belongsToSlice
definedIn
unknown
```

## Edge: renders

```json
{
  "id": "edge:UserProfileWidget:renders:UserCard",
  "from": "component:widgets/user-profile/UserProfileWidget",
  "to": "component:entities/user/UserCard",
  "type": "renders",
  "confidence": "high",
  "evidence": [
    {
      "file": "src/widgets/user-profile/ui/UserProfileWidget.tsx",
      "line": 18,
      "column": 7,
      "code": "<UserCard />"
    }
  ]
}
```

## Edge: usesHook

```json
{
  "id": "edge:UserEditForm:usesHook:useUserEditForm",
  "from": "component:features/user-edit/UserEditForm",
  "to": "hook:features/user-edit/useUserEditForm",
  "type": "usesHook",
  "confidence": "high",
  "evidence": [
    {
      "file": "src/features/user-edit/ui/UserEditForm.tsx",
      "line": 10,
      "code": "const form = useUserEditForm()"
    }
  ]
}
```

## Edge: usesSelector

```json
{
  "id": "edge:useUserEditForm:usesSelector:selectCurrentUser",
  "from": "hook:features/user-edit/useUserEditForm",
  "to": "selector:entities/user/selectCurrentUser",
  "type": "usesSelector",
  "confidence": "high",
  "evidence": [
    {
      "file": "src/features/user-edit/model/useUserEditForm.ts",
      "line": 8,
      "code": "useAppSelector(selectCurrentUser)"
    }
  ]
}
```

## Edge: dispatchesAction

```json
{
  "id": "edge:useUserEditForm:dispatchesAction:userActions.updateUser",
  "from": "hook:features/user-edit/useUserEditForm",
  "to": "action:entities/user/userActions.updateUser",
  "type": "dispatchesAction",
  "confidence": "medium",
  "evidence": [
    {
      "file": "src/features/user-edit/model/useUserEditForm.ts",
      "line": 15,
      "code": "dispatch(userActions.updateUser(payload))"
    }
  ]
}
```

## Confidence levels

### high

Связь найдена напрямую и надёжно.

Примеры:

```tsx
<UserCard />
useUserEditForm()
useAppSelector(selectCurrentUser)
```

### medium

Связь найдена через импорт, barrel export, alias или wrapper.

Пример:

```ts
import { UserCard } from "@/entities/user";
```

### low

Связь найдена эвристически.

Пример:

```ts
const Component = componentMap[type];
```

### unknown

Связь не удалось точно разрешить.

## Evidence

Evidence показывает, почему анализатор решил, что связь существует.

Базовая структура:

```json
{
  "file": "src/features/user-edit/ui/UserEditForm.tsx",
  "line": 12,
  "column": 5,
  "code": "useAppSelector(selectCurrentUser)",
  "source": "react-analyzer"
}
```

## Unresolved

Если связь не удалось разрешить, её нужно записать в `unresolved.json`.

Пример:

```json
{
  "type": "unresolved-jsx-component",
  "name": "DynamicComponent",
  "file": "src/pages/demo/DemoPage.tsx",
  "reason": "Component is referenced in JSX but declaration/import was not found"
}
```
