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
import {
  countMatters,
  listMatters,
  getMattersFilterOptions,
} from "@/lib/queries/matters";
import type { MatterListRow } from "@/lib/queries/matters";
import type { MattersFilter } from "@/lib/matters-filters";
import MattersListPage from "./page";

vi.mock("@/lib/prisma", () => ({
  prisma: { matter: { count: vi.fn().mockResolvedValue(0) } },
}));
vi.mock("@/lib/queries/matters", () => ({
  countMatters: vi.fn(),
  listMatters: vi.fn(),
  getMattersFilterOptions: vi.fn(),
}));
vi.mock("next/link", () => ({
  default: (props: React.ComponentProps<"a">) => <a {...props} />,
}));
vi.mock("@/components/layout/topbar", () => ({
  TopBar: ({ title }: { title: string }) => <div>{title}</div>,
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

/** Render the server component for the given URL search params. */
async function renderPage(sp: Record<string, string | string[]>) {
  const props = {
    searchParams: Promise.resolve(sp),
  } as Parameters<typeof MattersListPage>[0];
  render(await MattersListPage(props));
}

beforeEach(() => {
  vi.clearAllMocks();
  optionsMock.mockResolvedValue({
    areas: [],
    stages: [],
    feeStructures: [],
    leads: [],
  });
});

describe("totalCount denominator", () => {
  test("total comes from countMatters, not a second listMatters", async () => {
    listMattersMock.mockResolvedValue([row("a"), row("b")]);
    countMattersMock.mockResolvedValue(7);

    await renderPage({});

    expect(listMattersMock).toHaveBeenCalledTimes(1);
    expect(countMattersMock).toHaveBeenCalledTimes(1);
    const toolbar = screen.getByTestId("toolbar");
    expect(toolbar.getAttribute("data-visible")).toBe("2");
    expect(toolbar.getAttribute("data-total")).toBe("7");
  });

  test("search active → still exactly one listMatters; count gets the filter", async () => {
    listMattersMock.mockResolvedValue([row("a")]);
    countMattersMock.mockResolvedValue(3);

    await renderPage({ q: "alvarez" });

    expect(listMattersMock).toHaveBeenCalledTimes(1);
    const toolbar = screen.getByTestId("toolbar");
    expect(toolbar.getAttribute("data-visible")).toBe("1");
    expect(toolbar.getAttribute("data-total")).toBe("3");
  });

  test("countMatters receives every non-search filter", async () => {
    listMattersMock.mockResolvedValue([row("a")]);
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
