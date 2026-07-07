/**
 * Tests for the dashboard customize panel (v2: order arrows).
 *
 * What's pinned here:
 *   - rows render grouped by column, in pref order, with hidden
 *     cards still listed (ordered-while-hidden contract);
 *   - arrows are disabled at each column's edges;
 *   - clicking an arrow optimistically reorders AND sends the full
 *     desired order to `setDashboardCardOrder`;
 *   - a failed save rolls the order back;
 *   - the v1 checkbox toggle still wires to `setDashboardCardVisible`.
 *
 * The panel is rendered directly (not through the Popover) — the
 * component exports `DashboardCustomizePanel` for exactly this.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/actions/dashboard-prefs", () => ({
  setDashboardCardVisible: vi.fn(),
  setDashboardCardOrder: vi.fn(),
}));

import {
  setDashboardCardOrder,
  setDashboardCardVisible,
} from "@/app/actions/dashboard-prefs";
import { mergePrefs, mergeOrder } from "@/lib/dashboard-prefs";
import { DashboardCustomizePanel } from "./customize-button";

const mockedSetOrder = vi.mocked(setDashboardCardOrder);
const mockedSetVisible = vi.mocked(setDashboardCardVisible);

beforeEach(() => {
  vi.clearAllMocks();
  // Default happy path: echo back whatever the client sent.
  mockedSetOrder.mockImplementation(async (order) => mergeOrder({ order }));
  mockedSetVisible.mockImplementation(async () =>
    mergePrefs(null).visible
  );
});

/** Card labels in on-screen order (both columns, top to bottom). */
function labelTexts(): string[] {
  return screen
    .getAllByRole("checkbox")
    .map((cb) => cb.closest("label")?.textContent?.trim() ?? "");
}

describe("DashboardCustomizePanel — rendering", () => {
  test("renders every card grouped under its column header", () => {
    render(<DashboardCustomizePanel initialPrefs={mergePrefs(null)} />);
    expect(screen.getByText("Main column")).toBeInTheDocument();
    expect(screen.getByText("Right rail")).toBeInTheDocument();
    expect(labelTexts()).toEqual([
      "KPI tiles",
      "Today's agenda",
      "Your tasks",
      "Follow up today",
      "Recent activity",
      "Deadlines this week",
      "Firm pulse",
    ]);
  });

  test("hidden cards still render a row with active arrows (ordered-while-hidden)", () => {
    render(
      <DashboardCustomizePanel
        initialPrefs={mergePrefs({ visible: { agenda: false } })}
      />
    );
    // Row is present, checkbox unchecked, and its arrows still work.
    expect(screen.getByText("Today's agenda")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Move Today's agenda up" })
    ).toBeEnabled();
  });

  test("arrows are disabled at column edges only", () => {
    render(<DashboardCustomizePanel initialPrefs={mergePrefs(null)} />);
    // Main column: kpis is first, activity is last.
    expect(
      screen.getByRole("button", { name: "Move KPI tiles up" })
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move KPI tiles down" })
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Move Recent activity down" })
    ).toBeDisabled();
    // Rail: deadlines first, pulse last — edges independent of main.
    expect(
      screen.getByRole("button", { name: "Move Deadlines this week up" })
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move Firm pulse down" })
    ).toBeDisabled();
  });
});

describe("DashboardCustomizePanel — reordering", () => {
  test("down arrow swaps with the next card and persists the full order", async () => {
    const user = userEvent.setup();
    render(<DashboardCustomizePanel initialPrefs={mergePrefs(null)} />);

    await user.click(
      screen.getByRole("button", { name: "Move KPI tiles down" })
    );

    // Optimistic: agenda now renders above kpis.
    expect(labelTexts().slice(0, 2)).toEqual(["Today's agenda", "KPI tiles"]);
    await waitFor(() => {
      expect(mockedSetOrder).toHaveBeenCalledWith([
        "agenda",
        "kpis",
        "tasks",
        "followUps",
        "activity",
        "deadlines",
        "pulse",
      ]);
    });
  });

  test("rail moves don't touch main-column order", async () => {
    const user = userEvent.setup();
    render(<DashboardCustomizePanel initialPrefs={mergePrefs(null)} />);

    await user.click(
      screen.getByRole("button", { name: "Move Firm pulse up" })
    );

    await waitFor(() => {
      expect(mockedSetOrder).toHaveBeenCalledWith([
        "kpis",
        "agenda",
        "tasks",
        "followUps",
        "activity",
        "pulse",
        "deadlines",
      ]);
    });
    expect(labelTexts().slice(0, 5)).toEqual([
      "KPI tiles",
      "Today's agenda",
      "Your tasks",
      "Follow up today",
      "Recent activity",
    ]);
  });

  test("failed save rolls the order back", async () => {
    const user = userEvent.setup();
    mockedSetOrder.mockRejectedValue(new Error("boom"));
    render(<DashboardCustomizePanel initialPrefs={mergePrefs(null)} />);

    await user.click(
      screen.getByRole("button", { name: "Move KPI tiles down" })
    );

    await waitFor(() => {
      expect(labelTexts()[0]).toBe("KPI tiles");
    });
  });
});

describe("DashboardCustomizePanel — visibility (v1 regression)", () => {
  test("checkbox toggle calls setDashboardCardVisible with the right args", async () => {
    const user = userEvent.setup();
    render(<DashboardCustomizePanel initialPrefs={mergePrefs(null)} />);

    const row = screen.getByText("Recent activity").closest("label")!;
    await user.click(within(row).getByRole("checkbox"));

    await waitFor(() => {
      expect(mockedSetVisible).toHaveBeenCalledWith("activity", false);
    });
  });
});
