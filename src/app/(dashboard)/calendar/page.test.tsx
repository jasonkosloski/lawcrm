/**
 * /calendar page — private-event data must not reach the RSC payload,
 * and the page derives what it shows from the rows it already has.
 *
 * getCalendarEventById scrubs private events to a "Busy" shell, but
 * getEventNotes / getEventTimeEntries have no visibility check of
 * their own. The first group pins the fix: the event-detail loader
 * resolves the event FIRST and only fetches notes/time entries when
 * `viewerCanSeeDetails` is true. The regression they guard against is
 * a parallel Promise.all that shipped note contents + time-entry
 * narratives for private events to the browser, relying on the modal
 * to merely not render them.
 *
 * The second group pins the per-event edit gate (the canEditEvent
 * resolver, not the blanket events.edit key) and that the crumb
 * counts come from the fetched items rather than extra COUNT queries.
 *
 * We do NOT test the calendar grid itself here — week/month math is
 * covered in lib/calendar-utils.test.ts and the view components' own
 * tests.
 */

import { describe, expect, test, vi, afterEach } from "vitest";
import type { ReactElement } from "react";

// Page auth guard (src/lib/current-user.ts) — session exists here.
vi.mock("@/lib/current-user", () => ({
  requireUser: vi.fn(async () => "user_1"),
}));
// No getCalendarSummary on purpose: the page must not call it any
// more (a call would throw "no export defined on the mock").
vi.mock("@/lib/queries/calendar", () => ({
  getCalendarEventById: vi.fn(),
  getCalendarItems: vi.fn().mockResolvedValue([]),
  getEventNotes: vi.fn().mockResolvedValue([]),
  getEventTimeEntries: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/queries/calendar-edit-flags", () => ({
  getEditableEventIds: vi.fn(async (ids: readonly string[]) => new Set<string>(ids)),
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
  getCalendarItems,
  getEventNotes,
  getEventTimeEntries,
} from "@/lib/queries/calendar";
import { getEditableEventIds } from "@/lib/queries/calendar-edit-flags";
import { currentUserHasPermission } from "@/lib/permission-check";
import { TopBar } from "@/components/layout/topbar";
import { WeekView } from "@/components/calendar/week-view";
import { MonthView } from "@/components/calendar/month-view";
import { CalendarAgenda } from "@/components/calendar/calendar-agenda";
import { EventDetailModal } from "@/components/calendar/event-detail-modal";
import { EventAttachmentsProvider } from "@/components/calendar/event-attachments-context";
import CalendarPage from "./page";

const mockedGetEvent = vi.mocked(getCalendarEventById);
const mockedGetItems = vi.mocked(getCalendarItems);
const mockedGetNotes = vi.mocked(getEventNotes);
const mockedGetTimeEntries = vi.mocked(getEventTimeEntries);
const mockedEditable = vi.mocked(getEditableEventIds);
const mockedHasPermission = vi.mocked(currentUserHasPermission);

/** Build the async searchParams prop Next 16 passes to pages. */
const props = (sp: Record<string, string | string[]>) =>
  ({ searchParams: Promise.resolve(sp) }) as Parameters<typeof CalendarPage>[0];

/** Minimal CalendarEventDetail — only the fields the loader reads. */
const eventDetail = (viewerCanSeeDetails: boolean) =>
  ({
    id: "evt_1",
    title: "Hearing",
    startTime: new Date("2026-07-07T15:00:00.000Z"),
    isAllDay: false,
    viewerCanSeeDetails,
  }) as Awaited<ReturnType<typeof getCalendarEventById>>;

type AnyElement = ReactElement<Record<string, unknown> & { children?: unknown }>;

/** Depth-first search of an element tree for the first element whose
 *  `type` satisfies `match`. */
function findElement(node: unknown, match: (el: AnyElement) => boolean): AnyElement | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, match);
      if (found) return found;
    }
    return null;
  }
  const el = node as AnyElement;
  if (match(el)) return el;
  return findElement(el.props?.children, match);
}

