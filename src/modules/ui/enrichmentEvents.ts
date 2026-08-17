// Module actions can change overlays without re-running the scanner (for
// example, a docs job creates a .docs.md file). Keep invalidation generic so
// feature modules do not need to reach into App state directly.

const listeners = new Set<() => void>();

export function subscribeEnrichmentChanges(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyEnrichmentChanged() {
  for (const listener of listeners) listener();
}
