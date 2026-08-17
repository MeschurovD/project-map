# React-анализ

## Цель

React-анализ должен найти компоненты, JSX-использования и кастомные хуки.

Это нужно, чтобы граф показывал не только импорты файлов, но и реальные UI-связи.

## Что нужно найти

React Analyzer должен находить:

- function components;
- arrow function components;
- memo components;
- forwardRef components;
- JSX component usages;
- custom hook declarations;
- custom hook calls.

## Component detection

### Function component

```tsx
export function UserCard() {
  return <div />;
}
```

Факт:

```json
{
  "type": "component",
  "name": "UserCard",
  "file": "src/entities/user/ui/UserCard.tsx",
  "exported": true,
  "declaration": "function"
}
```

### Arrow component

```tsx
export const UserCard = () => {
  return <div />;
};
```

Факт:

```json
{
  "type": "component",
  "name": "UserCard",
  "file": "src/entities/user/ui/UserCard.tsx",
  "exported": true,
  "declaration": "arrow"
}
```

### memo component

```tsx
export const UserCard = memo(() => {
  return <div />;
});
```

Факт:

```json
{
  "type": "component",
  "name": "UserCard",
  "file": "src/entities/user/ui/UserCard.tsx",
  "exported": true,
  "declaration": "memo"
}
```

### forwardRef component

```tsx
export const Input = forwardRef<HTMLInputElement, InputProps>((props, ref) => {
  return <input ref={ref} {...props} />;
});
```

Факт:

```json
{
  "type": "component",
  "name": "Input",
  "file": "src/shared/ui/Input/Input.tsx",
  "exported": true,
  "declaration": "forwardRef"
}
```

## JSX usage detection

Пример:

```tsx
export function UserProfileWidget() {
  return (
    <div>
      <UserCard />
      <Button />
    </div>
  );
}
```

Факты:

```json
[
  {
    "type": "jsxUsage",
    "ownerComponent": "UserProfileWidget",
    "componentName": "UserCard"
  },
  {
    "type": "jsxUsage",
    "ownerComponent": "UserProfileWidget",
    "componentName": "Button"
  }
]
```

Graph Builder должен преобразовать это в связи:

```text
UserProfileWidget --renders--> UserCard
UserProfileWidget --renders--> Button
```

## Intrinsic JSX elements

HTML-теги не должны становиться component nodes.

Игнорируем:

```tsx
<div />
<span />
button
input
form
```

Правило:

- если JSX tag начинается с маленькой буквы — это intrinsic element;
- если JSX tag начинается с большой буквы — это React component.

## Namespaced JSX

Пример:

```tsx
<Modal.Header />
```

Для MVP можно сохранять как:

```json
{
  "type": "jsxUsage",
  "componentName": "Modal.Header"
}
```

Точное разрешение можно отложить.

## Dynamic components

Пример:

```tsx
const Component = componentsMap[type];

return <Component />;
```

Для MVP можно записать unresolved:

```json
{
  "type": "unresolved-jsx-component",
  "name": "Component",
  "reason": "Dynamic component usage"
}
```

## Custom hook declaration

Хук — функция, имя которой начинается с `use`.

Пример:

```ts
export function useUserEditForm() {
  return {};
}
```

Факт:

```json
{
  "type": "hook",
  "name": "useUserEditForm",
  "file": "src/features/user-edit/model/useUserEditForm.ts",
  "exported": true
}
```

## Custom hook call

Пример:

```tsx
export function UserEditForm() {
  const form = useUserEditForm();

  return <form />;
}
```

Факт:

```json
{
  "type": "hookCall",
  "owner": "UserEditForm",
  "hookName": "useUserEditForm",
  "file": "src/features/user-edit/ui/UserEditForm.tsx"
}
```

Graph Builder должен построить:

```text
UserEditForm --usesHook--> useUserEditForm
```

## React built-in hooks

React built-in hooks не нужно делать отдельными nodes в первом MVP.

Игнорируем как отдельные узлы:

```text
useState
useEffect
useMemo
useCallback
useRef
useContext
useReducer
```

Но в будущем можно добавить статистику:

- компонент использует local state;
- компонент использует effects;
- компонент использует context.

## MVP scope

В MVP React Analyzer должен:

- находить function components;
- находить arrow function components;
- находить memo components;
- находить JSX usages;
- находить custom hook declarations;
- находить custom hook calls;
- игнорировать intrinsic elements;
- unresolved dynamic components записывать отдельно.
