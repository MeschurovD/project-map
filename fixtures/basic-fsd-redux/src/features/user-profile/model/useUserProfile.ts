import { useGetUserQuery } from "@/shared/api/userApi";
import { userActions } from "@/entities/user";
import { fetchUser } from "@/entities/user/model/thunks";
import { useAppDispatch, useAppSelector } from "@/shared/model/store";
import { selectCurrentUser, selectUserError, selectUserSummary } from "@/entities/user";

export function useUserProfile() {
  const dispatch = useAppDispatch();
  const user = useAppSelector(selectCurrentUser);
  const status = useAppSelector((state) => state.user.status);
  const error = useAppSelector(selectUserError);
  const summary = useAppSelector(selectUserSummary);
  const query = useGetUserQuery(user?.id);

  dispatch(userActions.touch());
  dispatch(fetchUser("1"));

  void error;
  void summary;

  return {
    name: user?.name ?? "Unknown",
    displayStatus: status ?? query.data?.name,
  };
}
