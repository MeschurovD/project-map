import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGenerationJobStore } from "../src/generation/jobs/createJobStore.js";

describe("createGenerationJobStore eviction", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("evicts finished jobs after the TTL", () => {
    const store = createGenerationJobStore<{ nodeId: string }>("docs");
    const finished = store.createJob({ nodeId: "a" });
    store.markJobSuccess(finished.id);
    const running = store.createJob({ nodeId: "b" });

    vi.advanceTimersByTime(31 * 60 * 1000);
    store.createJob({ nodeId: "c" });

    expect(store.getJob(finished.id)).toBeUndefined();
    expect(store.getJob(running.id)).toBeDefined();
  });

  it("keeps finished jobs within the TTL", () => {
    const store = createGenerationJobStore<{ nodeId: string }>("docs");
    const finished = store.createJob({ nodeId: "a" });
    store.markJobError(finished.id, "boom");

    vi.advanceTimersByTime(5 * 60 * 1000);
    store.createJob({ nodeId: "b" });

    expect(store.getJob(finished.id)).toBeDefined();
  });

  it("caps the number of retained finished jobs", () => {
    const store = createGenerationJobStore<{ index: number }>("docs");
    const ids: string[] = [];
    for (let index = 0; index < 60; index += 1) {
      const job = store.createJob({ index });
      store.markJobSuccess(job.id);
      ids.push(job.id);
      vi.advanceTimersByTime(1000);
    }

    store.createJob({ index: 60 });

    const retained = ids.filter((id) => store.getJob(id));
    expect(retained.length).toBe(50);
    expect(store.getJob(ids[0])).toBeUndefined();
    expect(store.getJob(ids[ids.length - 1])).toBeDefined();
  });
});
