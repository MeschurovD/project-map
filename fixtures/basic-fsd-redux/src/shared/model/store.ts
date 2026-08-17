export const useAppDispatch = () => (action: unknown) => action;
export const useAppSelector = <T>(selector: (state: { user: { current: null; status: string } }) => T): T =>
  selector({ user: { current: null, status: "idle" } });
