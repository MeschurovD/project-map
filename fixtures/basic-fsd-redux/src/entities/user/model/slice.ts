import { createSlice } from "@reduxjs/toolkit";
import { fetchUser } from "./thunks";

export const userSlice = createSlice({
  name: "user",
  initialState: {
    current: null,
    status: "idle",
    error: null,
  },
  reducers: {
    touch: (state) => state,
    reset: (state) => state,
  },
  extraReducers: (builder) => {
    builder.addCase(fetchUser.fulfilled, (state, action) => {
      state.current = action.payload;
      state.status = "ready";
    });
    builder.addCase(fetchUser.pending, (state) => {
      state.status = "loading";
      state.error = null;
    });
  },
});

export const userActions = userSlice.actions;
