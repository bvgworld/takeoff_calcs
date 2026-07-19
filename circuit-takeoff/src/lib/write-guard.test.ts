import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SESSION_EXPIRED_MESSAGE,
  TIMEOUT_MESSAGE,
  WRITE_TIMEOUT_MS,
  isAuthError,
  withWriteTimeout,
  type WriteResult,
} from "./write-guard";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const ok: WriteResult = { data: { id: "x" }, error: null };

describe("withWriteTimeout", () => {
  it("passes successful writes through untouched", async () => {
    const result = await withWriteTimeout(() => Promise.resolve(ok), {
      refreshSession: async () => true,
    });
    expect(result).toEqual(ok);
  });

  it("a hung write resolves with the timeout error after 10s (never hangs)", async () => {
    const never = new Promise<WriteResult>(() => {});
    const p = withWriteTimeout(() => never, {
      refreshSession: async () => true,
    });
    await vi.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS + 1);
    const result = await p;
    expect(result.error?.message).toBe(TIMEOUT_MESSAGE);
  });

  it("converts rejections into error results (uniform toast path)", async () => {
    const result = await withWriteTimeout(
      () => Promise.reject(new Error("network down")),
      { refreshSession: async () => true }
    );
    expect(result.error?.message).toBe("network down");
  });

  it("auth failure → refresh succeeds → write retried once and succeeds", async () => {
    let calls = 0;
    const refresh = vi.fn(async () => true);
    const result = await withWriteTimeout(
      () => {
        calls++;
        return Promise.resolve(
          calls === 1 ? { data: null, error: { message: "JWT expired" } } : ok
        );
      },
      { refreshSession: refresh }
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(calls).toBe(2);
    expect(result).toEqual(ok);
  });

  it("auth failure → refresh fails → 'Session expired — reload to continue.'", async () => {
    const result = await withWriteTimeout(
      () =>
        Promise.resolve({
          data: null,
          error: { message: "invalid JWT", status: 401 },
        }),
      { refreshSession: async () => false }
    );
    expect(result.error?.message).toBe(SESSION_EXPIRED_MESSAGE);
  });

  it("non-auth errors pass through without touching the session", async () => {
    const refresh = vi.fn(async () => true);
    const result = await withWriteTimeout(
      () =>
        Promise.resolve({
          data: null,
          error: { message: "duplicate key value violates unique constraint" },
        }),
      { refreshSession: refresh }
    );
    expect(refresh).not.toHaveBeenCalled();
    expect(result.error?.message).toContain("duplicate key");
  });
});

describe("isAuthError", () => {
  it("matches 401s and JWT/session messages, not ordinary errors", () => {
    expect(isAuthError({ message: "anything", status: 401 })).toBe(true);
    expect(isAuthError({ message: "JWT expired" })).toBe(true);
    expect(isAuthError({ message: "Invalid Refresh Token: refresh_token not found" })).toBe(true);
    expect(isAuthError({ message: "duplicate key" })).toBe(false);
    expect(isAuthError(null)).toBe(false);
  });
});
