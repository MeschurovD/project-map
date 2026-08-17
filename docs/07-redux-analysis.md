# Redux-анализ

## Цель

Redux-анализ должен показать, какие компоненты и хуки взаимодействуют с Redux.

Нужно понять:

- какие selectors читаются;
- какие actions dispatch-ятся;
- какие RTK Query hooks используются;
- какие slices потенциально затрагиваются.

## Первый уровень анализа

В MVP не нужно делать идеальный data-flow analysis.

Достаточно найти базовые и часто встречающиеся паттерны.

## Selector hooks

Поддерживаемые имена по умолчанию:

```text
useSelector
useAppSelector
```

Они должны быть настраиваемыми через config:

```json
{
  "redux": {
    "selectorHooks": ["useSelector", "useAppSelector", "useTypedSelector"]
  }
}
```

## Selector usage

Пример:

```ts
const user = useAppSelector(selectCurrentUser);
```

Факт:

```json
{
  "type": "selectorUsage",
  "owner": "useUserEditForm",
  "selectorHook": "useAppSelector",
  "selectorName": "selectCurrentUser",
  "file": "src/features/user-edit/model/useUserEditForm.ts",
  "code": "useAppSelector(selectCurrentUser)"
}
```

Граф:

```text
useUserEditForm --usesSelector--> selectCurrentUser
```

## Inline selector

Пример:

```ts
const user = useAppSelector((state) => state.user.currentUser);
```

Факт:

```json
{
  "type": "inlineSelectorUsage",
  "owner": "useUserEditForm",
  "selectorHook": "useAppSelector",
  "statePath": "state.user.currentUser",
  "file": "src/features/user-edit/model/useUserEditForm.ts"
}
```

Граф:

```text
useUserEditForm --readsSlice--> user
```

Confidence:

```text
medium
```

Потому что `state.user.currentUser` может не всегда напрямую соответствовать slice name.

## Dispatch hooks

Поддерживаемые имена по умолчанию:

```text
useDispatch
useAppDispatch
```

Настройка:

```json
{
  "redux": {
    "dispatchHooks": ["useDispatch", "useAppDispatch"]
  }
}
```

## Dispatch usage

Пример:

```ts
const dispatch = useAppDispatch();

dispatch(userActions.updateUser(payload));
```

Факт:

```json
{
  "type": "dispatchCall",
  "owner": "useUserEditForm",
  "actionName": "userActions.updateUser",
  "file": "src/features/user-edit/model/useUserEditForm.ts",
  "code": "dispatch(userActions.updateUser(payload))"
}
```

Граф:

```text
useUserEditForm --dispatchesAction--> userActions.updateUser
```

## Thunk dispatch

Пример:

```ts
dispatch(loadUser(userId));
```

Факт:

```json
{
  "type": "dispatchCall",
  "owner": "useUserProfile",
  "actionName": "loadUser",
  "file": "src/features/user-profile/model/useUserProfile.ts",
  "code": "dispatch(loadUser(userId))"
}
```

Для MVP не обязательно определять, thunk это или action creator.

## Slice detection

Можно искать `createSlice`.

Пример:

```ts
export const userSlice = createSlice({
  name: "user",
  initialState,
  reducers: {
    updateUser: () => {}
  }
});
```

Факт:

```json
{
  "type": "reduxSlice",
  "name": "user",
  "variableName": "userSlice",
  "file": "src/entities/user/model/slice.ts"
}
```

## Action detection

Из `createSlice` можно извлечь reducers:

```ts
reducers: {
  updateUser: () => {},
  resetUser: () => {}
}
```

Факты:

```json
[
  {
    "type": "reduxAction",
    "name": "updateUser",
    "sliceName": "user"
  },
  {
    "type": "reduxAction",
    "name": "resetUser",
    "sliceName": "user"
  }
]
```

## RTK Query hooks

Пример:

```ts
const { data } = useGetUserQuery(userId);
const [updateUser] = useUpdateUserMutation();
```

Факты:

```json
[
  {
    "type": "rtkQueryHookCall",
    "owner": "UserEditForm",
    "hookName": "useGetUserQuery"
  },
  {
    "type": "rtkQueryHookCall",
    "owner": "UserEditForm",
    "hookName": "useUpdateUserMutation"
  }
]
```

Граф:

```text
UserEditForm --callsApi--> useGetUserQuery
UserEditForm --callsApi--> useUpdateUserMutation
```

## MVP Redux scope

В MVP нужно поддержать:

- `useSelector(selectorName)`;
- `useAppSelector(selectorName)`;
- inline selector вида `state.someSlice.someField`;
- `useDispatch`;
- `useAppDispatch`;
- `dispatch(actionCreator())`;
- `dispatch(sliceActions.actionName())`;
- RTK Query hooks по naming convention:
  - `useSomethingQuery`;
  - `useSomethingMutation`.

## Что отложить

Можно отложить:

- сложные selector factories;
- selectors, созданные через `createSelector`;
- глубокую трассировку selector до state shape;
- точное связывание thunk с slice;
- middleware;
- saga;
- observable;
- кастомные store abstractions.
