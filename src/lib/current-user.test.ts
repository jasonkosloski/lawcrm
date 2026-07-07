/**
 * Unit tests for the current-user resolvers.
 *
 * Coverage:
 *   - `getCurrentUserId` returns the session user id.
 *   - `getCurrentUserId` redirects to `/login` when signed out.
 *   - `getCurrentUser` returns null when signed out (login layout
 *     renders too — the null branch is load-bearing).
 *   - Both resolvers are wrapped in React `cache()` so repeated
 *     calls in one request pay a single `auth()` (and DB) hit.
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
  return { stores };
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
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, getCurrentUserId } from "@/lib/current-user";

const mockedAuth = vi.mocked(auth);
const mockedFindUnique = vi.mocked(prisma.user.findUnique);

beforeEach(() => {
  vi.clearAllMocks();
  // New "request": drop every memo built by the cache() stub.
  for (const store of hoisted.stores) store.clear();
});

describe("getCurrentUserId", () => {
  test("returns the session user id", async () => {
    mockedAuth.mockResolvedValue({ user: { id: "user-1" } } as never);
    await expect(getCurrentUserId()).resolves.toBe("user-1");
  });

  test("redirects to /login when there is no session", async () => {
    mockedAuth.mockResolvedValue(null as never);
    await expect(getCurrentUserId()).rejects.toThrow("__REDIRECT__:/login");
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  test("dedupes auth() across repeated calls in one request", async () => {
    mockedAuth.mockResolvedValue({ user: { id: "user-1" } } as never);
    await expect(getCurrentUserId()).resolves.toBe("user-1");
    await expect(getCurrentUserId()).resolves.toBe("user-1");
    // One auth() decode (and its per-call user.count in the jwt
    // callback) per request — not one per call site.
    expect(mockedAuth).toHaveBeenCalledTimes(1);
  });
});

describe("getCurrentUser", () => {
  test("returns null when signed out, without touching the DB", async () => {
    mockedAuth.mockResolvedValue(null as never);
    await expect(getCurrentUser()).resolves.toBeNull();
    expect(mockedFindUnique).not.toHaveBeenCalled();
  });

  test("reads display fields for the session user", async () => {
    mockedAuth.mockResolvedValue({ user: { id: "user-1" } } as never);
    const row = { id: "user-1", name: "Ada", initials: "AL", jobTitle: null };
    mockedFindUnique.mockResolvedValue(row as never);
    await expect(getCurrentUser()).resolves.toEqual(row);
    expect(mockedFindUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: { id: true, name: true, initials: true, jobTitle: true },
    });
  });

  test("dedupes auth() + user fetch across repeated calls", async () => {
    mockedAuth.mockResolvedValue({ user: { id: "user-1" } } as never);
    mockedFindUnique.mockResolvedValue({
      id: "user-1",
      name: "Ada",
      initials: "AL",
      jobTitle: null,
    } as never);
    await getCurrentUser();
    await getCurrentUser();
    expect(mockedAuth).toHaveBeenCalledTimes(1);
    expect(mockedFindUnique).toHaveBeenCalledTimes(1);
  });
});
