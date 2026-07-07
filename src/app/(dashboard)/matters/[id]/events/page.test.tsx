/**
 * Matter Events page — ?event= gating.
 *
 * Two guards on the URL-driven event modal, both server-side (the
 * data must never reach the RSC payload — the modal declining to
 * render it doesn't help):
 *
 *   1. **Matter ownership** — the ?event= id must belong to THIS
 *      matter (validated against getMatterEvents, same guard the
 *      billing tab applies to ?invoice=). A foreign-matter id opens
 *      nothing and triggers zero detail fetches.
 *   2. **Visibility rules** — notes/time entries are fetched only
 *      AFTER getCalendarEventById resolves with
 *      viewerCanSeeDetails=true. getEventNotes/getEventTimeEntries
 *      carry no visibility check of their own, so fetching them in
 *      parallel would leak private-event contents.
 *
 * We do NOT re-test the visibility resolver itself (lives with
 * src/lib/queries/calendar) or the modal's internals — only the
 * page's fetch-ordering and ownership plumbing.
 */

import { describe, expect, test, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/queries/matters", () => ({
  getMatterById: vi.fn(),
}));
vi.mock("@/lib/queries/matter-detail", () => ({
  getMatterEvents: vi.fn(),
}));
vi.mock("@/lib/queries/calendar", () => ({
  getCalendarEventById: vi.fn(),
  getEventNotes: vi.fn(async () => []),
  getEventTimeEntries: vi.fn(async () => []),
}));

// Leaf client components — hooks/server-action wiring live with them.
// The modal stub echoes the event title so tests can assert presence.
vi.mock("@/components/calendar/event-detail-modal", () => ({
  EventDetailModal: ({ event }: { event: { title: string } }) => (
    <div data-testid="event-detail-modal">{event.title}</div>
  ),
}));
vi.mock("@/components/matters/captures/event-composer", () => ({
  EventComposer: () => null,
}));
vi.mock("@/components/matters/events/event-row-expandable", () => ({
  EventRowExpandable: () => <li data-testid="event-row" />,
}));

import { getMatterById } from "@/lib/queries/matters";
import { getMatterEvents } from "@/lib/queries/matter-detail";
import {
  getCalendarEventById,
  getEventNotes,
  getEventTimeEntries,
} from "@/lib/queries/calendar";
import type { CalendarEventDetail } from "@/lib/queries/calendar";
import type { MatterEventRow } from "@/lib/queries/matter-detail";
import MatterEventsPage from "./page";

const matterEvent: MatterEventRow = {
  id: "evt_ours",
  title: "Deposition prep",
  type: "meeting",
  startTime: new Date("2026-07-10T15:00:00Z"),
  endTime: new Date("2026-07-10T16:00:00Z"),
  isAllDay: false,
  location: null,
  zoomUrl: null,
  color: "var(--color-ink-3)",
  attendeeCount: 1,
  isUpcoming: true,
  notes: [],
  timeEntries: [],
};

const eventDetail = (
  over?: Partial<CalendarEventDetail>
): CalendarEventDetail => ({
  id: "evt_ours",
  title: "Deposition prep",
  type: "meeting",
  startTime: new Date("2026-07-10T15:00:00Z"),
  endTime: new Date("2026-07-10T16:00:00Z"),
  isAllDay: false,
  location: null,
  description: null,
  zoomUrl: null,
  color: "var(--color-ink-3)",
  matter: null,
  attendees: [],
  viewerCanSeeDetails: true,
  visibility: "default",
  ...over,
});

const renderPage = async (eventParam?: string) => {
  vi.mocked(getMatterById).mockResolvedValue({
    id: "m1",
    name: "Smith v. Jones",
  } as Awaited<ReturnType<typeof getMatterById>>);
  vi.mocked(getMatterEvents).mockResolvedValue([matterEvent]);
  render(
    await MatterEventsPage({
      params: Promise.resolve({ id: "m1" }),
      searchParams: Promise.resolve(
        eventParam ? { event: eventParam } : {}
      ),
    } as Parameters<typeof MatterEventsPage>[0])
  );
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("MatterEventsPage — ?event= matter-ownership guard", () => {
  test("foreign-matter event id: no modal, zero detail fetches", async () => {
    await renderPage("evt_other_matter");
    expect(screen.queryByTestId("event-detail-modal")).toBeNull();
    // The guard must short-circuit BEFORE any fetch — a parallel
    // fetch would already have shipped the data to the browser.
    expect(getCalendarEventById).not.toHaveBeenCalled();
    expect(getEventNotes).not.toHaveBeenCalled();
    expect(getEventTimeEntries).not.toHaveBeenCalled();
  });

  test("own-matter event id: modal renders with detail", async () => {
    vi.mocked(getCalendarEventById).mockResolvedValue(eventDetail());
    await renderPage("evt_ours");
    expect(getCalendarEventById).toHaveBeenCalledWith("evt_ours");
    expect(screen.getByTestId("event-detail-modal")).toBeTruthy();
    expect(screen.getByText("Deposition prep")).toBeTruthy();
  });
});

describe("MatterEventsPage — ?event= visibility gating", () => {
  test("viewer can see details — notes/time entries are fetched", async () => {
    vi.mocked(getCalendarEventById).mockResolvedValue(eventDetail());
    await renderPage("evt_ours");
    expect(getEventNotes).toHaveBeenCalledWith("evt_ours");
    expect(getEventTimeEntries).toHaveBeenCalledWith("evt_ours");
  });

  test("scrubbed 'Busy' event — notes/time entries are NOT fetched", async () => {
    vi.mocked(getCalendarEventById).mockResolvedValue(
      eventDetail({ title: "Busy", viewerCanSeeDetails: false })
    );
    await renderPage("evt_ours");
    // Modal still renders the Busy shell (same as calendar grid) …
    expect(screen.getByTestId("event-detail-modal")).toBeTruthy();
    expect(screen.getByText("Busy")).toBeTruthy();
    // … but the unguarded queries never run.
    expect(getEventNotes).not.toHaveBeenCalled();
    expect(getEventTimeEntries).not.toHaveBeenCalled();
  });

  test("event row vanished between list + detail fetch — no modal, no notes", async () => {
    vi.mocked(getCalendarEventById).mockResolvedValue(null);
    await renderPage("evt_ours");
    expect(screen.queryByTestId("event-detail-modal")).toBeNull();
    expect(getEventNotes).not.toHaveBeenCalled();
  });
});
