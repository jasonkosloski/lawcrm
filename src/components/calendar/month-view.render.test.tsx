/**
 * MonthView render tests — the date-only / month-dimming bugs that
 * only show on a UTC server with a west-of-UTC viewer.
 *
 *  - The "is this day in the focal month" check used to re-read the
 *    focal Date through the viewer's zone, so after any Next/Prev
 *    click (focal = the 1st) every cell of the shown month dimmed and
 *    the previous month's trailing days looked current.
 *  - Deadlines (stored at UTC midnight) were bucketed through the
 *    viewer's zone and drawn on the previous day.
 */

import { describe, expect, test, vi } from "vitest";
import { render } from "@testing-library/react";
import { parseISO } from "date-fns";
import type {
  CalendarDeadlineRow,
  CalendarEventRow,
} from "@/lib/queries/calendar";
import { calendarMonthGridInTz, parseDateOnly } from "@/lib/format-date";

vi.mock("next/navigation", () => ({
  usePathname: () => "/calendar",
  useSearchParams: () => new URLSearchParams(),
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

import { MonthView } from "./month-view";

const TZ = "America/Denver";

const deadline = (dueKey: string): CalendarDeadlineRow => ({
  id: `d-${dueKey}`,
  kind: "deadline",
  title: "Answer due",
  dueDate: parseDateOnly(dueKey)!,
  deadlineKind: "critical",
  status: "open",
  matterId: "m1",
  matterName: "Smith v. Jones",
});

const allDay = (id: string, startKey: string, endKey: string): CalendarEventRow => ({
  id,
  kind: "event",
  title: "Trial",
  type: "trial",
  startTime: parseDateOnly(startKey)!,
  endTime: parseDateOnly(endKey)!,
  isAllDay: true,
  location: null,
  color: "#123456",
  matterId: "m1",
  matterName: "Smith v. Jones",
  attendeeCount: 0,
  attendeeNames: [],
  viewerCanSeeDetails: true,
});

function renderMonth(
  focalKey: string,
  items: (CalendarDeadlineRow | CalendarEventRow)[] = []
) {
  // The page builds the grid from the focal exactly like this.
  const grid = calendarMonthGridInTz(parseISO(focalKey), TZ);
  return render(
    <MonthView
      focalKey={focalKey}
      days={grid.days}
      items={items}
      userTz={TZ}
    />
  );
}

/** The day cell (the element carrying the dim/in-month background)
 *  for a given date key. */
function cellFor(container: HTMLElement, key: string): HTMLElement {
  const link = container.querySelector(`a[href="/calendar?view=day&d=${key}"]`);
  const cell = link?.parentElement;
  if (!cell) throw new Error(`no cell for ${key}`);
  return cell;
}

describe("MonthView — focal month", () => {
  test("after navigating to the 1st, that month's cells are NOT dimmed", () => {
    // /calendar?view=month&d=2026-08-01 — what the Next arrow links to.
    const { container } = renderMonth("2026-08-01");
    expect(cellFor(container, "2026-08-15").className).not.toContain(
      "bg-paper-2/40"
    );
    expect(cellFor(container, "2026-08-01").className).not.toContain(
      "bg-paper-2/40"
    );
  });

  test("the previous month's leading days ARE dimmed", () => {
    const { container } = renderMonth("2026-08-01");
    // Aug 1 2026 is a Saturday; the grid starts Sunday Jul 26.
    expect(cellFor(container, "2026-07-26").className).toContain(
      "bg-paper-2/40"
    );
    expect(cellFor(container, "2026-07-31").className).toContain(
      "bg-paper-2/40"
    );
  });

  test("a mid-month focal highlights its own month too", () => {
    const { container } = renderMonth("2026-07-15");
    expect(cellFor(container, "2026-07-04").className).not.toContain(
      "bg-paper-2/40"
    );
  });

  test("weekday headers come from the grid's first row", () => {
    const { container } = renderMonth("2026-08-01");
    const labels = [
      ...container.querySelectorAll(".grid-cols-7.border-b > div"),
    ].map((el) => el.textContent);
    expect(labels).toEqual(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
  });
});

describe("MonthView — date-only items", () => {
  test("a deadline due Aug 3 sits in Aug 3's cell, not Aug 2's", () => {
    const { container } = renderMonth("2026-08-01", [deadline("2026-08-03")]);
    expect(cellFor(container, "2026-08-03").textContent).toContain(
      "Answer due"
    );
    expect(cellFor(container, "2026-08-02").textContent).not.toContain(
      "Answer due"
    );
  });

  test("a deadline due on the first Sunday of the grid stays in the grid", () => {
    // Jul 26 2026 is the grid's first Sunday: the old viewer-zone
    // bucket put it on Saturday Jul 25, outside the grid entirely.
    const { container } = renderMonth("2026-08-01", [deadline("2026-07-26")]);
    expect(cellFor(container, "2026-07-26").textContent).toContain(
      "Answer due"
    );
  });

  test("a multi-day all-day event appears on every day it covers", () => {
    const { container } = renderMonth("2026-08-01", [
      allDay("trial", "2026-08-10", "2026-08-12"),
    ]);
    for (const key of ["2026-08-10", "2026-08-11", "2026-08-12"]) {
      expect(cellFor(container, key).textContent).toContain("Trial");
    }
    expect(cellFor(container, "2026-08-13").textContent).not.toContain(
      "Trial"
    );
    expect(cellFor(container, "2026-08-09").textContent).not.toContain(
      "Trial"
    );
  });
});
