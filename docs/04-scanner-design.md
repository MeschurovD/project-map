# Дизайн анализатора

## Цель

Анализатор должен прочитать проект, извлечь полезные факты из кода и подготовить данные для построения семантического графа.

Важно: анализатор не должен сразу строить UI-граф. Он должен собирать факты.

## Общий pipeline

```text
1. Загрузить конфиг
2. Найти файлы
3. Создать TypeScript project
4. Распарсить файлы
5. Собрать import/export facts
6. Разрешить импорты
7. Классифицировать FSD
8. Собрать React facts
9. Собрать Redux facts
10. Записать facts.json
11. Записать unresolved.json
12. Передать facts в Graph Builder
```

## Raw facts

Факт — это минимальная единица информации, найденная анализатором.

Примеры фактов:

- найден файл;
- найден импорт;
- найден экспорт;
- найден компонент;
- найден JSX usage;
- найден hook call;
- найден selector usage;
- найден dispatch call.

## File fact

```json
{
  "type": "file",
  "file": "src/features/user-edit/ui/UserEditForm.tsx",
  "extension": ".tsx"
}
```

## Import fact

```json
{
  "type": "import",
  "sourceFile": "src/pages/user/UserPage.tsx",
  "target": "@/widgets/user-profile",
  "importedNames": ["UserProfileWidget"],
  "isTypeOnly": false
}
```

## Resolved import fact

```json
{
  "type": "resolvedImport",
  "sourceFile": "src/pages/user/UserPage.tsx",
  "target": "@/widgets/user-profile",
  "targetFile": "src/widgets/user-profile/index.ts",
  "resolved": true
}
```

## Export fact

```json
{
  "type": "export",
  "sourceFile": "src/entities/user/index.ts",
  "exportedNames": ["UserCard", "selectCurrentUser", "userActions"]
}
```

## FSD classification fact

```json
{
  "type": "fsdClassification",
  "file": "src/features/user-edit/ui/UserEditForm.tsx",
  "layer": "features",
  "slice": "user-edit",
  "segment": "ui"
}
```

## Component fact

```json
{
  "type": "component",
  "name": "UserEditForm",
  "file": "src/features/user-edit/ui/UserEditForm.tsx",
  "exported": true,
  "declaration": "function"
}
```

## JSX usage fact

```json
{
  "type": "jsxUsage",
  "sourceFile": "src/widgets/user-profile/ui/UserProfileWidget.tsx",
  "ownerComponent": "UserProfileWidget",
  "componentName": "UserCard",
  "location": {
    "line": 18,
    "column": 7
  },
  "code": "<UserCard />"
}
```

## Hook call fact

```json
{
  "type": "hookCall",
  "sourceFile": "src/features/user-edit/ui/UserEditForm.tsx",
  "owner": "UserEditForm",
  "hookName": "useUserEditForm",
  "location": {
    "line": 10,
    "column": 16
  },
  "code": "const form = useUserEditForm()"
}
```

## Selector usage fact

```json
{
  "type": "selectorUsage",
  "sourceFile": "src/features/user-edit/model/useUserEditForm.ts",
  "owner": "useUserEditForm",
  "selectorHook": "useAppSelector",
  "selectorName": "selectCurrentUser",
  "location": {
    "line": 8,
    "column": 15
  },
  "code": "useAppSelector(selectCurrentUser)"
}
```

## Dispatch fact

```json
{
  "type": "dispatchCall",
  "sourceFile": "src/features/user-edit/model/useUserEditForm.ts",
  "owner": "useUserEditForm",
  "actionName": "userActions.updateUser",
  "location": {
    "line": 15,
    "column": 3
  },
  "code": "dispatch(userActions.updateUser(payload))"
}
```

## RTK Query fact

```json
{
  "type": "rtkQueryHookCall",
  "sourceFile": "src/features/user-edit/ui/UserEditForm.tsx",
  "owner": "UserEditForm",
  "hookName": "useGetUserQuery",
  "location": {
    "line": 11,
    "column": 20
  },
  "code": "const { data } = useGetUserQuery(userId)"
}
```

## Unresolved fact

```json
{
  "type": "unresolvedImport",
  "sourceFile": "src/pages/user/UserPage.tsx",
  "target": "@/unknown/module",
  "reason": "Cannot resolve alias import"
}
```

## Минимальные требования к анализатору MVP

MVP-анализатор должен уметь:

- находить файлы;
- парсить импорты;
- парсить экспорты;
- разрешать относительные импорты;
- разрешать alias imports;
- классифицировать FSD;
- находить компоненты;
- находить JSX usage;
- находить custom hooks;
- находить базовые Redux selector usages;
- находить базовые dispatch calls.

## Что можно отложить

Можно отложить:

- глубокий TypeChecker-анализ;
- полное разрешение generic-типов;
- сложные dynamic imports;
- сложные HOC-композиции;
- точное определение runtime-ветвлений;
- анализ всех возможных Redux middleware;
- анализ side effects внутри thunk.
