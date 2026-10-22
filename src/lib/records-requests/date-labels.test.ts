import { describe, expect, test } from "vitest";
import { dueCountdownLabel, responsePeriodLabel, sentAgoLabel } from "./date-labels";

describe("sentAgoLabel", () => {
  test("today, yesterday, n days ago", () => {
    expect(sentAgoLabel(0)).toBe("Today");
    expect(sentAgoLabel(1)).toBe("Yesterday");
    expect(sentAgoLabel(5)).toBe("5 days ago");
  });
});

describe("dueCountdownLabel", () => {
  test("left, today, overdue — with singular days", () => {
    expect(dueCountdownLabel(3)).toEqual({ text: "3 days left", overdue: false });
    expect(dueCountdownLabel(1)).toEqual({ text: "1 day left", overdue: false });
    expect(dueCountdownLabel(0)).toEqual({ text: "Due today", overdue: false });
    expect(dueCountdownLabel(-1)).toEqual({ text: "1 day overdue", overdue: true });
    expect(dueCountdownLabel(-4)).toEqual({ text: "4 days overdue", overdue: true });
  });
});

describe("responsePeriodLabel", () => {
  test("calendar and business days, singular and plural", () => {
    expect(responsePeriodLabel(30, "CALENDAR_DAYS")).toBe("30 days after sending");
    expect(responsePeriodLabel(3, "BUSINESS_DAYS")).toBe("3 business days after sending");
    expect(responsePeriodLabel(1, "BUSINESS_DAYS")).toBe("1 business day after sending");
  });
});
