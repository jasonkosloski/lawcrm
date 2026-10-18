/**
 * RecordsTab (server component): composer gating, status grouping and
 * the panel guard (a foreign ?request= id opens nothing).
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
  getRecordsRequestDetail: vi.fn(),
  listRecordsRequestTypes: vi.fn(async () => []),
}));
vi.mock("./new-request-composer", () => ({ NewRequestComposer: () => null }));
vi.mock("./request-detail-panel", () => ({ RequestDetailPanel: () => null }));
vi.mock("./request-row", () => ({ RequestRow: () => null }));

import { currentUserHasPermission } from "@/lib/permission-check";
import {
  getRecordsRequestDetail,
  getRecordsRequests,
} from "@/lib/queries/records-requests";
import { RecordsTab } from "./records-tab";
import { NewRequestComposer } from "./new-request-composer";
import { RequestDetailPanel } from "./request-detail-panel";
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
  vi.mocked(getRecordsRequestDetail).mockResolvedValue(null);
  vi.mocked(getRecordsRequests).mockResolvedValue([
    row("a", "complete"),
    row("b", "draft"),
    row("c", "draft"),
  ] as never);
});

describe("RecordsTab", () => {
  test("groups rows in status order and renders every row", async () => {
    const el = await RecordsTab({ scope: SCOPE, requestParam: null, writable: true });
    const rows = findAll(el, RequestRow) as { props: { row: { id: string } } }[];
    expect(rows.map((r) => r.props.row.id)).toEqual(["b", "c", "a"]);
  });

  test("composer needs writable and records.create", async () => {
    const on = await RecordsTab({ scope: SCOPE, requestParam: null, writable: true });
    expect(findAll(on, NewRequestComposer)).toHaveLength(1);
    const ro = await RecordsTab({ scope: SCOPE, requestParam: null, writable: false });
    expect(findAll(ro, NewRequestComposer)).toHaveLength(0);
    vi.mocked(currentUserHasPermission).mockImplementation(
      async (k: string) => k !== "records.create"
    );
    const denied = await RecordsTab({ scope: SCOPE, requestParam: null, writable: true });
    expect(findAll(denied, NewRequestComposer)).toHaveLength(0);
  });

  test("a foreign ?request= id opens no panel; a known one does", async () => {
    const none = await RecordsTab({ scope: SCOPE, requestParam: "foreign", writable: true });
    expect(getRecordsRequestDetail).toHaveBeenCalledWith(SCOPE, "foreign");
    expect(findAll(none, RequestDetailPanel)).toHaveLength(0);
    vi.mocked(getRecordsRequestDetail).mockResolvedValue({ id: "a", typeId: null } as never);
    const open = await RecordsTab({ scope: SCOPE, requestParam: "a", writable: true });
    expect(findAll(open, RequestDetailPanel)).toHaveLength(1);
  });

  test("lead scope shows the fee section without matters.expense.create", async () => {
    vi.mocked(getRecordsRequestDetail).mockResolvedValue({ id: "a", typeId: null } as never);
    vi.mocked(currentUserHasPermission).mockImplementation(
      async (k: string) => k !== "matters.expense.create"
    );
    const lead = await RecordsTab({
      scope: { kind: "lead", leadId: "l1" },
      requestParam: "a",
      writable: true,
    });
    const [panel] = findAll(lead, RequestDetailPanel) as { props: { can: { fee: boolean } } }[];
    expect(panel.props.can.fee).toBe(true);
    const matter = await RecordsTab({ scope: SCOPE, requestParam: "a", writable: true });
    const [mp] = findAll(matter, RequestDetailPanel) as { props: { can: { fee: boolean } } }[];
    expect(mp.props.can.fee).toBe(false);
  });
});
