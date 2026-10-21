/**
 * Matters list page — totalCount wiring.
 *
 * Pins the "showing N of M" denominator behavior:
 *   - the denominator comes from countMatters (DB-side count), never
 *     from a second listMatters round-trip — even with a search active
 *     the heavy list query runs exactly once;
 *   - countMatters receives the parsed filter as-is (it ignores `q`
 *     internally), so every non-search filter reaches the count.
 *
 * UI children are stubbed to data-attribute shells — this test is about
 * the query wiring in the server component, not rendering.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { currentUserHasPermission } from "@/lib/permission-check";
import {
  countMatters,
  listMatters,
  getMattersFilterOptions,
} from "@/lib/queries/matters";
import type { MatterListRow } from "@/lib/queries/matters";
import type { MattersFilter } from "@/lib/matters-filters";
import MattersListPage from "./page";

// Page auth guard (src/lib/current-user.ts) — session exists here.
vi.mock("@/lib/current-user", () => ({
  requireUser: vi.fn(async () => "user_1"),
}));
vi.mock("@/lib/matter-access", () => ({
  matterAccessWhere: vi.fn(async () => ({})),
}));
vi.mock("@/lib/permission-check", () => ({
  currentUserHasPermission: vi.fn(async () => true),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { matter: { count: vi.fn().mockResolvedValue(0) } },
}));
vi.mock("@/lib/queries/matters", () => ({
  countMatters: vi.fn(),
  listMatters: vi.fn(),
  LIST_MATTERS_SCAN_LIMIT: 5000,
  getMattersFilterOptions: vi.fn(),
}));
vi.mock("next/link", () => ({
  default: (props: React.ComponentProps<"a">) => <a {...props} />,
}));
vi.mock("@/components/layout/topbar", () => ({
  TopBar: ({
    title,
    actions,
  }: {
    title: string;
    actions?: React.ReactNode;
  }) => (
    <div>
      {title}
      {actions}
    </div>
  ),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children }: { children?: React.ReactNode }) => (
    <button>{children}</button>
  ),
}));
vi.mock("@/components/matters/matters-toolbar", () => ({
  MattersToolbar: (props: { visibleCount: number; totalCount: number }) => (
    <div
      data-testid="toolbar"
      data-visible={props.visibleCount}
      data-total={props.totalCount}
    />
  ),
}));
vi.mock("@/components/matters/matters-table", () => ({
  MattersTable: () => <div data-testid="table" />,
}));
vi.mock("@/components/matters/matters-kanban", () => ({
  MattersKanban: () => <div data-testid="kanban" />,
}));

const countMattersMock = vi.mocked(countMatters);
const listMattersMock = vi.mocked(listMatters);
const optionsMock = vi.mocked(getMattersFilterOptions);

// The page only reads `.length` off the rows; the table/kanban are
// stubbed, so a bare id stands in for the full row shape.
const row = (id: string) => ({ id }) as unknown as MatterListRow;
const pg = (
  rows: MatterListRow[],
  over: Partial<Awaited<ReturnType<typeof listMatters>>> = {}
) => ({
  rows,
  page: 1,
  pageCount: 1,
  total: rows.length,
  pageSize: 200,
  scanLimited: false,
  ...over,
});

/** Render the server component for the given URL search params. */
async function renderPage(sp: Record<string, string | string[]>) {
  const props = {
    searchParams: Promise.resolve(sp),
  } as Parameters<typeof MattersListPage>[0];
  render(await MattersListPage(props));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(currentUserHasPermission).mockResolvedValue(true);
  optionsMock.mockResolvedValue({
    areas: [],
    stages: [],
    billingTypes: [],
    leads: [],
  });
});

describe("New matter button — matters.create gate", () => {
  beforeEach(() => {
    listMattersMock.mockResolvedValue(pg([]));
    countMattersMock.mockResolvedValue(0);
  });

  test("shown to a viewer holding matters.create", async () => {
    vi.mocked(currentUserHasPermission).mockResolvedValue(true);
    await renderPage({});
    expect(currentUserHasPermission).toHaveBeenCalledWith("matters.create");
    expect(screen.getByText("New matter")).toBeTruthy();
  });

  test("hidden from a viewer without it (the form would bounce them to /)", async () => {
    vi.mocked(currentUserHasPermission).mockResolvedValue(false);
    await renderPage({});
    expect(screen.queryByText("New matter")).toBeNull();
  });
});

describe("totalCount denominator", () => {
  test("total comes from countMatters, not a second listMatters", async () => {
    listMattersMock.mockResolvedValue(pg([row("a"), row("b")]));
    countMattersMock.mockResolvedValue(7);

    await renderPage({});

    expect(listMattersMock).toHaveBeenCalledTimes(1);
    expect(countMattersMock).toHaveBeenCalledTimes(1);
    const toolbar = screen.getByTestId("toolbar");
    expect(toolbar.getAttribute("data-visible")).toBe("2");
    expect(toolbar.getAttribute("data-total")).toBe("7");
  });

  test("search active → still exactly one listMatters; count gets the filter", async () => {
    listMattersMock.mockResolvedValue(pg([row("a")]));
    countMattersMock.mockResolvedValue(3);

    await renderPage({ q: "alvarez" });

    expect(listMattersMock).toHaveBeenCalledTimes(1);
    const toolbar = screen.getByTestId("toolbar");
    expect(toolbar.getAttribute("data-visible")).toBe("1");
    expect(toolbar.getAttribute("data-total")).toBe("3");
  });

  test("countMatters receives every non-search filter", async () => {
    listMattersMock.mockResolvedValue(pg([row("a")]));
    countMattersMock.mockResolvedValue(1);

    await renderPage({
      q: "alvarez",
      area: ["Civil Rights", "Family"],
      stage: "Discovery",
    });

    expect(countMattersMock).toHaveBeenCalledTimes(1);
    const countFilter = countMattersMock.mock.calls[0][0] as MattersFilter;
    expect(countFilter.areas).toEqual(["Civil Rights", "Family"]);
    expect(countFilter.stages).toEqual(["Discovery"]);
  });
});

describe("paging (no silent truncation)", () => {
  beforeEach(() => countMattersMock.mockResolvedValue(450));

  test("?page= reaches listMatters", async () => {
    listMattersMock.mockResolvedValue(pg([row("a")], { page: 2, pageCount: 3, total: 450 }));
    await renderPage({ q: "smith", page: "2" });
    expect(listMattersMock.mock.calls[0][4]).toBe(2);
  });

  test("renders a pager that keeps the filters", async () => {
    listMattersMock.mockResolvedValue(pg([row("a")], { page: 2, pageCount: 3, total: 450 }));
    await renderPage({ q: "smith", area: ["A", "B"], page: "2" });
    expect(screen.getByText(/201–400 of 450/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Next/ }).getAttribute("href")).toBe(
      "/matters?q=smith&area=A&area=B&page=3"
    );
  });

  test("says so when the scan bound was hit", async () => {
    listMattersMock.mockResolvedValue(pg([row("a")], { scanLimited: true }));
    await renderPage({});
    expect(screen.getByRole("status").textContent).toMatch(/first 5000 of 450/);
  });

  test("no notice when the scan bound was not hit", async () => {
    listMattersMock.mockResolvedValue(pg([row("a")]));
    await renderPage({});
    expect(screen.queryByRole("status")).toBeNull();
  });
});