/**
 * Async server components can't be client-rendered by testing-library,
 * so we walk the page's returned element tree for the inline
 * EventDetailLoader element and invoke it directly. Matching by
 * function name is intentional — the loader isn't (and shouldn't be)
 * exported, since Next restricts page-file exports.
 */
const findLoader = (node: unknown) =>
  findElement(node, (el) => typeof el.type === "function" && el.type.name === "EventDetailLoader");

/** Render the page, then run its EventDetailLoader to completion. */
async function runLoader(sp: Record<string, string | string[]>) {
  const tree = await CalendarPage(props(sp));
  const loader = findLoader(tree);
  if (!loader) return { loader: null, output: null, modal: null };
  const output = (await (loader.type as (p: unknown) => Promise<unknown>)(
    loader.props,
  )) as AnyElement | null;
  // The visible-event path wraps the modal in the attachments
  // provider; the Busy shell renders it bare.
  const modal = findElement(output, (el) => el.type === EventDetailModal);
  return { loader, output, modal };
}

afterEach(() => {
  vi.clearAllMocks();
  mockedHasPermission.mockResolvedValue(true);
  mockedGetItems.mockResolvedValue([]);
  // Default: every id is editable (restores the factory behavior after
  // a test overrides it).
  mockedEditable.mockImplementation(async (ids: readonly string[]) => new Set<string>(ids));
});

