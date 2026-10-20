import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

vi.mock("@/app/actions/dashboard-prefs", () => ({
  saveDashboardLayout: vi.fn(),
}));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { toast } from "sonner";
import { saveDashboardLayout } from "@/app/actions/dashboard-prefs";
import {
  DASHBOARD_CARD_KEYS,
  DASHBOARD_CARDS,
  DEFAULT_LAYOUT,
  mergeLayout,
  moveCard,
  type DashboardCardKey,
  type DashboardLayout,
} from "@/lib/dashboard-prefs";
import { DashboardCustomizer, applyDragEnd } from "./customizer";

const mockedSave = vi.mocked(saveDashboardLayout);

const allCards = (): Partial<Record<DashboardCardKey, ReactNode>> =>
  Object.fromEntries(
    DASHBOARD_CARD_KEYS.map((k) => [
      k,
      <div key={k} data-testid={`body-${k}`}>
        {DASHBOARD_CARDS[k].label} body
      </div>,
    ])
  );

const fresh = (): DashboardLayout => mergeLayout(DEFAULT_LAYOUT);
const label = (k: DashboardCardKey) => DASHBOARD_CARDS[k].label;

function setup(
  opts: {
    layout?: DashboardLayout;
    cards?: Partial<Record<DashboardCardKey, ReactNode>>;
    unavailable?: DashboardCardKey[];
  } = {}
) {
  return render(
    <DashboardCustomizer
      initialLayout={opts.layout ?? fresh()}
      cards={opts.cards ?? allCards()}
      unavailable={opts.unavailable}
      greeting={<p>Hello</p>}
    />
  );
}

const arrange = () => screen.getByRole("region", { name: "Arrange cards" });
const zoneKeys = (name: string) =>
  within(within(arrange()).getByRole("group", { name }))
    .queryAllByRole("listitem")
    .map((li) => li.getAttribute("data-card"));
const customize = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: /customize/i }));
const toolbar = () =>
  screen.queryByRole("toolbar", { name: "Customize dashboard" });

beforeEach(() => {
  vi.clearAllMocks();
  mockedSave.mockImplementation(async (l) => l as DashboardLayout);
});

describe("applyDragEnd", () => {
  test("moves a card into the band at an index", () => {
    const out = applyDragEnd(fresh(), "deadlines", { zone: "band", index: 0 });
    expect(out.band).toEqual(["deadlines", "kpis"]);
    expect(out.columns[1]).toEqual(["pulse", "records"]);
  });

  test("reorders within one list using the post-removal index", () => {
    const out = applyDragEnd(fresh(), "agenda", { zone: 0, index: 2 });
    expect(out.columns[0]).toEqual(["tasks", "followUps", "agenda", "activity"]);
  });

  test("null over leaves the layout unchanged", () => {
    expect(applyDragEnd(fresh(), "agenda", null)).toEqual(fresh());
  });
});

describe("view mode", () => {
  test("renders band then columns with spans", () => {
    const { container } = setup();
    const cols = container.querySelectorAll("[data-column]");
    expect(cols).toHaveLength(2);
    expect(cols[0].className).toContain("lg:col-span-8");
    expect(cols[1].className).toContain("lg:col-span-4");
    expect(screen.getByTestId("body-kpis")).toBeTruthy();
    expect(toolbar()).toBeNull();
  });

  test("an empty band renders no wrapper", () => {
    const layout = moveCard(fresh(), "kpis", { zone: "hidden" });
    const { container } = setup({ layout });
    expect(container.querySelector("[data-band]")).toBeNull();
  });

  test("an empty column keeps its grid slot", () => {
    let layout = fresh();
    for (const k of layout.columns[0]) layout = moveCard(layout, k, { zone: "hidden" });
    const { container } = setup({ layout });
    const cols = container.querySelectorAll("[data-column]");
    expect(cols).toHaveLength(2);
    expect(cols[1].className).toContain("lg:col-span-4");
  });

  test("a card missing from `cards` renders nothing in view mode", () => {
    const cards = allCards();
    delete cards.pulse;
    setup({ cards });
    expect(screen.queryByTestId("body-pulse")).toBeNull();
  });
});

