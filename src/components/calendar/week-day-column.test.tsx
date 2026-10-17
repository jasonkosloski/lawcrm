/**
 * WeekAllDayCell / WeekTimeColumn drag affordances: only the events
 * the viewer may edit are draggable, and the continuation days of a
 * multi-day all-day event are plain links (not drag sources).
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { CalendarEventRow } from "@/lib/queries/calendar";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/calendar",
  useSearchParams: () => new URLSearchParams("view=week"),
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

import { WeekAllDayCell, WeekTimeColumn } from "./week-day-column";

const event = (over: Partial<CalendarEventRow>): CalendarEventRow => ({
  id: "e1",
  kind: "event",
  title: "Trial",
  type: "meeting",
  startTime: new Date("2026-04-13T00:00:00Z"),
  endTime: new Date("2026-04-15T00:00:00Z"),
  isAllDay: true,
  location: null,
  color: "#1e4f88",
  matterId: null,
  matterName: null,
  attendeeCount: 0,
  attendeeNames: [],
  viewerCanSeeDetails: true,
  ...over,
});

afterEach(cleanup);

const noop = () => {};
const draggables = (c: HTMLElement) =>
  c.querySelectorAll('[draggable="true"]').length;

describe("WeekAllDayCell", () => {
  test("the first day's chip of a multi-day event is draggable", () => {
    const { container } = render(
      <WeekAllDayCell
        day={new Date("2026-04-13T12:00:00Z")}
        events={[event({})]}
        deadlines={[]}
        canEdit
        move={noop}
      />
    );
    expect(draggables(container)).toBe(1);
  });

  test("a continuation day's chip is a plain link, not a drag source", () => {
    const { container } = render(
      <WeekAllDayCell
        day={new Date("2026-04-14T12:00:00Z")}
        events={[event({})]}
        deadlines={[]}
        canEdit
        move={noop}
      />
    );
    expect(draggables(container)).toBe(0);
    expect(container.querySelector("a")).not.toBeNull();
  });

  test("an event the viewer can't edit isn't draggable even when others are", () => {
    const { container } = render(
      <WeekAllDayCell
        day={new Date("2026-04-13T12:00:00Z")}
        events={[
          event({ id: "mine" }),
          event({ id: "theirs", title: "Colleague" }),
        ]}
        deadlines={[]}
        canEdit
        canDragEvent={(id) => id === "mine"}
        move={noop}
      />
    );
    expect(draggables(container)).toBe(1);
    expect(container.querySelectorAll("a")).toHaveLength(1);
  });
});

describe("WeekTimeColumn", () => {
  test("only per-event editable timed events are draggable / resizable", () => {
    const timed = (id: string, hour: number) =>
      event({
        id,
        isAllDay: false,
        startTime: new Date(Date.UTC(2026, 3, 13, hour)),
        endTime: new Date(Date.UTC(2026, 3, 13, hour + 1)),
      });
    const { container } = render(
      <WeekTimeColumn
        day={new Date("2026-04-13T12:00:00Z")}
        isToday={false}
        now={new Date("2026-04-13T12:00:00Z")}
        events={[timed("mine", 14), timed("theirs", 17)]}
        canEdit
        canDragEvent={(id) => id === "mine"}
        move={noop}
      />
    );
    expect(draggables(container)).toBe(1);
    // Resize handles exist only on the editable chip (two per chip).
    expect(container.querySelectorAll('[aria-label^="Resize event"]')).toHaveLength(2);
  });
});
