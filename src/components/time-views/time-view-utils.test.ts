/**
 * Unit tests for the /time page URL helpers.
 *
 * The TZ-sensitive part mirrors the calendar-utils suite: with no
 * `?d=` the focal must be "today" on the USER's calendar. At the
 * pinned instant (02:00 UTC) Denver is still on the previous day
 * while Tokyo is already on the next — the two viewers must get
 * different focals from the same request.
 */

import { describe, expect, test } from "vitest";
import {
  DEFAULT_TIME_VIEW,
  buildTimeHref,
  dayKeyFromNoonUtc,
  parseTimeParams,
  timeSourceLabel,
  toTimeDateParam,
} from "./time-view-utils";

// 2026-06-16T02:00Z → June 15 evening in Denver, June 16 in Tokyo.
const NOW = new Date("2026-06-16T02:00:00Z");
const DENVER = "America/Denver";
const TOKYO = "Asia/Tokyo";

describe("parseTimeParams — view", () => {
  test("defaults to week", () => {
    expect(parseTimeParams({}, DENVER, NOW).view).toBe("week");
    expect(DEFAULT_TIME_VIEW).toBe("week");
  });

  test("accepts day, rejects junk", () => {
    expect(parseTimeParams({ view: "day" }, DENVER, NOW).view).toBe("day");
    expect(parseTimeParams({ view: "month" }, DENVER, NOW).view).toBe("week");
    expect(parseTimeParams({ view: ["day", "week"] }, DENVER, NOW).view).toBe("day");
  });
});

describe("parseTimeParams — focal date", () => {
  test("explicit ?d= wins and round-trips through toTimeDateParam", () => {
    const { focal } = parseTimeParams({ d: "2026-03-02" }, DENVER, NOW);
    expect(toTimeDateParam(focal)).toBe("2026-03-02");
  });

  test("malformed ?d= falls back to the user's today", () => {
    const { focal } = parseTimeParams({ d: "not-a-date" }, DENVER, NOW);
    expect(toTimeDateParam(focal)).toBe("2026-06-15");
  });

  test.each(["2026-02-31", "2026-13-01", "2026-00-10", "2026-04-31"])(
    "well-formed but impossible ?d=%s falls back to today (parseISO never throws)",
    (d) => {
      // The old try/catch was dead code: parseISO returns Invalid Date,
      // and toTimeDateParam(Invalid Date) then threw RangeError and 500ed
      // the page.
      const { focal } = parseTimeParams({ d }, DENVER, NOW);
      expect(Number.isNaN(focal.getTime())).toBe(false);
      expect(toTimeDateParam(focal)).toBe("2026-06-15");
    },
  );

  test("a leap day is accepted, a non-leap Feb 29 is not", () => {
    expect(toTimeDateParam(parseTimeParams({ d: "2028-02-29" }, DENVER, NOW).focal)).toBe(
      "2028-02-29",
    );
    expect(toTimeDateParam(parseTimeParams({ d: "2026-02-29" }, DENVER, NOW).focal)).toBe(
      "2026-06-15",
    );
  });

  test("no ?d=: focal is today on the USER's calendar, not the server's", () => {
    const denver = parseTimeParams({}, DENVER, NOW);
    expect(toTimeDateParam(denver.focal)).toBe("2026-06-15");

    const tokyo = parseTimeParams({}, TOKYO, NOW);
    expect(toTimeDateParam(tokyo.focal)).toBe("2026-06-16");
  });
});

describe("buildTimeHref", () => {
  const focal = new Date(2026, 5, 15); // server-local midnight June 15

  test("default view is omitted from the query string", () => {
    expect(buildTimeHref("week", focal)).toBe("/time?d=2026-06-15");
  });

  test("day view is explicit", () => {
    expect(buildTimeHref("day", focal)).toBe("/time?view=day&d=2026-06-15");
  });

  test("overrides replace view/focal independently", () => {
    expect(buildTimeHref("week", focal, { view: "day" })).toBe("/time?view=day&d=2026-06-15");
    expect(buildTimeHref("day", focal, { focal: new Date(2026, 5, 16) })).toBe(
      "/time?view=day&d=2026-06-16",
    );
  });
});

describe("dayKeyFromNoonUtc", () => {
  test("noon-UTC day dates key to their own calendar day", () => {
    // Read with UTC getters, so exact in every server zone.
    const noon = new Date(Date.UTC(2026, 5, 15, 12));
    expect(dayKeyFromNoonUtc(noon)).toBe("2026-06-15");
    // Month/year boundaries hold too.
    expect(dayKeyFromNoonUtc(new Date(Date.UTC(2026, 11, 31, 12)))).toBe("2026-12-31");
    expect(dayKeyFromNoonUtc(new Date(Date.UTC(2027, 0, 1, 12)))).toBe("2027-01-01");
  });
});

describe("source labels", () => {
  // The old DAILY_HOURS_GOAL constant is gone — the day view's goal
  // now comes from Firm.dailyHoursGoal via getFirmGoals() (covered
  // in src/lib/firm.test.ts + queries/dashboard.test.ts).

  test("known sources get pretty labels, unknown pass through", () => {
    expect(timeSourceLabel("timer")).toBe("Timer");
    expect(timeSourceLabel("email")).toBe("Email");
    expect(timeSourceLabel("carrier_pigeon")).toBe("carrier_pigeon");
    // One shared map: the intake tab and the day view agree on labels.
    expect(timeSourceLabel("calendar")).toBe("Calendar");
    expect(timeSourceLabel("manual")).toBe("Manual");
    // Prototype keys are not labels.
    expect(timeSourceLabel("constructor")).toBe("constructor");
  });
});
