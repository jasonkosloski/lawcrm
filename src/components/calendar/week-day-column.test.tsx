/**
 * Tests for the per-day grid cells (WeekAllDayCell / WeekTimeColumn).
 *
 * Pinned behaviours:
 *  - chip positions + labels follow the user's PROFILE zone (the
 *    provider), so server render and hydration agree;
 *  - Busy placeholders (details scrubbed) are never draggable or
 *    resizable, even for an events.edit holder;
 *  - a resize gesture keeps the same chip element (no Link <-> div
 *    swap that remounts the subtree);
 *  - all-day drops are date-only and keep a multi-day span;
 *  - dropping a chip on its own slot writes nothing.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { createEvent, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/calendar",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    title,
    style,
    className,
  }: React.ComponentProps<"a"> & { href: string; scroll?: boolean }) => (
    <a href={href} title={title} style={style} className={className}>
      {children}
    </a>
  ),
}));

import { UserTimeZoneProvider } from "@/components/user-time-zone";
import { HOUR_HEIGHT_PX } from "@/lib/calendar-utils";
import { parseDateOnly } from "@/lib/format-date";
import type { CalendarEventRow } from "@/lib/queries/calendar";
import { CALENDAR_EVENT_KIND, type CalendarEventDragData } from "./event-drag";
import { WeekAllDayCell, WeekTimeColumn } from "./week-day-column";

const TZ = "America/Denver";
/** Noon-UTC Date for the displayed day — `calendarWeekInTz` shape. */
const DAY = new Date("2026-07-07T12:00:00.000Z");

const event = (over: Partial<CalendarEventRow>): CalendarEventRow => ({
  id: "e1",
  kind: "event",
  title: "Deposition prep",
  type: "meeting",
  startTime: new Date("2026-07-07T15:00:00.000Z"), // 9:00 MDT
  endTime: new Date("2026-07-07T16:30:00.000Z"), // 10:30 MDT
  isAllDay: false,
  location: null,
  color: "#1e4f88",
  matterId: "m1",
  matterName: null,
  attendeeCount: 0,
  attendeeNames: [],
  viewerCanSeeDetails: true,
  ...over,
});

const move = vi.fn();

beforeEach(() => {
  move.mockReset();
});

function renderColumn(
  events: CalendarEventRow[],
  { canEdit = true, now = new Date("2026-07-01T12:00:00Z") } = {}
) {
  return render(
    <UserTimeZoneProvider timeZone={TZ}>
      <WeekTimeColumn
        day={DAY}
        now={now}
        events={events}
        canEdit={canEdit}
        move={move}
      />
    </UserTimeZoneProvider>
  );
}

function renderAllDay(events: CalendarEventRow[], canEdit = true) {
  return render(
    <UserTimeZoneProvider timeZone={TZ}>
      <WeekAllDayCell
        day={DAY}
        events={events}
        deadlines={[]}
        canEdit={canEdit}
        move={move}
      />
    </UserTimeZoneProvider>
  );
}

/** A DataTransfer stand-in carrying the calendar-event payload. */
function dropData(data: CalendarEventDragData) {
  const store: Record<string, string> = {
    "application/json": JSON.stringify(data),
    "application/x-lawcrm-dnd-kind": CALENDAR_EVENT_KIND,
  };
  return {
    types: Object.keys(store),
    getData: (k: string) => store[k] ?? "",
    setData: () => {},
    clearData: () => {},
    dropEffect: "move",
  };
}

const drag = (over: Partial<CalendarEventDragData>): CalendarEventDragData => ({
  id: "e1",
  isAllDay: false,
  startTimeIso: "2026-07-07T15:00:00.000Z",
  endTimeIso: "2026-07-07T16:30:00.000Z",
  grabOffsetY: 0,
  ...over,
});

describe("timed chips follow the user's zone", () => {
  test("a 9:00am MDT chip sits on the 9am row and is labelled 9:00am, whatever the runner's zone", () => {
    renderColumn([event({})]);
    const chip = screen.getByTitle("Deposition prep");
    expect(chip.style.top).toBe(`${3 * HOUR_HEIGHT_PX}px`);
    expect(chip).toHaveTextContent("9:00am – 10:30am");
  });

  test("the now-line lands on the viewer's hour", () => {
    // 2026-07-07T17:30Z = 11:30 MDT.
    const { container } = renderColumn([], {
      now: new Date("2026-07-07T17:30:00Z"),
    });
    const line = container.querySelector<HTMLElement>(
      "[aria-label='Current time']"
    )!.parentElement!.parentElement!;
    expect(line.style.top).toBe(`${5.5 * HOUR_HEIGHT_PX}px`);
  });

  test("a pre-6am event is clamped to the top of the grid, not drawn above it", () => {
    renderColumn([
      event({
        startTime: new Date("2026-07-07T11:30:00Z"), // 5:30 MDT
        endTime: new Date("2026-07-07T13:00:00Z"),
      }),
    ]);
    expect(screen.getByTitle("Deposition prep").style.top).toBe("0px");
  });
});

