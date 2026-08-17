import { useSyncExternalStore } from "react";

// Tiny cross-component signal: "open the data-flow trace for this node". Set by
// clicking a Business-rule identifier tag; read by the component data-flow panel
// to switch into its Trace segment. A nonce makes repeat requests for the same
// node re-fire.
type TraceFocusState = { nodeId: string | null; nonce: number };

let state: TraceFocusState = { nodeId: null, nonce: 0 };
const listeners = new Set<() => void>();

export const traceFocus = {
  request(nodeId: string) {
    state = { nodeId, nonce: state.nonce + 1 };
    listeners.forEach((listener) => listener());
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot(): TraceFocusState {
    return state;
  },
};

/** Returns a changing nonce while this node is the trace-focus target, else 0. */
export function useTraceFocusFor(nodeId: string): number {
  const snapshot = useSyncExternalStore(traceFocus.subscribe, traceFocus.getSnapshot);
  return snapshot.nodeId === nodeId ? snapshot.nonce : 0;
}
