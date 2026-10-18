/**
 * Matter request page: wall + records.view gate, then the shared body
 * with the matter scope and the URL's request id.
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
vi.mock("@/components/records-requests/request-detail-page", () => ({
  RequestDetailPage: () => null,
}));

import { currentUserHasPermission } from "@/lib/permission-check";
import { assertMatterAccess } from "@/lib/matter-access";
import { RequestDetailPage } from "@/components/records-requests/request-detail-page";
import MatterRecordsRequestPage from "./page";

const has = vi.mocked(currentUserHasPermission);

function body(node: ReactNode): React.ReactElement<Record<string, unknown>> {
  if (isValidElement(node)) {
    if (node.type === RequestDetailPage) return node as never;
    return body((node.props as { children?: ReactNode }).children);
  }
  throw new Error("RequestDetailPage not found");
}

const call = () =>
  MatterRecordsRequestPage({
    params: Promise.resolve({ id: "m1", requestId: "r9" }),
  } as never);

beforeEach(() => vi.clearAllMocks());

describe("MatterRecordsRequestPage", () => {
  test("404s without records.view, after the matter wall", async () => {
    has.mockResolvedValue(false);
    await expect(call()).rejects.toThrow("NOT_FOUND");
    expect(has).toHaveBeenCalledWith("records.view");
    expect(assertMatterAccess).toHaveBeenCalledWith("m1");
  });

  test("renders the body with the matter scope and request id", async () => {
    has.mockResolvedValue(true);
    const e = body(await call());
    expect(e.props).toMatchObject({
      scope: { kind: "matter", matterId: "m1" },
      requestId: "r9",
      writable: true,
    });
  });
});
