/**
 * Tests for DayView — the single-day focus mode.
 *
 * Two layers, matching the sibling precedent (month-view tests the
 * pure helper; event-detail-modal renders with testing-library):
 *
 *   1. `bucketDayItems` — the pure user-TZ bucketing that decides
 *      what the day shows. The case worth pinning: a "late
 *      Monday night in Denver" event is Tuesday in UTC — it must
 *      land on the user's Monday, and an event on a neighboring
 *      day (possible after an optimistic move) must NOT render.
 *
 *   2. A render pass asserting the three sections compose: timed
 *      event chip (with its richer location/matter lines), the
 *      all-day chip, and the full deadline pill with matter name +
 *      critical tag. Time-label text is NOT asserted — chip time
 *      formatting is browser-local by design and would couple the
 *      test to the runner's TZ.
 */

import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type {
  CalendarEventRow,
  CalendarDeadlineRow,
} from "@/lib/queries/calendar";

const { searchParams } = vi.hoisted(() => ({
  searchParams: new URLSearchParams("view=day&d=2026-07-07"),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/calendar",
  useSearchParams: () => searchParams,
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
    title,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
    title?: string;
  }) => (
    <a href={href} className={className} title={title}>
      {children}
    </a>
  ),
}));

vi.mock("@/app/actions/calendar-events", () => ({
  moveCalendarEvent: vi.fn(async () => ({ ok: true as const })),
}));

import { parseDateOnly } from "@/lib/format-date";
import { bucketDayItems, DayView } from "./day-view";

const TZ = "America/Denver";
/** Noon-UTC Date for the displayed day — `calendarDayInTz` shape. */
const DAY = new Date("2026-07-07T12:00:00.000Z");
const DAY_KEY = "2026-07-07";

