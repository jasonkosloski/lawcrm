/**
 * Matter Records page: wall + records.view gate, then the shared tab
 * with the matter scope.
 */

import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("@/lib/current-user", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/matter-access", () => ({ assertMatterAccess: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  currentUserHasPermission: vi.fn(),
}));
vi.mock("@/components/records-requests/records-tab", () => ({
  RecordsTab: () => null,
}));

import { currentUserHasPermission } from "@/lib/permission-check";
import { assertMatterAccess } from "@/lib/matter-access";
import { RecordsTab } from "@/components/records-requests/records-tab";
import MatterRecordsPage from "./page";

const has = vi.mocked(currentUserHasPermission);

function tab(node: ReactNode): React.ReactElement<Record<string, unknown>> {
  if (isValidElement(node)) {
    if (node.type === RecordsTab) return node as never;
    return tab((node.props as { children?: ReactNode }).children);
  }
  throw new Error("RecordsTab not found");
}

const call = (sp: Record<string, string | string[]> = {}) =>
  MatterRecordsPage({
    params: Promise.resolve({ id: "m1" }),
    searchParams: Promise.resolve(sp),
  } as never);

beforeEach(() => vi.clearAllMocks());

describe("MatterRecordsPage", () => {
  test("404s without records.view", async () => {
    has.mockResolvedValue(false);
    await expect(call()).rejects.toThrow("NOT_FOUND");
    expect(has).toHaveBeenCalledWith("records.view");
    expect(assertMatterAccess).toHaveBeenCalledWith("m1");
  });

  test("renders the tab with the matter scope and the ?request= param", async () => {
    has.mockResolvedValue(true);
    const e = tab(await call({ request: "r9" }));
    expect(e.props).toMatchObject({
      scope: { kind: "matter", matterId: "m1" },
      requestParam: "r9",
      writable: true,
    });
  });

  test("a missing or array ?request= is normalised", async () => {
    has.mockResolvedValue(true);
    const none = tab(await call());
    expect(none.props.requestParam).toBeNull();
    const arr = tab(await call({ request: ["a", "b"] }));
    expect(arr.props.requestParam).toBe("a");
  });
});
