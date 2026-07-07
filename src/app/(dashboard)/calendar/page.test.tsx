/**
 * /calendar page — private-event data must not reach the RSC payload.
 *
 * getCalendarEventById scrubs private events to a "Busy" shell, but
 * getEventNotes / getEventTimeEntries have no visibility check of
 * their own. These tests pin the fix: the event-detail loader resolves
 * the event FIRST and only fetches notes/time entries when
 * `viewerCanSeeDetails` is true. The regression they guard against is
 * a parallel Promise.all that shipped note contents + time-entry
 * narratives for private events to the browser, relying on the modal
 * to merely not render them.
 *
 * We do NOT test the calendar grid itself here — week/month math is
 * covered in lib/calendar-utils.test.ts and the view components' own
 * tests. Only the loader's fetch gating.
 */

import { describe, expect, test, vi, afterEach } from "vitest";
import type { ReactElement } from "react";

vi.mock("@/lib/queries/calendar", () => ({
  getCalendarEventById: vi.fn(),
  getCalendarItems: vi.fn().mockResolvedValue([]),
  getCalendarSummary: vi
    .fn()
    .mockResolvedValue({ events: 0, deadlines: 0, criticalDeadlines: 0 }),
  getEventNotes: vi.fn().mockResolvedValue([]),
  getEventTimeEntries: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/permission-check", () => ({
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/current-user-tz", () => ({
  getCurrentUserTimeZone: vi.fn().mockResolvedValue("America/Denver"),
}));

// Leaf components — we only care about the element tree the page
// composes and the props the loader hands the modal, not markup.
vi.mock("@/components/layout/topbar", () => ({ TopBar: () => null }));
vi.mock("@/components/calendar/calendar-toolbar", () => ({
  CalendarToolbar: () => null,
}));
vi.mock("@/components/calendar/week-view", () => ({ WeekView: () => null }));
vi.mock("@/components/calendar/month-view", () => ({ MonthView: () => null }));
vi.mock("@/components/calendar/day-view", () => ({ DayView: () => null }));
vi.mock("@/components/calendar/calendar-agenda", () => ({
  CalendarAgenda: () => null,
}));
vi.mock("@/components/calendar/event-detail-modal", () => ({
  EventDetailModal: () => null,
}));
vi.mock("@/components/create-stack/create-stack-provider", () => ({
  CreateStackProvider: () => null,
}));
vi.mock("@/components/create-stack/create-dock", () => ({
  CreateDock: () => null,
}));
vi.mock("@/components/calendar/new-event-button", () => ({
  NewEventButton: () => null,
}));

import {
  getCalendarEventById,
  getEventNotes,
  getEventTimeEntries,
} from "@/lib/queries/calendar";
import { EventDetailModal } from "@/components/calendar/event-detail-modal";
import CalendarPage from "./page";

const mockedGetEvent = vi.mocked(getCalendarEventById);
const mockedGetNotes = vi.mocked(getEventNotes);
const mockedGetTimeEntries = vi.mocked(getEventTimeEntries);

/** Build the async searchParams prop Next 16 passes to pages. */
const props = (sp: Record<string, string | string[]>) =>
  ({ searchParams: Promise.resolve(sp) }) as Parameters<
    typeof CalendarPage
  >[0];

/** Minimal CalendarEventDetail — only the fields the loader reads. */
const eventDetail = (viewerCanSeeDetails: boolean) =>
  ({ id: "evt_1", title: "Hearing", viewerCanSeeDetails }) as Awaited<
    ReturnType<typeof getCalendarEventById>
  >;

type AnyElement = ReactElement<{ children?: unknown }>;

/**
 * Async server components can't be client-rendered by testing-library,
 * so we walk the page's returned element tree for the inline
 * EventDetailLoader element and invoke it directly. Matching by
 * function name is intentional — the loader isn't (and shouldn't be)
 * exported, since Next restricts page-file exports.
 */
function findLoader(node: unknown): AnyElement | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findLoader(child);
      if (found) return found;
    }
    return null;
  }
  const el = node as AnyElement;
  if (typeof el.type === "function" && el.type.name === "EventDetailLoader") {
    return el;
  }
  return findLoader(el.props?.children);
}

/** Render the page, then run its EventDetailLoader to completion. */
async function runLoader(sp: Record<string, string | string[]>) {
  const tree = await CalendarPage(props(sp));
  const loader = findLoader(tree);
  if (!loader) return { loader: null, output: null };
  const output = (await (loader.type as (p: unknown) => Promise<unknown>)(
    loader.props
  )) as AnyElement | null;
  return { loader, output };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("CalendarPage — event-detail loader visibility gating", () => {
  test("private event: notes/time entries are never fetched", async () => {
    mockedGetEvent.mockResolvedValue(eventDetail(false));
    const { output } = await runLoader({ event: "evt_1" });

    expect(mockedGetNotes).not.toHaveBeenCalled();
    expect(mockedGetTimeEntries).not.toHaveBeenCalled();

    // The modal still renders (the "Busy" shell) but with empty
    // sub-resources — nothing sensitive in the RSC payload.
    expect(output?.type).toBe(EventDetailModal);
    expect(output?.props).toMatchObject({ notes: [], timeEntries: [] });
  });

  test("visible event: notes/time entries fetched and passed through", async () => {
    mockedGetEvent.mockResolvedValue(eventDetail(true));
    const notes = [{ id: "note_1" }] as Awaited<
      ReturnType<typeof getEventNotes>
    >;
    const timeEntries = [{ id: "te_1" }] as Awaited<
      ReturnType<typeof getEventTimeEntries>
    >;
    mockedGetNotes.mockResolvedValue(notes);
    mockedGetTimeEntries.mockResolvedValue(timeEntries);

    const { output } = await runLoader({ event: "evt_1" });

    expect(mockedGetNotes).toHaveBeenCalledWith("evt_1");
    expect(mockedGetTimeEntries).toHaveBeenCalledWith("evt_1");
    expect(output?.props).toMatchObject({ notes, timeEntries });
  });

  test("missing event (URL tampering): loader returns null, no sub-fetches", async () => {
    mockedGetEvent.mockResolvedValue(null);
    const { loader, output } = await runLoader({ event: "evt_gone" });

    expect(loader).not.toBeNull();
    expect(output).toBeNull();
    expect(mockedGetNotes).not.toHaveBeenCalled();
    expect(mockedGetTimeEntries).not.toHaveBeenCalled();
  });

  test("no ?event= param: loader is not mounted at all", async () => {
    const { loader } = await runLoader({});
    expect(loader).toBeNull();
    expect(mockedGetEvent).not.toHaveBeenCalled();
  });
});