const event = (over: Partial<CalendarEventRow>): CalendarEventRow => ({
  id: "e1",
  kind: "event",
  title: "Deposition prep",
  type: "meeting",
  startTime: new Date("2026-07-07T15:00:00.000Z"), // 9:00am MDT
  endTime: new Date("2026-07-07T16:30:00.000Z"), // 10:30am MDT
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

const deadline = (over: Partial<CalendarDeadlineRow>): CalendarDeadlineRow => ({
  id: "d1",
  kind: "deadline",
  title: "Answer due",
  dueDate: new Date("2026-07-07T18:00:00.000Z"),
  deadlineKind: "critical",
  status: "pending",
  matterId: "m1",
  matterName: "Smith v. Jones",
  ...over,
});

describe("bucketDayItems", () => {
  test("splits a day's items into all-day / timed / deadlines", () => {
    const result = bucketDayItems(
      [
        event({ id: "timed" }),
        event({ id: "allday", isAllDay: true }),
        deadline({ id: "dl" }),
      ],
      DAY_KEY,
      TZ
    );
    expect(result.timedEvents.map((e) => e.id)).toEqual(["timed"]);
    expect(result.allDayEvents.map((e) => e.id)).toEqual(["allday"]);
    expect(result.deadlines.map((d) => d.id)).toEqual(["dl"]);
  });

  test("buckets by the USER-tz calendar day, not UTC", () => {
    // 10:30pm July 7 in Denver is 04:30Z July 8 — still the 7th
    // for the user.
    const lateNight = event({
      id: "late",
      startTime: new Date("2026-07-08T04:30:00.000Z"),
      endTime: new Date("2026-07-08T05:00:00.000Z"),
    });
    const result = bucketDayItems([lateNight], DAY_KEY, TZ);
    expect(result.timedEvents.map((e) => e.id)).toEqual(["late"]);
    // Same instants viewed from Tokyo are July 8 — excluded.
    expect(
      bucketDayItems([lateNight], DAY_KEY, "Asia/Tokyo").timedEvents
    ).toEqual([]);
  });

  test("excludes items on neighboring days (e.g. after an optimistic move)", () => {
    const moved = event({
      id: "moved",
      startTime: new Date("2026-07-08T15:00:00.000Z"),
      endTime: new Date("2026-07-08T16:00:00.000Z"),
    });
    const result = bucketDayItems([moved, deadline({ id: "dl" })], DAY_KEY, TZ);
    expect(result.timedEvents).toEqual([]);
    expect(result.deadlines).toHaveLength(1);
  });

  test("orders timed events by start and deadlines critical-first", () => {
    const result = bucketDayItems(
      [
        event({ id: "later", startTime: new Date("2026-07-07T20:00:00.000Z"), endTime: new Date("2026-07-07T21:00:00.000Z") }),
        event({ id: "earlier" }),
        deadline({ id: "manual", deadlineKind: "manual" }),
        deadline({ id: "crit", deadlineKind: "critical" }),
      ],
      DAY_KEY,
      TZ
    );
    expect(result.timedEvents.map((e) => e.id)).toEqual(["earlier", "later"]);
    expect(result.deadlines.map((d) => d.id)).toEqual(["crit", "manual"]);
  });
});

describe("bucketDayItems — date-only items (ADR-012)", () => {
  // Real deadlines / all-day events are stored at UTC midnight. The
  // old viewer-zone bucket read 2026-07-07T00:00Z as 2026-07-06 for a
  // Denver user: today's deadline vanished from its own Day view and
  // tomorrow's showed up instead.
  test("a deadline due on the displayed day appears, in any host zone", () => {
    const dueToday = deadline({
      id: "today",
      dueDate: parseDateOnly("2026-07-07")!,
    });
    const dueTomorrow = deadline({
      id: "tomorrow",
      dueDate: parseDateOnly("2026-07-08")!,
    });
    const result = bucketDayItems([dueToday, dueTomorrow], DAY_KEY, TZ);
    expect(result.deadlines.map((d) => d.id)).toEqual(["today"]);
  });

  test("an all-day event on the displayed day is bucketed by its date", () => {
    const trial = event({
      id: "trial",
      isAllDay: true,
      startTime: parseDateOnly("2026-07-07")!,
      endTime: parseDateOnly("2026-07-07")!,
    });
    expect(
      bucketDayItems([trial], DAY_KEY, TZ).allDayEvents.map((e) => e.id)
    ).toEqual(["trial"]);
    expect(bucketDayItems([trial], "2026-07-06", TZ).allDayEvents).toEqual([]);
  });

  test("a multi-day all-day event shows on its middle days", () => {
    const trial = event({
      id: "trial",
      isAllDay: true,
      startTime: parseDateOnly("2026-07-06")!,
      endTime: parseDateOnly("2026-07-10")!,
    });
    expect(
      bucketDayItems([trial], DAY_KEY, TZ).allDayEvents.map((e) => e.id)
    ).toEqual(["trial"]);
    expect(bucketDayItems([trial], "2026-07-11", TZ).allDayEvents).toEqual([]);
  });
});

describe("DayView render", () => {
  test("renders a deadline stored at UTC midnight on its own day", () => {
    render(
      <DayView
        day={DAY}
        items={[
          deadline({
            id: "dl-utc",
            title: "Opposition due",
            dueDate: parseDateOnly("2026-07-07")!,
          }),
        ]}
        canEditEvents={false}
        userTz={TZ}
      />
    );
    expect(screen.getByText("Opposition due")).toBeTruthy();
  });

  test("renders timed chip (with location + matter), all-day chip, and deadline pill", () => {
    render(
      <DayView
        day={DAY}
        items={[
          event({
            id: "timed",
            location: "Courtroom 5B",
            matterName: "Smith v. Jones",
          }),
          event({ id: "allday", isAllDay: true, title: "Firm retreat" }),
          deadline({ id: "dl" }),
        ]}
        canEditEvents={false}
        userTz={TZ}
      />
    );

    // Timed chip — full-width day column has room for the
    // secondary location line the week view usually truncates.
    expect(screen.getByText("Deposition prep")).toBeTruthy();
    expect(screen.getByText(/Courtroom 5B/)).toBeTruthy();

    // All-day section.
    expect(screen.getByText("All day: Firm retreat")).toBeTruthy();

    // Deadline pill: title + matter name + critical tag, linking
    // to the matter's Deadlines tab.
    const pill = screen.getByTitle("Answer due — Smith v. Jones");
    expect(pill.getAttribute("href")).toBe("/matters/m1/deadlines");
    expect(screen.getByText("Answer due")).toBeTruthy();
    expect(screen.getByText("critical")).toBeTruthy();

    // Section labels.
    expect(screen.getByText("All day")).toBeTruthy();
    expect(screen.getByText("due")).toBeTruthy();
  });

  test("omits the deadlines section when the day has none", () => {
    render(
      <DayView day={DAY} items={[event({})]} canEditEvents={false} userTz={TZ} />
    );
    expect(screen.queryByText("due")).toBeNull();
  });

  test("hour gutter spans the shared 6am–9pm grid", () => {
    render(<DayView day={DAY} items={[]} canEditEvents={false} userTz={TZ} />);
    expect(screen.getByText("6a")).toBeTruthy();
    expect(screen.getByText("12p")).toBeTruthy();
    expect(screen.getByText("9p")).toBeTruthy();
  });
});
