/**
 * Matters list page — totalCount wiring.
 *
 * Pins the "showing N of M" denominator behavior:
 *   - no search active → the main list result is reused as the total
 *     (listMatters runs exactly once — no duplicate heavy query);
 *   - search active → a second listMatters runs with `q` stripped but
 *     every other filter preserved, so the denominator is the
 *     filtered-total, not the firm-wide total.
 *
 * UI children are stubbed to data-attribute shells — this test is about
 * the query wiring in the server component, not rendering.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { listMatters, getMattersFilterOptions } from "@/lib/queries/matters";
import type { MatterListRow } from "@/lib/queries/matters";
import type { MattersFilter } from "@/lib/matters-filters";
import MattersListPage from "./page";

vi.mock("@/lib/prisma", () => ({
  prisma: { matter: { count: vi.fn().mockResolvedValue(0) } },
}));
vi.mock("@/lib/queries/matters", () => ({
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
  test("no search → listMatters runs once and the list result doubles as the total", async () => {
    listMattersMock.mockResolvedValue([row("a"), row("b")]);

    await renderPage({});

    expect(listMattersMock).toHaveBeenCalledTimes(1);
    const toolbar = screen.getByTestId("toolbar");
    expect(toolbar.getAttribute("data-visible")).toBe("2");
    expect(toolbar.getAttribute("data-total")).toBe("2");
  });

  test("search active → total comes from a second query with q stripped", async () => {
    listMattersMock
      .mockResolvedValueOnce([row("a")]) // main list, q applied
      .mockResolvedValueOnce([row("a"), row("b"), row("c")]); // count, q stripped

    await renderPage({ q: "alvarez" });

    expect(listMattersMock).toHaveBeenCalledTimes(2);
    const toolbar = screen.getByTestId("toolbar");
    expect(toolbar.getAttribute("data-visible")).toBe("1");
    expect(toolbar.getAttribute("data-total")).toBe("3");
  });

  test("count query preserves every non-search filter", async () => {
    listMattersMock.mockResolvedValue([row("a")]);

    await renderPage({
      q: "alvarez",
      area: ["Civil Rights", "Family"],
      stage: "Discovery",
    });

    expect(listMattersMock).toHaveBeenCalledTimes(2);
    const countFilter = listMattersMock.mock.calls[1][0] as MattersFilter;
    expect(countFilter.q).toBe("");
    expect(countFilter.areas).toEqual(["Civil Rights", "Family"]);
    expect(countFilter.stages).toEqual(["Discovery"]);
  });
});
