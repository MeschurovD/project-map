import { createSelector } from "@reduxjs/toolkit";

type UserState = {
  current: { id: string; name: string } | null;
  status: string;
  error: string | null;
};

export const selectCurrentUser = (state: { user: { current: { id: string; name: string } | null } }) =>
  state.user.current;

export const selectUserState = (state: { user: UserState }) => state.user;

export const selectUserError = (state: { user: UserState }) => selectUserState(state).error;

export const selectUserSummary = createSelector(selectUserState, (user: UserState) => user.status);
