/**
 * WeekView bucketing + all-day drag in a zone west of UTC.
 *
 * All-day events and deadlines are date-only values stored at UTC
 * midnight (ADR-012). Bucketing them through the viewer's zone puts
 * them a day early in America/Denver, which also made a dropped all-day
 * chip jump to the previous column.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

const { moveCalendarEvent } = vi.hoisted(() => ({
  moveCalendarEvent: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/app/actions/calendar-events", () => ({ moveCalendarEvent }));

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
  }: React.ComponentProps<"a"> & { href: string; scroll?: boolean }) => (
    <a href={href} title={title}>
      {children}
    </a>
  ),
}));

import { UserTimeZoneProvider } from "@/components/user-time-zone";
import { parseDateOnly } from "@/lib/format-date";
import type {
  CalendarDeadlineRow,
  CalendarEventRow,
} from "@/lib/queries/calendar";
import { CALENDAR_EVENT_KIND, type CalendarEventDragData } from "./event-drag";
import { WeekView } from "./week-view";

const TZ = "America/Denver";
// Sun Jul 12 .. Sat Jul 18 2026 as noon-UTC day dates.
const DAYS = Array.from(
  { length: 7 },
  (_, i) => new Date(Date.UTC(2026, 6, 12 + i, 12))
);

const allDay = (over: Partial<CalendarEventRow> = {}): CalendarEventRow => ({
  id: "e1",
  kind: "event",
  title: "Trial week",
  type: "meeting",
  startTime: parseDateOnly("2026-07-13")!,
  endTime: parseDateOnly("2026-07-13")!,
  isAllDay: true,
  location: null,
  color: "#1e4f88",
  matterId: "m1",
  matterName: null,
  attendeeCount: 0,
  attendeeNames: [],
  viewerCanSeeDetails: true,
  ...over,
});

const deadline: CalendarDeadlineRow = {
  id: "d1",
  kind: "deadline",
  title: "Answer due",
  dueDate: parseDateOnly("2026-07-14")!,
  deadlineKind: "critical",
  status: "pending",
  matterId: "m1",
  matterName: "Smith v. Jones",
};

function renderWeek(items: Parameters<typeof WeekView>[0]["items"]) {
  return render(
    <UserTimeZoneProvider timeZone={TZ}>
      <WeekView days={DAYS} items={items} canEditEvents userTz={TZ} />
    </UserTimeZoneProvider>
  );
}

/** Index (0 = Sunday) of the all-day column holding `text`. */
function allDayColumnOf(container: HTMLElement, text: string) {
  const label = screen.getByText("all-day");
  const cells = Array.from(label.parentElement!.children).slice(1);
  return cells.findIndex((c) => c.textContent?.includes(text));
}

beforeEach(() => moveCalendarEvent.mockClear());

describe("WeekView date-only bucketing (Denver)", () => {
  test("an all-day event stored at UTC midnight shows in its own column", () => {
    const { container } = renderWeek([allDay()]);
    // Monday Jul 13 = index 1. The zone-shifted read gave Sunday.
    expect(allDayColumnOf(container, "Trial week")).toBe(1);
  });

  test("a deadline shows on its due date, not the day before", () => {
    const { container } = renderWeek([deadline]);
    expect(allDayColumnOf(container, "Answer due")).toBe(2);
  });

  test("dropping an all-day chip on Wednesday keeps it in the Wednesday column", async () => {
    const { container } = renderWeek([allDay()]);
    const data: CalendarEventDragData = {
      id: "e1",
      isAllDay: true,
      startTimeIso: "2026-07-13T00:00:00.000Z",
      endTimeIso: "2026-07-13T00:00:00.000Z",
      grabOffsetY: 0,
    };
    const store: Record<string, string> = {
      "application/json": JSON.stringify(data),
      "application/x-lawcrm-dnd-kind": CALENDAR_EVENT_KIND,
    };
    const label = screen.getByText("all-day");
    const wednesday = label.parentElement!.children[4]!;
    await act(async () => {
      fireEvent.drop(wednesday, {
        dataTransfer: {
          types: Object.keys(store),
          getData: (k: string) => store[k] ?? "",
          setData: () => {},
          clearData: () => {},
          dropEffect: "move",
        },
      });
    });
    expect(moveCalendarEvent).toHaveBeenCalledWith(
      "e1",
      expect.objectContaining({
        isAllDay: true,
        startTime: "2026-07-15T00:00:00.000Z",
      })
    );
    expect(allDayColumnOf(container, "Trial week")).toBe(3);
  });
});
