export function useGetUserQuery(userId: string | undefined) {
  return {
    data: userId ? { name: "Ada" } : null,
  };
}