describe("CalendarPage — event-detail loader visibility gating", () => {
  test("private event: notes/time entries are never fetched", async () => {
    mockedGetEvent.mockResolvedValue(eventDetail(false));
    const { modal } = await runLoader({ event: "evt_1" });

    expect(mockedGetNotes).not.toHaveBeenCalled();
    expect(mockedGetTimeEntries).not.toHaveBeenCalled();

    // The modal still renders (the "Busy" shell) but with empty
    // sub-resources — nothing sensitive in the RSC payload — and is
    // never editable.
    expect(modal?.props).toMatchObject({
      notes: [],
      timeEntries: [],
      canEdit: false,
    });
    expect(mockedEditable).not.toHaveBeenCalledWith(["evt_1"]);
  });

  test("visible event: notes/time entries fetched and passed through", async () => {
    mockedGetEvent.mockResolvedValue(eventDetail(true));
    const notes = [{ id: "note_1" }] as Awaited<ReturnType<typeof getEventNotes>>;
    const timeEntries = [{ id: "te_1" }] as Awaited<ReturnType<typeof getEventTimeEntries>>;
    mockedGetNotes.mockResolvedValue(notes);
    mockedGetTimeEntries.mockResolvedValue(timeEntries);

    const { modal } = await runLoader({ event: "evt_1" });

    expect(mockedGetNotes).toHaveBeenCalledWith("evt_1");
    expect(mockedGetTimeEntries).toHaveBeenCalledWith("evt_1");
    expect(modal?.props).toMatchObject({ notes, timeEntries });
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

describe("CalendarPage — per-event edit gate", () => {
  test("the modal's canEdit comes from the per-event resolver, not events.edit", async () => {
    mockedGetEvent.mockResolvedValue(eventDetail(true));
    // Viewer holds events.edit but is NOT allowed to edit this event
    // (e.g. a colleague's personal event).
    mockedHasPermission.mockResolvedValue(true);
    mockedEditable.mockResolvedValue(new Set());

    const { modal } = await runLoader({ event: "evt_1" });

    expect(mockedEditable).toHaveBeenCalledWith(["evt_1"]);
    expect(modal?.props.canEdit).toBe(false);
  });

  test("a creator without events.edit gets an editable modal", async () => {
    mockedGetEvent.mockResolvedValue(eventDetail(true));
    mockedHasPermission.mockResolvedValue(false);
    mockedEditable.mockResolvedValue(new Set(["evt_1"]));

    const { modal } = await runLoader({ event: "evt_1" });

    expect(modal?.props.canEdit).toBe(true);
  });

  test("the attachments provider carries the viewer's pin/delete permissions", async () => {
    mockedGetEvent.mockResolvedValue(eventDetail(true));
    mockedHasPermission.mockImplementation(async (key: string) => key === "notes.pin");

    const { output } = await runLoader({ event: "evt_1" });

    expect(output?.type).toBe(EventAttachmentsProvider);
    expect(output?.props).toMatchObject({
      viewerId: "user_1",
      canPinNotes: true,
      canDeleteAnyNote: false,
      canDeleteAnyTimeEntry: false,
      // 2026-07-07T15:00Z is 9:00 AM that day in Denver.
      defaultTimeEntryDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
  });

  test("only visible (non-Busy) events are checked and passed to the week view", async () => {
    mockedGetItems.mockResolvedValue([
      { id: "e_mine", kind: "event", viewerCanSeeDetails: true },
      { id: "e_busy", kind: "event", viewerCanSeeDetails: false },
      { id: "d_1", kind: "deadline", deadlineKind: "manual" },
    ] as Awaited<ReturnType<typeof getCalendarItems>>);
    mockedEditable.mockResolvedValueOnce(new Set(["e_mine"]));

    const tree = await CalendarPage(props({ view: "week" }));

    expect(mockedEditable).toHaveBeenCalledWith(["e_mine"]);
    const week = findElement(tree, (el) => el.type === WeekView);
    expect(week?.props.editableEventIds).toEqual(["e_mine"]);
    expect(week?.props.canEditEvents).toBe(true);
  });

  test("a viewer who can edit nothing gets no drag affordance", async () => {
    mockedGetItems.mockResolvedValue([
      { id: "e_other", kind: "event", viewerCanSeeDetails: true },
    ] as Awaited<ReturnType<typeof getCalendarItems>>);
    mockedEditable.mockResolvedValueOnce(new Set());

    const tree = await CalendarPage(props({ view: "week" }));

    const week = findElement(tree, (el) => el.type === WeekView);
    expect(week?.props.canEditEvents).toBe(false);
    expect(week?.props.editableEventIds).toEqual([]);
  });
});

describe("CalendarPage — derived data", () => {
  test("crumb counts come from the fetched items (no summary queries)", async () => {
    mockedGetItems.mockResolvedValue([
      { id: "e1", kind: "event", viewerCanSeeDetails: true },
      { id: "e2", kind: "event", viewerCanSeeDetails: false },
      { id: "d1", kind: "deadline", deadlineKind: "critical" },
      { id: "d2", kind: "deadline", deadlineKind: "auto_rule" },
      { id: "d3", kind: "deadline", deadlineKind: "critical" },
    ] as Awaited<ReturnType<typeof getCalendarItems>>);

    const tree = await CalendarPage(props({}));

    const topBar = findElement(tree, (el) => el.type === TopBar);
    expect(topBar?.props.crumbs).toBe("2 events · 3 deadlines · 2 critical");
    // One range fetch for the grid; the agenda fetches its own range
    // inside CalendarAgenda (mocked here).
    expect(mockedGetItems).toHaveBeenCalledTimes(1);
  });

  test("the crumb ignores the ?show=deadlines filter", async () => {
    mockedGetItems.mockResolvedValue([
      { id: "e1", kind: "event", viewerCanSeeDetails: true },
      { id: "d1", kind: "deadline", deadlineKind: "manual" },
    ] as Awaited<ReturnType<typeof getCalendarItems>>);

    const tree = await CalendarPage(props({ show: "deadlines" }));

    const topBar = findElement(tree, (el) => el.type === TopBar);
    expect(topBar?.props.crumbs).toBe("1 events · 1 deadlines");
  });

  test("the agenda receives the already-resolved time zone", async () => {
    const tree = await CalendarPage(props({}));
    const agenda = findElement(tree, (el) => el.type === CalendarAgenda);
    expect(agenda?.props.userTz).toBe("America/Denver");
  });

  test("month view gets the focal month as a key, not a Date", async () => {
    // The focal on the 1st is exactly the case the old Date-based
    // month check got wrong for west-of-UTC viewers.
    const tree = await CalendarPage(props({ view: "month", d: "2026-08-01" }));
    const month = findElement(tree, (el) => el.type === MonthView);
    expect(month?.props.focalKey).toBe("2026-08-01");
  });
});