describe("edit mode", () => {
  test("hide then restore from tray", async () => {
    const user = userEvent.setup();
    setup();
    await customize(user);
    await user.click(
      within(arrange()).getByRole("button", { name: "Hide Firm pulse" })
    );
    expect(screen.getByText("Hidden (1)")).toBeTruthy();
    expect(zoneKeys("Column 2")).toEqual(["deadlines", "records"]);
    await user.click(screen.getByRole("button", { name: "Restore Firm pulse" }));
    expect(zoneKeys("Column 1").at(-1)).toBe("pulse");
    expect(screen.getByText("Hidden (0)")).toBeTruthy();
  });

  test("split change keeps every card", async () => {
    const user = userEvent.setup();
    setup();
    await customize(user);
    for (const name of ["4 / 4 / 4", "12", "8 / 4"]) {
      await user.click(screen.getByRole("radio", { name }));
      expect(within(arrange()).getAllByRole("listitem")).toHaveLength(8);
      const keys = within(arrange())
        .getAllByRole("listitem")
        .map((li) => li.getAttribute("data-card"));
      expect(new Set(keys).size).toBe(8);
    }
    expect(screen.getByRole("radio", { name: "8 / 4" }).getAttribute("aria-checked")).toBe("true");
  });

  test("Cancel restores the original", async () => {
    const user = userEvent.setup();
    setup();
    await customize(user);
    await user.click(
      within(arrange()).getByRole("button", { name: `Move ${label("tasks")} up` })
    );
    expect(zoneKeys("Column 1")[0]).toBe("tasks");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(toolbar()).toBeNull();
    expect(mockedSave).not.toHaveBeenCalled();
    await customize(user);
    expect(zoneKeys("Column 1")[0]).toBe("agenda");
  });

  test("Reset to default restores DEFAULT_LAYOUT", async () => {
    const user = userEvent.setup();
    setup({ layout: moveCard(fresh(), "tasks", { zone: "band" }) });
    await customize(user);
    await user.click(screen.getByRole("button", { name: "Reset to default" }));
    expect(zoneKeys("Band")).toEqual(["kpis"]);
  });

  test("zone select moves a card to the end of another zone", async () => {
    const user = userEvent.setup();
    setup();
    await customize(user);
    await user.selectOptions(
      within(arrange()).getByLabelText(`Zone for ${label("tasks")}`),
      "Band"
    );
    expect(zoneKeys("Band")).toEqual(["kpis", "tasks"]);
  });

  test("Done with no changes makes no call", async () => {
    const user = userEvent.setup();
    setup();
    await customize(user);
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(mockedSave).not.toHaveBeenCalled();
    expect(toolbar()).toBeNull();
  });

  test("Done saves once and refreshes", async () => {
    const user = userEvent.setup();
    setup();
    await customize(user);
    await user.click(
      within(arrange()).getByRole("button", { name: `Move ${label("tasks")} up` })
    );
    await user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(toolbar()).toBeNull());
    expect(mockedSave).toHaveBeenCalledTimes(1);
    expect(mockedSave).toHaveBeenCalledWith(
      moveCard(fresh(), "tasks", { zone: "column", index: 0 }, 0)
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("failed save keeps edits", async () => {
    const user = userEvent.setup();
    mockedSave.mockRejectedValue(new Error("boom"));
    setup();
    await customize(user);
    await user.click(
      within(arrange()).getByRole("button", { name: `Move ${label("tasks")} up` })
    );
    await user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't save your dashboard layout"));
    expect(toolbar()).toBeTruthy();
    expect(zoneKeys("Column 1")[0]).toBe("tasks");
    expect(refresh).not.toHaveBeenCalled();
  });

  test("Esc exits edit mode only when no drag is active", async () => {
    const user = userEvent.setup();
    const { container } = setup();
    await customize(user);
    const root = container.querySelector("[data-customizer]")!;
    root.setAttribute("data-dragging", "true");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(toolbar()).toBeTruthy();
    root.removeAttribute("data-dragging");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(toolbar()).toBeNull());
    expect(mockedSave).not.toHaveBeenCalled();
  });

  test("unpermitted card: nothing in view, a note in edit", async () => {
    const user = userEvent.setup();
    const cards = allCards();
    delete cards.pulse;
    setup({ cards, unavailable: ["pulse"] });
    expect(screen.queryByText("Firm pulse")).toBeNull();
    await customize(user);
    expect(screen.getAllByText("Not available for your role").length).toBeGreaterThan(0);
  });

  test("a restored card without data says it is shown after save", async () => {
    const user = userEvent.setup();
    const layout = moveCard(fresh(), "tasks", { zone: "hidden" });
    const cards = allCards();
    delete cards.tasks;
    setup({ layout, cards });
    await customize(user);
    await user.click(screen.getByRole("button", { name: "Restore Your tasks" }));
    expect(screen.getAllByText("Shown after you save").length).toBeGreaterThan(0);
  });
});
