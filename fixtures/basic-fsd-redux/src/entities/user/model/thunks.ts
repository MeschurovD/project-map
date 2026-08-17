import { createAsyncThunk } from "@reduxjs/toolkit";

export const fetchUser = createAsyncThunk("user/fetchUser", async (userId: string) => {
  const response = await fetch(`/api/users/${userId}`);
  return (await response.json()) as { id: string; name: string };
});
