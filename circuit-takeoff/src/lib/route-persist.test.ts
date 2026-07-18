import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRoutePersister,
  type RoutePersistFields,
  type RoutePersistSource,
} from "./route-persist";

const DEBOUNCE = 120;

function makeHarness(initial: RoutePersistSource[]) {
  const routes = new Map(initial.map((r) => [r.id, r]));
  const writes: { id: string; fields: RoutePersistFields }[] = [];
  const errors: { message: string; retry: () => void }[] = [];
  let failWrites = false;

  const persister = createRoutePersister({
    debounceMs: DEBOUNCE,
    getRoute: (id) => routes.get(id),
    write: (id, fields) => {
      writes.push({ id, fields });
      return Promise.resolve({
        error: failWrites ? { message: "network down" } : null,
      });
    },
    onError: (message, retry) => errors.push({ message, retry }),
  });

  return {
    routes,
    writes,
    errors,
    persister,
    setFailWrites: (v: boolean) => {
      failWrites = v;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("route persister — per-route pending map", () => {
  it("edit route A then device-follow route B: both writes issued with correct user_edited", async () => {
    const h = makeHarness([
      // A: user just dragged a bend (RouteLayer onPathChange sets user_edited).
      {
        id: "A",
        path: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        plan_length_ft: 10,
        user_edited: true,
      },
      // B: auto route glued to a moved device (user_edited stays false).
      {
        id: "B",
        path: [
          { x: 0, y: 0 },
          { x: 0, y: 20 },
        ],
        plan_length_ft: 20,
        user_edited: false,
      },
    ]);

    h.persister.queue("A");
    // Immediately after — previously this cancelled A's pending write.
    h.persister.queue("B");

    await vi.advanceTimersByTimeAsync(DEBOUNCE + 10);

    expect(h.writes).toHaveLength(2);
    const a = h.writes.find((w) => w.id === "A")!;
    const b = h.writes.find((w) => w.id === "B")!;
    expect(a.fields.user_edited).toBe(true);
    expect(a.fields.path).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    expect(a.fields.plan_length_ft).toBe(10);
    expect(b.fields.user_edited).toBe(false);
    expect(b.fields.plan_length_ft).toBe(20);
  });

  it("device-follow on a user_edited route preserves user_edited=true in the write", async () => {
    const h = makeHarness([
      {
        id: "A",
        path: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        plan_length_ft: 10,
        user_edited: true,
      },
    ]);
    // Device-follow path only knows the id; fields come from current state.
    h.persister.queue("A");
    await vi.advanceTimersByTimeAsync(DEBOUNCE + 10);
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0].fields.user_edited).toBe(true);
  });

  it("re-queues of the same route debounce to one write with latest state", async () => {
    const h = makeHarness([
      { id: "A", path: [{ x: 0, y: 0 }], plan_length_ft: 1, user_edited: true },
    ]);
    h.persister.queue("A");
    await vi.advanceTimersByTimeAsync(DEBOUNCE / 2);
    h.routes.set("A", {
      id: "A",
      path: [
        { x: 0, y: 0 },
        { x: 99, y: 0 },
      ],
      plan_length_ft: 99,
      user_edited: true,
    });
    h.persister.queue("A");
    await vi.advanceTimersByTimeAsync(DEBOUNCE + 10);
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0].fields.plan_length_ft).toBe(99);
  });

  it("flush writes all pending immediately (unmount / pagehide)", async () => {
    const h = makeHarness([
      { id: "A", path: [{ x: 0, y: 0 }], plan_length_ft: 1, user_edited: true },
      { id: "B", path: [{ x: 1, y: 1 }], plan_length_ft: 2, user_edited: false },
    ]);
    h.persister.queue("A");
    h.persister.queue("B");
    expect(h.persister.pendingCount()).toBe(2);
    h.persister.flush();
    expect(h.persister.pendingCount()).toBe(0);
    // No timer advance needed — writes issued synchronously on flush.
    expect(h.writes.map((w) => w.id).sort()).toEqual(["A", "B"]);
    await vi.runAllTimersAsync();
    expect(h.writes).toHaveLength(2); // no duplicate writes later
  });

  it("write error surfaces via onError and retry re-issues the write", async () => {
    const h = makeHarness([
      { id: "A", path: [{ x: 0, y: 0 }], plan_length_ft: 1, user_edited: true },
    ]);
    h.setFailWrites(true);
    h.persister.queue("A");
    await vi.advanceTimersByTimeAsync(DEBOUNCE + 10);
    expect(h.writes).toHaveLength(1);
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0].message).toBe("network down");

    h.setFailWrites(false);
    h.errors[0].retry();
    await vi.advanceTimersByTimeAsync(DEBOUNCE + 10);
    expect(h.writes).toHaveLength(2);
    expect(h.errors).toHaveLength(1);
  });

  it("skips routes deleted before the write fires", async () => {
    const h = makeHarness([
      { id: "A", path: [{ x: 0, y: 0 }], plan_length_ft: 1, user_edited: true },
    ]);
    h.persister.queue("A");
    h.routes.delete("A");
    await vi.advanceTimersByTimeAsync(DEBOUNCE + 10);
    expect(h.writes).toHaveLength(0);
  });
});
