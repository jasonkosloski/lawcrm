/**
 * EventRowExpandable — "Busy" shell rows (events the viewer may not
 * see in detail) must expose no expand affordance, no notes / time
 * sections and no "open full view" link. The data is already scrubbed
 * server-side by getMatterEvents; this pins the UI side of that.
 */

import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/calendar/event-link", () => ({
  EventLink: ({ children }: { children: React.ReactNode }) => (
    <a data-testid="event-link">{children}</a>
  ),
}));
vi.mock("@/components/calendar/event-notes-section", () => ({
  EventNotesSection: () => <div data-testid="notes-section" />,
}));
vi.mock("@/components/calendar/event-time-entries-section", () => ({
  EventTimeEntriesSection: () => <div data-testid="time-section" />,
}));

import type { MatterEventRow } from "@/lib/queries/matter-detail";
import { EventRowExpandable } from "./event-row-expandable";

const base: MatterEventRow = {
  id: "e1",
  title: "Client prep call",
  type: "meeting",
  startTime: new Date("2026-07-10T15:00:00Z"),
  endTime: new Date("2026-07-10T16:00:00Z"),
  isAllDay: false,
  location: "Room 4",
  zoomUrl: null,
  color: "var(--color-ink-3)",
  attendeeCount: 2,
  isUpcoming: true,
  viewerCanSeeDetails: true,
  notes: [],
  timeEntries: [],
};

const busy: MatterEventRow = {
  ...base,
  title: "Busy",
  type: "block_time",
  location: null,
  attendeeCount: 0,
  viewerCanSeeDetails: false,
};

describe("EventRowExpandable", () => {
  test("visible event: expandable row with the full-view link", () => {
    render(
      <ul>
        <EventRowExpandable event={base} matterId="m1" matterName="Smith" />
      </ul>
    );
    expect(screen.getByText("Client prep call")).toBeTruthy();
    expect(screen.getByTestId("event-link")).toBeTruthy();
    expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe(
      "false"
    );
  });

  test("Busy shell: disabled row, no full-view link, no attachments sections", () => {
    render(
      <ul>
        <EventRowExpandable event={busy} matterId="m1" matterName="Smith" />
      </ul>
    );
    expect(screen.getByText("Busy")).toBeTruthy();
    expect(screen.queryByTestId("event-link")).toBeNull();
    expect(screen.queryByTestId("notes-section")).toBeNull();
    expect(screen.queryByTestId("time-section")).toBeNull();
    const button = screen.getByRole("button") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBeNull();
  });
});
