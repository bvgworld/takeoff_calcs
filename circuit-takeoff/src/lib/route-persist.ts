import type { Point } from "./types";

/**
 * Debounced per-route persistence. Each route id has its own pending timer,
 * so an edit to route A never cancels a queued write for route B (the old
 * single-shared-timer bug). Every write reads the CURRENT route from
 * `getRoute` and always includes path, plan_length_ft, and user_edited.
 */

export type RoutePersistFields = {
  path: Point[];
  plan_length_ft: number;
  user_edited: boolean;
};

export type RoutePersistSource = {
  id: string;
  path: Point[];
  plan_length_ft: number;
  user_edited: boolean;
};

export type RoutePersister = {
  /** Debounce a write for this route id (per-id timer). */
  queue: (id: string) => void;
  /** Cancel timers and write everything pending now (unmount / pagehide). */
  flush: () => void;
  pendingCount: () => number;
};

export function createRoutePersister(opts: {
  getRoute: (id: string) => RoutePersistSource | undefined;
  write: (
    id: string,
    fields: RoutePersistFields
  ) => Promise<{ error: { message: string } | null }>;
  onError: (message: string, retry: () => void) => void;
  debounceMs?: number;
}): RoutePersister {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const debounceMs = opts.debounceMs ?? 120;

  function issue(id: string) {
    const r = opts.getRoute(id);
    if (!r) return;
    const fields: RoutePersistFields = {
      path: r.path,
      plan_length_ft: r.plan_length_ft,
      user_edited: r.user_edited,
    };
    opts.write(id, fields).then(
      ({ error }) => {
        if (error) opts.onError(error.message, () => queue(id));
      },
      (err: unknown) => {
        opts.onError(
          err instanceof Error ? err.message : String(err),
          () => queue(id)
        );
      }
    );
  }

  function queue(id: string) {
    const prev = timers.get(id);
    if (prev) clearTimeout(prev);
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        issue(id);
      }, debounceMs)
    );
  }

  function flush() {
    const ids = Array.from(timers.keys());
    timers.forEach((t) => clearTimeout(t));
    timers.clear();
    for (const id of ids) issue(id);
  }

  return { queue, flush, pendingCount: () => timers.size };
}
