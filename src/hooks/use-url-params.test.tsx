/**
 * useUrlParams — successive writes compose even though the committed
 * router URL has not updated yet (Next discards a pending navigation
 * when a newer one starts, so each write must carry the previous
 * writes' changes).
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const router = { replace: vi.fn() };
let search = "";

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(search),
}));

import { useUrlParams } from "./use-url-params";

beforeEach(() => {
  router.replace.mockReset();
  search = "";
});

function lastUrl(): string {
  const calls = router.replace.mock.calls;
  return calls[calls.length - 1][0] as string;
}

describe("useUrlParams", () => {
  test("a write builds on the committed URL", () => {
    search = "view=kanban";
    const { result } = renderHook(() => useUrlParams());
    act(() => result.current.setParams((p) => p.set("q", "alv")));
    expect(lastUrl()).toBe("?view=kanban&q=alv");
  });

  test("rapid writes before the first navigation commits do not overwrite each other", () => {
    const { result } = renderHook(() => useUrlParams());
    act(() => {
      result.current.setParams((p) => p.append("area", "1983"));
      // The committed URL is still empty here - the old code built this
      // second URL from it and dropped the first selection.
      result.current.setParams((p) => p.append("area", "Housing/FHA"));
    });
    expect(router.replace).toHaveBeenCalledTimes(2);
    const params = new URLSearchParams(lastUrl().slice(1));
    expect(params.getAll("area")).toEqual(["1983", "Housing/FHA"]);
  });

  test("mutate sees the in-flight params, so a cycle can advance on rapid clicks", () => {
    const { result } = renderHook(() => useUrlParams());
    let seen: string | null = "unset";
    act(() => {
      result.current.setParams((p) => p.set("sort", "name"));
      result.current.setParams((p) => {
        seen = p.get("sort");
      });
    });
    expect(seen).toBe("name");
  });

  test("after the navigation settles, an external URL change is the new base", () => {
    const { result, rerender } = renderHook(() => useUrlParams());
    act(() => result.current.setParams((p) => p.set("q", "old")));
    // Back button / link click lands somewhere else.
    search = "view=kanban";
    rerender();
    act(() => result.current.setParams((p) => p.set("trust", "has")));
    expect(lastUrl()).toBe("?view=kanban&trust=has");
  });

  test("a filter / sort write resets the list to page 1", () => {
    search = "q=alv&page=3";
    const { result } = renderHook(() => useUrlParams());
    act(() => result.current.setParams((p) => p.set("sort", "name")));
    expect(lastUrl()).toBe("?q=alv&sort=name");
  });
});
