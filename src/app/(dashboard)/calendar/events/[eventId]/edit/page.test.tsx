/**
 * /calendar/events/[eventId]/edit — access guard on the edit form.
 *
 * getCalendarEventById() does NOT return null for events the viewer
 * can't see — it returns a scrubbed "Busy" placeholder so the modal
 * can render a busy block. If this page rendered that placeholder,
 * the form would be pre-filled with the scrubbed values and a save
 * would overwrite the real event's title/location/description/
 * attendees with "Busy"/nulls. These tests pin the guard: scrubbed
 * rows and viewers without events.edit both 404 before the form
 * mounts.
 *
 * updateEvent's own permission gate lives with the action's tests —
 * only the page's read-side plumbing is covered here.
 */

import { describe, expect, test, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CalendarEventDetail } from "@/lib/queries/calendar";

// `notFound()` in real Next throws to halt rendering — the mock must
// do the same or the page would fall through and render the form for
// a scrubbed event, masking exactly the bug this guards against.
const NOT_FOUND_SENTINEL = "TEST_NEXT_NOT_FOUND";
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error(NOT_FOUND_SENTINEL);
  }),
}));

vi.mock("@/lib/queries/calendar", () => ({
  getCalendarEventById: vi.fn(),
}));
vi.mock("@/lib/permission-check", () => ({
  currentUserHasPermission: vi.fn(),
}));

// Leaf components — we only care that the form receives the event's
// fields (i.e. that it mounted at all), not their markup.
vi.mock("@/components/layout/topbar", () => ({
  TopBar: ({ title }: { title: string }) => (
    <div data-testid="topbar" data-title={title} />
  ),
}));
vi.mock("@/components/calendar/edit-event-form", () => ({
  EditEventForm: ({ event }: { event: { id: string; title: string } }) => (
    <div data-testid="edit-form" data-event-id={event.id} data-title={event.title} />
  ),
}));

import { getCalendarEventById } from "@/lib/queries/calendar";
import { currentUserHasPermission } from "@/lib/permission-check";
import EditEventPage from "./page";

const mockedGetEvent = vi.mocked(getCalendarEventById);
const mockedHasPermission = vi.mocked(currentUserHasPermission);

const props = (eventId = "evt_1") =>
  ({
    params: Promise.resolve({ eventId }),
  }) as Parameters<typeof EditEventPage>[0];

/** A fully visible event, as the query returns it for authorized
 *  viewers. Override to build the scrubbed variant. */
const visibleEvent = (
  overrides: Partial<CalendarEventDetail> = {}
): CalendarEventDetail => ({
  id: "evt_1",
  title: "Deposition prep — Smith",
  type: "meeting",
  startTime: new Date("2026-07-06T15:00:00Z"),
  endTime: new Date("2026-07-06T16:00:00Z"),
  isAllDay: false,
  location: "Conf room B",
  description: "Bring the exhibit binder",
  zoomUrl: null,
  color: "var(--color-ink-3)",
  matter: null,
  attendees: [],
  viewerCanSeeDetails: true,
  visibility: "default",
  ...overrides,
});

/** The scrubbed shape getCalendarEventById returns when the viewer
 *  fails canViewEventDetails — mirrors src/lib/queries/calendar.ts. */
const scrubbedEvent = (): CalendarEventDetail =>
  visibleEvent({
    title: "Busy",
    type: "block_time",
    location: null,
    description: null,
    zoomUrl: null,
    matter: null,
    attendees: [],
    viewerCanSeeDetails: false,
  });

afterEach(() => {
  vi.clearAllMocks();
});

describe("EditEventPage — access guard", () => {
  test("scrubbed 'Busy' row 404s even when the viewer holds events.edit", async () => {
    mockedGetEvent.mockResolvedValue(scrubbedEvent());
    mockedHasPermission.mockResolvedValue(true);
    await expect(EditEventPage(props())).rejects.toThrow(NOT_FOUND_SENTINEL);
  });

  test("viewer without events.edit 404s even on a visible event", async () => {
    mockedGetEvent.mockResolvedValue(visibleEvent());
    mockedHasPermission.mockResolvedValue(false);
    await expect(EditEventPage(props())).rejects.toThrow(NOT_FOUND_SENTINEL);
    expect(mockedHasPermission).toHaveBeenCalledWith("events.edit");
  });

  test("missing event 404s", async () => {
    mockedGetEvent.mockResolvedValue(null);
    mockedHasPermission.mockResolvedValue(true);
    await expect(EditEventPage(props("evt_missing"))).rejects.toThrow(
      NOT_FOUND_SENTINEL
    );
  });

  test("visible event + events.edit renders the form with real values", async () => {
    mockedGetEvent.mockResolvedValue(visibleEvent());
    mockedHasPermission.mockResolvedValue(true);
    render(await EditEventPage(props()));
    const form = screen.getByTestId("edit-form");
    expect(form.dataset.eventId).toBe("evt_1");
    expect(form.dataset.title).toBe("Deposition prep — Smith");
  });
});
