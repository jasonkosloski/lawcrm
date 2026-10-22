/**
 * Render tests for the /time views and toolbar.
 *
 * Pins:
 *   - hours show quarter-hour precision (0.25 is not "0.3");
 *   - the Timer lane exists only when the page says it is today's view,
 *     and its elapsed time comes from the server snapshot (`asOf`);
 *   - day labels in the week view are the date-only key's own day, in
 *     any server zone (the suite runs under America/Denver and UTC);
 *   - the toolbar's range labels come from the focal day's key.
 */

import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { parseISO } from "date-fns";
import type { MyDayTime, MyWeekTime } from "@/lib/queries/time";
import { TimeDayView } from "./time-day-view";
import { TimeWeekView } from "./time-week-view";
import { TimeToolbar, formatRangeLabel } from "./time-toolbar";

const entry = (over: Partial<MyDayTime["logged"][number]> = {}) => ({
  id: "e1",
  matterId: "m1",
  leadId: null,
  matterName: "Smith v. City",
  matterColor: "#336699",
  activity: "Review email",
  narrative: null,
  hours: 0.25,
  billable: true,
  noCharge: false,
  privileged: false,
  status: "draft",
  source: "manual",
  amount: null,
  ...over,
});

const day = (over: Partial<MyDayTime> = {}): MyDayTime => ({
  logged: [entry()],
  captured: [],
  totalHours: 0.75,
  billableHours: 0.25,
  ...over,
});

const timer = {
  startedAt: new Date("2026-06-15T16:00:00Z"),
  activity: "Deposition prep",
  matterId: "m1",
  matterName: "Smith v. City",
  matterColor: "#336699",
};

describe("TimeDayView", () => {
  test("quarter hours render with two decimals, not 0.3", () => {
    render(
      <TimeDayView
        day={day()}
        timer={null}
        showTimerLane
        asOf={new Date("2026-06-15T18:00:00Z")}
        userTz="America/Denver"
        dailyHoursGoal={8}
      />,
    );
    expect(screen.getByText("0.25h")).toBeInTheDocument();
    expect(screen.getByText("0.75h")).toBeInTheDocument();
    expect(screen.queryByText("0.3h")).toBeNull();
  });

  test("today: the Timer lane shows the running timer with elapsed from asOf", () => {
    render(
      <TimeDayView
        day={day()}
        timer={timer}
        showTimerLane
        asOf={new Date("2026-06-15T17:30:00Z")}
        userTz="America/Denver"
        dailyHoursGoal={8}
      />,
    );
    expect(screen.getByText("Timer")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("1.5h")).toBeInTheDocument();
  });

  test("today with nothing running: the lane says so", () => {
    render(
      <TimeDayView
        day={day()}
        timer={null}
        showTimerLane
        asOf={new Date()}
        userTz="America/Denver"
        dailyHoursGoal={8}
      />,
    );
    expect(screen.getByText("No timer running.")).toBeInTheDocument();
  });

  test("any other day: no Timer lane at all (its elapsed time is not part of that day's total)", () => {
    render(
      <TimeDayView
        day={day()}
        timer={null}
        showTimerLane={false}
        asOf={new Date()}
        userTz="America/Denver"
        dailyHoursGoal={8}
      />,
    );
    expect(screen.queryByText("Timer")).toBeNull();
    expect(screen.queryByText("No timer running.")).toBeNull();
    expect(screen.getByText("Logged")).toBeInTheDocument();
    expect(screen.getByText("Captured")).toBeInTheDocument();
  });

  test("status chips come from the shared vocabulary", () => {
    render(
      <TimeDayView
        day={day({ logged: [entry({ status: "written_off" })] })}
        timer={null}
        showTimerLane={false}
        asOf={new Date()}
        userTz="America/Denver"
        dailyHoursGoal={8}
      />,
    );
    expect(screen.getByText("Written off")).toBeInTheDocument();
  });

  test("captured entries say where they came from", () => {
    render(
      <TimeDayView
        day={day({
          logged: [],
          captured: [entry({ source: "calendar" })],
        })}
        timer={null}
        showTimerLane={false}
        asOf={new Date()}
        userTz="America/Denver"
        dailyHoursGoal={8}
      />,
    );
    expect(screen.getByText("via Calendar")).toBeInTheDocument();
  });
});

describe("TimeWeekView", () => {
  const week: MyWeekTime = {
    totalHours: 0.75,
    billableHours: 0.25,
    days: ["2026-06-14", "2026-06-15"].map((dayKey, i) => ({
      dayKey,
      totalHours: i === 0 ? 0.25 : 0.5,
      billableHours: i === 0 ? 0.25 : 0,
      segments: [
        {
          matterId: "m1",
          matterName: "Smith v. City",
          matterColor: "#336699",
          hours: i === 0 ? 0.25 : 0.5,
          billableHours: i === 0 ? 0.25 : 0,
        },
      ],
    })),
  };

  test("day labels are the key's own calendar day", () => {
    render(<TimeWeekView week={week} todayKey="2026-06-15" />);
    // 2026-06-14 is a Sunday; local getters west of UTC would say Sat/Jun 13.
    expect(screen.getByText("Sun")).toBeInTheDocument();
    expect(screen.getByText("Jun 14")).toBeInTheDocument();
    expect(screen.getByText("Mon")).toBeInTheDocument();
    expect(screen.getByText("Jun 15")).toBeInTheDocument();
  });

  test("hours keep quarter-hour precision in totals and legend", () => {
    render(<TimeWeekView week={week} todayKey="2026-06-15" />);
    // Week footer and the legend chip both carry the total.
    expect(screen.getAllByText("0.75h").length).toBeGreaterThan(0);
    expect(screen.getAllByText("0.25h").length).toBeGreaterThan(0);
    expect(screen.queryByText("0.3h")).toBeNull();
    expect(screen.queryByText("0.8h")).toBeNull();
  });
});

describe("TimeToolbar labels", () => {
  const focal = parseISO("2026-06-17"); // Wednesday, server-local midnight

  test("week label names the Sunday of the focal week", () => {
    expect(formatRangeLabel("week", focal)).toBe("Week of Jun 14, 2026");
  });

  test("a week spanning two months shows both ends", () => {
    expect(formatRangeLabel("week", parseISO("2026-07-01"))).toBe("Jun 28 – Jul 4, 2026");
  });

  test("a week spanning a year boundary", () => {
    expect(formatRangeLabel("week", parseISO("2026-12-31"))).toBe("Dec 27 – Jan 2, 2027");
  });

  test("day label spells out the weekday", () => {
    expect(formatRangeLabel("day", focal)).toBe("Wednesday, June 17, 2026");
  });

  test("renders prev / today / next links for the viewer's today", () => {
    render(<TimeToolbar view="day" focal={focal} userTz="America/Denver" />);
    expect(screen.getByRole("link", { name: "Previous day" })).toHaveAttribute(
      "href",
      "/time?view=day&d=2026-06-16",
    );
    expect(screen.getByRole("link", { name: "Next day" })).toHaveAttribute(
      "href",
      "/time?view=day&d=2026-06-18",
    );
    expect(screen.getByRole("link", { name: "Today" })).toHaveAttribute(
      "href",
      expect.stringMatching(/^\/time\?view=day&d=\d{4}-\d{2}-\d{2}$/),
    );
  });
});