describe("editability", () => {
  test("an editable chip is a draggable button with resize handles", () => {
    renderColumn([event({})]);
    const chip = screen.getByTitle("Deposition prep");
    expect(chip.tagName).toBe("DIV");
    expect(chip).toHaveAttribute("draggable", "true");
    expect(screen.getByLabelText("Resize event start")).toBeInTheDocument();
    expect(screen.getByLabelText("Resize event end")).toBeInTheDocument();
  });

  test("a Busy placeholder is a plain link even for an editor", () => {
    renderColumn([event({ title: "Busy", viewerCanSeeDetails: false })]);
    const chip = screen.getByTitle("Busy");
    expect(chip.tagName).toBe("A");
    expect(chip).not.toHaveAttribute("draggable");
    expect(
      screen.queryByLabelText("Resize event start")
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Resize event end")).not.toBeInTheDocument();
  });

  test("a read-only viewer gets links and no handles", () => {
    renderColumn([event({})], { canEdit: false });
    expect(screen.getByTitle("Deposition prep").tagName).toBe("A");
    expect(
      screen.queryByLabelText("Resize event end")
    ).not.toBeInTheDocument();
  });

  test("a Busy all-day chip is not draggable", () => {
    renderAllDay([
      event({ title: "Busy", isAllDay: true, viewerCanSeeDetails: false }),
    ]);
    const chip = screen.getByTitle("All day: Busy");
    expect(chip.tagName).toBe("A");
  });

  test("starting a resize keeps the same chip element, with drag turned off", () => {
    renderColumn([event({})]);
    const before = screen.getByTitle("Deposition prep");
    fireEvent.mouseDown(screen.getByLabelText("Resize event end"), {
      clientY: 100,
    });
    const after = screen.getByTitle("Deposition prep");
    expect(after).toBe(before);
    expect(after.tagName).toBe("DIV");
    expect(after).toHaveAttribute("draggable", "false");
    // Handles survive the gesture (no subtree remount).
    expect(screen.getByLabelText("Resize event end")).toBeInTheDocument();
    fireEvent.mouseUp(document);
    expect(after).toHaveAttribute("draggable", "true");
    // Released without moving: nothing written.
    expect(move).not.toHaveBeenCalled();
  });

  test("resizing the bottom edge commits the snapped end", () => {
    renderColumn([event({})]);
    fireEvent.mouseDown(screen.getByLabelText("Resize event end"), {
      clientY: 100,
    });
    // +48px = +1 hour.
    fireEvent.mouseMove(document, { clientY: 148 });
    fireEvent.mouseUp(document);
    expect(move).toHaveBeenCalledTimes(1);
    const [id, schedule] = move.mock.calls[0]!;
    expect(id).toBe("e1");
    expect(schedule.isAllDay).toBe(false);
    expect(schedule.start.toISOString()).toBe("2026-07-07T15:00:00.000Z");
    expect(schedule.end.toISOString()).toBe("2026-07-07T17:30:00.000Z");
  });
});

describe("time-grid drop", () => {
  const dropAt = (data: CalendarEventDragData, clientY: number) => {
    const { container } = renderColumn([event({})]);
    const target = container.firstElementChild!;
    const ev = createEvent.drop(target, { dataTransfer: dropData(data) });
    // happy-dom's generic event init doesn't carry clientY.
    Object.defineProperty(ev, "clientY", { value: clientY });
    fireEvent(target, ev);
  };

  test("moves to the dropped slot in the user's zone, keeping duration", () => {
    dropAt(drag({}), 5 * HOUR_HEIGHT_PX); // 11:00 MDT
    expect(move).toHaveBeenCalledTimes(1);
    const [, schedule] = move.mock.calls[0]!;
    expect(schedule.start.toISOString()).toBe("2026-07-07T17:00:00.000Z");
    expect(schedule.end.toISOString()).toBe("2026-07-07T18:30:00.000Z");
  });

  test("dropping on the chip's own slot writes nothing", () => {
    dropAt(drag({}), 3 * HOUR_HEIGHT_PX);
    expect(move).not.toHaveBeenCalled();
  });
});

describe("all-day drop", () => {
  const allDayDrag = (start: string, end: string) =>
    drag({
      isAllDay: true,
      startTimeIso: parseDateOnly(start)!.toISOString(),
      endTimeIso: parseDateOnly(end)!.toISOString(),
    });

  const dropOnCell = (data: CalendarEventDragData) => {
    const { container } = renderAllDay([]);
    fireEvent.drop(container.firstElementChild!, {
      dataTransfer: dropData(data),
    });
  };

  test("stores the drop date as date-only UTC midnight, not browser-local midnight", () => {
    dropOnCell(allDayDrag("2026-07-05", "2026-07-05"));
    const [, schedule] = move.mock.calls[0]!;
    expect(schedule.isAllDay).toBe(true);
    expect(schedule.start.toISOString()).toBe("2026-07-07T00:00:00.000Z");
    expect(schedule.end.toISOString()).toBe("2026-07-07T00:00:00.000Z");
  });

  test("keeps a multi-day span (Jul 4-6 dropped on Jul 7 -> Jul 7-9)", () => {
    dropOnCell(allDayDrag("2026-07-04", "2026-07-06"));
    const [, schedule] = move.mock.calls[0]!;
    expect(schedule.start.toISOString()).toBe("2026-07-07T00:00:00.000Z");
    expect(schedule.end.toISOString()).toBe("2026-07-09T00:00:00.000Z");
  });

  test("dropping on the chip's own date writes nothing", () => {
    dropOnCell(allDayDrag("2026-07-07", "2026-07-07"));
    expect(move).not.toHaveBeenCalled();
  });

  test("a timed chip becomes a single all-day on the drop date", () => {
    dropOnCell(drag({}));
    const [, schedule] = move.mock.calls[0]!;
    expect(schedule.isAllDay).toBe(true);
    expect(schedule.start.toISOString()).toBe("2026-07-07T00:00:00.000Z");
    expect(schedule.end.toISOString()).toBe("2026-07-07T00:00:00.000Z");
  });
});
