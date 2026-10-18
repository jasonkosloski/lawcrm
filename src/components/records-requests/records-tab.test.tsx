/**
 * RecordsTab (server component): composer gating and status grouping.
 * The request detail lives on its own page now, so the tab loads none.
 */
import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn(async () => "u1") }));
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
  getRecordsRequests: vi.fn(),
  listRecordsRequestTypes: vi.fn(async () => []),
}));
vi.mock("./new-request-composer", () => ({ NewRequestComposer: () => null }));
vi.mock("./request-row", () => ({ RequestRow: () => null }));

import { currentUserHasPermission } from "@/lib/permission-check";
import { getRecordsRequests } from "@/lib/queries/records-requests";
import { RecordsTab } from "./records-tab";
import { NewRequestComposer } from "./new-request-composer";
import { RequestRow } from "./request-row";

function findAll(node: ReactNode, type: unknown, out: unknown[] = []) {
  if (Array.isArray(node)) node.forEach((n) => findAll(n, type, out));
  else if (isValidElement(node)) {
    if (node.type === type) out.push(node);
    findAll((node.props as { children?: ReactNode }).children, type, out);
  }
  return out;
}

const SCOPE = { kind: "matter", matterId: "m1" } as const;
const row = (id: string, status: string) => ({ id, status });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(currentUserHasPermission).mockResolvedValue(true);
  vi.mocked(getRecordsRequests).mockResolvedValue([
    row("a", "complete"),
    row("b", "draft"),
    row("c", "draft"),
  ] as never);
});

describe("RecordsTab", () => {
  test("groups rows in status order and renders every row", async () => {
    const el = await RecordsTab({ scope: SCOPE, writable: true });
    const rows = findAll(el, RequestRow) as { props: { row: { id: string } } }[];
    expect(rows.map((r) => r.props.row.id)).toEqual(["b", "c", "a"]);
  });

  test("composer needs writable and records.create", async () => {
    const on = await RecordsTab({ scope: SCOPE, writable: true });
    expect(findAll(on, NewRequestComposer)).toHaveLength(1);
    const ro = await RecordsTab({ scope: SCOPE, writable: false });
    expect(findAll(ro, NewRequestComposer)).toHaveLength(0);
    vi.mocked(currentUserHasPermission).mockImplementation(
      async (k: string) => k !== "records.create"
    );
    const denied = await RecordsTab({ scope: SCOPE, writable: true });
    expect(findAll(denied, NewRequestComposer)).toHaveLength(0);
  });

  test("loads only the list: no per-request detail or lookups", async () => {
    const { prisma } = await import("@/lib/prisma");
    await RecordsTab({ scope: SCOPE, writable: false });
    expect(prisma.documentTemplate.findMany).not.toHaveBeenCalled();
    expect(prisma.document.findMany).not.toHaveBeenCalled();
  });

  test("matter fees are requested only with matters.expense.view", async () => {
    vi.mocked(currentUserHasPermission).mockImplementation(
      async (k: string) => k !== "matters.expense.view"
    );
    await RecordsTab({ scope: SCOPE, writable: true });
    expect(getRecordsRequests).toHaveBeenLastCalledWith(SCOPE, "America/Denver", { includeFees: false });
    vi.mocked(currentUserHasPermission).mockResolvedValue(true);
    await RecordsTab({ scope: SCOPE, writable: true });
    expect(getRecordsRequests).toHaveBeenLastCalledWith(SCOPE, "America/Denver", { includeFees: true });
  });

  test("a lead always includes fees", async () => {
    vi.mocked(currentUserHasPermission).mockImplementation(
      async (k: string) => k !== "matters.expense.view"
    );
    const lead = { kind: "lead", leadId: "l1" } as const;
    await RecordsTab({ scope: lead, writable: true });
    expect(getRecordsRequests).toHaveBeenLastCalledWith(lead, "America/Denver", { includeFees: true });
  });
});
