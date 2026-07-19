/**
 * Uniform guard for Supabase writes: every write races a timeout so it
 * can never hang silently, and auth failures trigger one session refresh
 * plus a single retry before surfacing an error the caller can toast.
 */

export const WRITE_TIMEOUT_MS = 10_000;

export const TIMEOUT_MESSAGE =
  "Write timed out — check your connection and retry.";
export const SESSION_EXPIRED_MESSAGE =
  "Session expired — reload to continue.";

export type WriteError = {
  message: string;
  code?: string;
  status?: number;
};

export type WriteResult = {
  data?: unknown;
  error: WriteError | null;
};

export function isAuthError(error: WriteError | null): boolean {
  if (!error) return false;
  if (error.status === 401) return true;
  return /\bjwt\b|token|not authenticated|session .*(expired|missing)|refresh_token/i.test(
    error.message
  );
}

function raceTimeout<T extends WriteResult>(
  p: PromiseLike<T>,
  ms: number
): Promise<T | { data: null; error: WriteError }> {
  return new Promise((resolve) => {
    const t = setTimeout(
      () => resolve({ data: null, error: { message: TIMEOUT_MESSAGE } }),
      ms
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (err: unknown) => {
        clearTimeout(t);
        resolve({
          data: null,
          error: {
            message: err instanceof Error ? err.message : String(err),
          },
        });
      }
    );
  });
}

/** Default session refresh via the browser Supabase client. */
async function refreshSupabaseSession(): Promise<boolean> {
  try {
    const { createClient } = await import("./supabase/client");
    const { error } = await createClient().auth.refreshSession();
    return !error;
  } catch {
    return false;
  }
}

/**
 * Run a Supabase write with a timeout and auth-refresh safety net.
 *
 * - Timeout (default 10s) → resolves with a TIMEOUT_MESSAGE error so the
 *   caller's retry toast fires; the write never hangs.
 * - Auth failure → one session refresh; on success the write is retried
 *   once, on failure resolves with SESSION_EXPIRED_MESSAGE.
 * - Rejections are converted to error results (uniform handling).
 */
export async function withWriteTimeout<T extends WriteResult>(
  run: () => PromiseLike<T>,
  opts: {
    timeoutMs?: number;
    /** Injectable for tests. Returns true when the session was refreshed. */
    refreshSession?: () => Promise<boolean>;
  } = {}
): Promise<T | { data: null; error: WriteError }> {
  const timeoutMs = opts.timeoutMs ?? WRITE_TIMEOUT_MS;
  const refresh = opts.refreshSession ?? refreshSupabaseSession;

  let result = await raceTimeout(run(), timeoutMs);
  if (result.error && isAuthError(result.error)) {
    const refreshed = await refresh();
    if (!refreshed) {
      return { data: null, error: { message: SESSION_EXPIRED_MESSAGE } };
    }
    result = await raceTimeout(run(), timeoutMs);
  }
  return result;
}
