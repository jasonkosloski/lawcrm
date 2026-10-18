/**
 * RequestDetailPage (server component): a foreign or missing request id
 * 404s; fee visibility and the permission-derived `can` flags match the
 * old Records-tab panel; lookups load only for editable viewers.
 */
import { isValidElement } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("@/lib/current-user-tz", () => ({
  getCurrentUserTimeZone: vi.fn(async () => "America/Denver"),
}));
vi.mock("@/lib/file-storage", () => ({ activeStorageDriver: () => "local" }));
vi.mock("@/lib/permission-check", () => ({ currentUserHasPermission: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: vi.fn(async () => []) },
    documentTemplate: { findMany: vi.fn(async () => []) },
    document: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock("@/lib/queries/records-requests", () => ({
  getRecordsRequestDetail: vi.fn(),
  listRecordsRequestTypes: vi.fn(async () => []),
}));
vi.mock("./request-detail", () => ({ RequestDetail: () => null }));

import { currentUserHasPermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import { getRecordsRequestDetail } from "@/lib/queries/records-requests";
import { RequestDetailPage } from "./request-detail-page";
import { RequestDetail } from "./request-detail";

const SCOPE = { kind: "matter", matterId: "m1" } as const;
const LEAD = { kind: "lead", leadId: "l1" } as const;

async function render(scope: typeof SCOPE | typeof LEAD, writable = true) {
  const el = await RequestDetailPage({ scope, requestId: "a", writable });
  if (!isValidElement(el) || el.type !== RequestDetail) throw new Error("no body");
  return el as React.ReactElement<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(currentUserHasPermission).mockResolvedValue(true);
  vi.mocked(getRecordsRequestDetail).mockResolvedValue({
    id: "a",
    typeId: null,
    responseDueDate: null,
  } as never);
});

describe("RequestDetailPage", () => {
  test("a foreign or missing id 404s", async () => {
    vi.mocked(getRecordsRequestDetail).mockResolvedValue(null);
    await expect(
      RequestDetailPage({ scope: SCOPE, requestId: "x", writable: true })
    ).rejects.toThrow("NOT_FOUND");
    expect(getRecordsRequestDetail).toHaveBeenCalledWith(SCOPE, "x", { includeFees: true });
  });

  test("matter fees need matters.expense.view; a lead always includes them", async () => {
    vi.mocked(currentUserHasPermission).mockImplementation(
      async (k: string) => k !== "matters.expense.view"
    );
    await render(SCOPE);
    expect(getRecordsRequestDetail).toHaveBeenLastCalledWith(SCOPE, "a", { includeFees: false });
    await render(LEAD);
    expect(getRecordsRequestDetail).toHaveBeenLastCalledWith(LEAD, "a", { includeFees: true });
  });

  test("the fee flag: lead needs only records.edit, matter also expense.create", async () => {
    vi.mocked(currentUserHasPermission).mockImplementation(
      async (k: string) => k !== "matters.expense.create"
    );
    expect((await render(LEAD)).props.can.fee).toBe(true);
    expect((await render(SCOPE)).props.can.fee).toBe(false);
  });

  test("the body is keyed by request id", async () => {
    expect((await render(SCOPE)).key).toBe("a");
  });

  test("lookups load only when the viewer can edit and the scope is writable", async () => {
    await render(SCOPE, false);
    expect(prisma.documentTemplate.findMany).not.toHaveBeenCalled();
    expect(prisma.document.findMany).not.toHaveBeenCalled();
    expect((await render(SCOPE, false)).props.can.edit).toBe(true);
    await render(SCOPE, true);
    expect(prisma.documentTemplate.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.document.findMany).toHaveBeenCalledTimes(1);
  });
});
