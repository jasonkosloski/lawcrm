/**
 * /calendar/events/new — access guard + option plumbing.
 *
 * Mirrors the edit page's guard tests: a viewer without
 * events.create must 404 before the form mounts (the action gates
 * the write regardless — this pins the read-side UX so we never
 * render a form whose submit is guaranteed to fail). With the
 * permission, the page fetches the open-matter options and hands
 * them to the form.
 */

import { describe, expect, test, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { FilingMatterOption } from "@/lib/queries/communication";

const NOT_FOUND_SENTINEL = "TEST_NEXT_NOT_FOUND";
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error(NOT_FOUND_SENTINEL);
  }),
}));

vi.mock("@/lib/permission-check", () => ({
  currentUserHasPermission: vi.fn(),
}));
vi.mock("@/lib/queries/communication", () => ({
  getFilingMatterOptions: vi.fn(),
}));

// Leaf components — we only assert the form mounted with the
// fetched options, not its markup.
vi.mock("@/components/layout/topbar", () => ({
  TopBar: ({ title }: { title: string }) => (
    <div data-testid="topbar" data-title={title} />
  ),
}));
vi.mock("@/components/calendar/new-event-form", () => ({
  NewEventForm: ({ matters }: { matters: FilingMatterOption[] }) => (
    <div data-testid="new-form" data-matter-count={matters.length} />
  ),
}));

import { currentUserHasPermission } from "@/lib/permission-check";
import { getFilingMatterOptions } from "@/lib/queries/communication";
import NewEventPage from "./page";

const mockedHasPermission = vi.mocked(currentUserHasPermission);
const mockedGetMatters = vi.mocked(getFilingMatterOptions);

const matterOption = (id: string): FilingMatterOption => ({
  id,
  name: `Matter ${id}`,
  color: "#123456",
  area: "PI",
  isPinned: false,
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("NewEventPage — access guard", () => {
  test("viewer without events.create 404s before any fetch", async () => {
    mockedHasPermission.mockResolvedValue(false);
    await expect(NewEventPage()).rejects.toThrow(NOT_FOUND_SENTINEL);
    expect(mockedHasPermission).toHaveBeenCalledWith("events.create");
    expect(mockedGetMatters).not.toHaveBeenCalled();
  });

  test("viewer with events.create gets the form + matter options", async () => {
    mockedHasPermission.mockResolvedValue(true);
    mockedGetMatters.mockResolvedValue([
      matterOption("m1"),
      matterOption("m2"),
    ]);
    render(await NewEventPage());
    const form = screen.getByTestId("new-form");
    expect(form.dataset.matterCount).toBe("2");
  });
});
