/**
 * getPortalIdentity is wrapped in React cache() so the portal layout and
 * page share one lookup per request. Vitest resolves the client React build,
 * whose cache() is a passthrough, so a memoizing stub stands in for the
 * per-request scope (cleared between tests, as in current-user.test.ts).
 */

import { beforeEach, describe, expect, test, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ stores: [] as Map<string, unknown>[] }));

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
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("@/lib/portal/host", () => ({
  requestIsOnPortalHost: vi.fn(async () => true),
}));

import { requestIsOnPortalHost } from "@/lib/portal/host";
import { getPortalIdentity } from "./portal-access";

beforeEach(() => {
  vi.mocked(requestIsOnPortalHost).mockClear();
  for (const s of hoisted.stores) s.clear();
});

describe("getPortalIdentity request cache", () => {
  test("repeated calls in one request do one lookup", async () => {
    expect(await getPortalIdentity()).toBeNull();
    expect(await getPortalIdentity()).toBeNull();
    expect(requestIsOnPortalHost).toHaveBeenCalledTimes(1);
  });

  test("a new request looks up again", async () => {
    await getPortalIdentity();
    for (const s of hoisted.stores) s.clear();
    await getPortalIdentity();
    expect(requestIsOnPortalHost).toHaveBeenCalledTimes(2);
  });
});
