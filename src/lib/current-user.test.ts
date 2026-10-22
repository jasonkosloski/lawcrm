/**
 * Unit tests for the current-user resolvers.
 *
 * Coverage:
 *   - `getCurrentUserId` returns the session user id.
 *   - `getCurrentUserId` redirects to `/login` when signed out.
 *   - `requireUser` (the page guard) returns the id or redirects to
 *     `/login`.
 *   - `getSession` / `getCurrentUserId` are wrapped in React `cache()`
 *     so repeated calls in one request pay a single `auth()` (and DB)
 *     hit.
 *
 * The cache-wrapping assertion needs a real memoizer: the client
 * build of React that Vitest resolves ships `cache()` as a plain
 * passthrough (no memoization outside RSC), so without the stub an
 * unwrapped function would pass silently. We mock `react.cache`
 * with a per-function memo Map, cleared between tests to mimic the
 * per-request scope.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  const stores: Map<string, unknown>[] = [];
  return { stores, staffAuth: vi.fn() };
});

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    cache: <T extends (...args: never[]) => unknown>(fn: T): T => {
      const store = new Map<string, unknown>();
      hoisted.stores.push(store);
      return ((...args: never[]) => {
        const key = JSON.stringify(args);
        if (!store.has(key)) store.set(key, fn(...args));
        return store.get(key);
      }) as T;
    },
  };
});

// `next/navigation`'s redirect throws an internal NEXT_REDIRECT
// error in production. In tests we want to detect the call — keep
// a stub that throws a recognisable string we can catch.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  }),
}));
// The real getStaffAuth is React-cache()d; model that so the dedupe
// assertions below measure the per-request sharing.
vi.mock("@/lib/staff-auth", async () => {
  const { cache } = await import("react");
  return { getStaffAuth: cache(() => hoisted.staffAuth()) };
});

import { redirect } from "next/navigation";
import { getCurrentUserId, getSession, requireUser } from "@/lib/current-user";

const mockedAuth = hoisted.staffAuth;
const ok = (userId: string) =>
  ({
    status: "ok",
    userId,
    clerkUserId: "clerk_1",
    sessionId: "sess_1",
  }) as never;
const signedOut = () => ({ status: "signed_out" }) as never;
const noAccess = () => ({ status: "no_access", clerkUserId: "clerk_1" }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  // New "request": drop every memo built by the cache() stub.
  for (const store of hoisted.stores) store.clear();
});

describe("getCurrentUserId", () => {
  test("returns the session user id", async () => {
    mockedAuth.mockResolvedValue(ok("user-1"));
    await expect(getCurrentUserId()).resolves.toBe("user-1");
  });

  test("redirects to /login when there is no session", async () => {
    mockedAuth.mockResolvedValue(signedOut());
    await expect(getCurrentUserId()).rejects.toThrow("__REDIRECT__:/login");
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  test("redirects to /no-access when signed in without firm access", async () => {
    mockedAuth.mockResolvedValue(noAccess());
    await expect(getCurrentUserId()).rejects.toThrow("__REDIRECT__:/no-access");
    expect(redirect).toHaveBeenCalledWith("/no-access");
  });

  test("dedupes auth() across repeated calls in one request", async () => {
    mockedAuth.mockResolvedValue(ok("user-1"));
    await expect(getCurrentUserId()).resolves.toBe("user-1");
    await expect(getCurrentUserId()).resolves.toBe("user-1");
    // One auth() decode (and its per-call user.findUnique in the jwt
    // callback) per request — not one per call site.
    expect(mockedAuth).toHaveBeenCalledTimes(1);
  });
});

describe("getSession", () => {
  test("decodes the session once per request, shared with getCurrentUserId", async () => {
    mockedAuth.mockResolvedValue(ok("user-1"));
    await getSession();
    await getSession();
    await getCurrentUserId();
    expect(mockedAuth).toHaveBeenCalledTimes(1);
  });
});

describe("requireUser", () => {
  test("returns the session user id", async () => {
    mockedAuth.mockResolvedValue(ok("user-1"));
    await expect(requireUser()).resolves.toBe("user-1");
  });

  test("redirects to /login when there is no session", async () => {
    mockedAuth.mockResolvedValue(signedOut());
    await expect(requireUser()).rejects.toThrow("__REDIRECT__:/login");
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  test("redirects to /no-access when signed in without firm access", async () => {
    mockedAuth.mockResolvedValue(noAccess());
    await expect(requireUser()).rejects.toThrow("__REDIRECT__:/no-access");
    expect(redirect).toHaveBeenCalledWith("/no-access");
  });
});
