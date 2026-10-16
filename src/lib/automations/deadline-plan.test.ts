/**
 * Pure planner tests. Pinned to America/Denver so the UTC-midnight
 * incident date vs local-midnight deadline conventions would show a
 * one-day shift if either were read with the wrong getters.
 */

process.env.TZ = "America/Denver";

import { describe, expect, test } from "vitest";
import {
  addDaysToKey,
  dayKeyFromLocalDate,
  dayKeyFromUtcDate,
  deadlineDateFromKey,
  describeOffset,
  isDayKey,
  packOffset,
  unpackOffset,
  planDeadlineRules,
  wouldCreateCycle,
  type PlanContext,
  type PlannableRule,
} from "./deadline-plan";

const rule = (over: Partial<PlannableRule> & { id: string }): PlannableRule => ({
  title: over.id,
  anchor: "incident_date",
  anchorRuleId: null,
  anchorLabel: null,
  offsetDays: 0,
  ...over,
});

const ctx = (over: Partial<PlanContext> = {}): PlanContext => ({
  // Stored the matters.ts way: "2026-03-10" → UTC midnight.
  incidentDate: new Date("2026-03-10T00:00:00Z"),
  // 9pm MDT Oct 16 = 03:00Z Oct 17 — the Denver day is Oct 16.
  matterOpenedAt: new Date("2026-10-17T03:00:00Z"),
  tz: "America/Denver",
  existingRuleDeadlines: new Map(),
  ...over,
});

describe("day keys", () => {
  test("UTC-midnight incident dates read as their stored day (not the day before)", () => {
    expect(dayKeyFromUtcDate(new Date("2026-03-10T00:00:00Z"))).toBe("2026-03-10");
  });

  test("local-midnight deadline dates round-trip", () => {
    const d = deadlineDateFromKey("2026-11-02");
    expect(dayKeyFromLocalDate(d)).toBe("2026-11-02");
    expect(d.getHours()).toBe(0);
  });

  test("adding days crosses DST and leap days without drift", () => {
    expect(addDaysToKey("2026-03-07", 2)).toBe("2026-03-09"); // spring forward
    expect(addDaysToKey("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDaysToKey("2026-01-15", -30)).toBe("2025-12-16");
  });

  test("isDayKey rejects impossible dates", () => {
    expect(isDayKey("2026-02-30")).toBe(false);
    expect(isDayKey("2026-2-3")).toBe(false);
    expect(isDayKey("2026-02-28")).toBe(true);
  });
});

describe("offsets", () => {
  test("pack uses the 365/30 convention and signs 'before'", () => {
    expect(packOffset({ amount: 2, unit: "years", direction: "after" })).toBe(730);
    expect(packOffset({ amount: 182, unit: "days", direction: "after" })).toBe(182);
    expect(packOffset({ amount: 6, unit: "months", direction: "after" })).toBe(180);
    expect(packOffset({ amount: 30, unit: "days", direction: "before" })).toBe(-30);
  });

  test("unpack round-trips in the entered unit", () => {
    expect(unpackOffset(-30, "days")).toEqual({ amount: 30, unit: "days", direction: "before" });
    expect(unpackOffset(730, "years")).toEqual({ amount: 2, unit: "years", direction: "after" });
    // Not a whole number of the unit → honest fallback to days.
    expect(unpackOffset(31, "months")).toEqual({ amount: 31, unit: "days", direction: "after" });
  });

  test("describe keeps the entered unit (182 days never becomes '6 months 2 days')", () => {
    expect(describeOffset(182, "days", "Incident date")).toBe("182 days after Incident date");
    expect(describeOffset(-30, "days", "Trial")).toBe("30 days before Trial");
    expect(describeOffset(730, "years", "Incident date")).toBe("2 years (730 days) after Incident date");
    expect(describeOffset(30, "months", "Service")).toBe("1 month (30 days) after Service");
    expect(describeOffset(1, "days", "Service")).toBe("1 day after Service");
    expect(describeOffset(0, "days", "Matter opened")).toBe("On Matter opened");
  });
});

describe("planDeadlineRules — anchors", () => {
  test("incident date + offset", () => {
    const { planned } = planDeadlineRules([rule({ id: "cgia", offsetDays: 182 })], ctx());
    expect(planned[0].anchorKey).toBe("2026-03-10");
    expect(planned[0].dueKey).toBe("2026-09-08");
  });

  test("matter opened uses the day in the caller's TZ", () => {
    const { planned } = planDeadlineRules(
      [rule({ id: "r", anchor: "matter_opened", offsetDays: 14 })],
      ctx()
    );
    expect(planned[0].anchorKey).toBe("2026-10-16");
    expect(planned[0].dueKey).toBe("2026-10-30");
  });

  test("prompt anchors need an explicit date", () => {
    const r = rule({ id: "svc", anchor: "prompt", anchorLabel: "Date of service", offsetDays: 21 });
    expect(planDeadlineRules([r], ctx()).unplanned[0].reason).toBe("needs_date");
    const { planned } = planDeadlineRules(
      [r],
      ctx({ anchorDates: new Map([["svc", "2026-11-01"]]) })
    );
    expect(planned[0].dueKey).toBe("2026-11-22");
  });

  test("missing incident date is reported, not guessed", () => {
    const { planned, unplanned } = planDeadlineRules(
      [rule({ id: "cgia", offsetDays: 182 })],
      ctx({ incidentDate: null })
    );
    expect(planned).toHaveLength(0);
    expect(unplanned[0].reason).toBe("no_incident_date");
  });

  test("an explicit date overrides an unresolvable anchor", () => {
    const { planned } = planDeadlineRules(
      [rule({ id: "cgia", offsetDays: 10 })],
      ctx({ incidentDate: null, anchorDates: new Map([["cgia", "2026-05-01"]]) })
    );
    expect(planned[0].dueKey).toBe("2026-05-11");
  });
});

describe("planDeadlineRules — rule anchors", () => {
  const trial = rule({ id: "trial", anchor: "prompt", offsetDays: 0 });
  const motions = rule({ id: "motions", anchor: "rule", anchorRuleId: "trial", offsetDays: -30 });

  test("chains within a batch regardless of input order", () => {
    const { planned } = planDeadlineRules(
      [motions, trial],
      ctx({ anchorDates: new Map([["trial", "2027-04-15"]]) })
    );
    const byId = new Map(planned.map((p) => [p.rule.id, p.dueKey]));
    expect(byId.get("trial")).toBe("2027-04-15");
    expect(byId.get("motions")).toBe("2027-03-16");
    // Anchor planned before its dependent.
    expect(planned.map((p) => p.rule.id)).toEqual(["trial", "motions"]);
  });

  test("counts from a rule deadline already on the matter", () => {
    const { planned } = planDeadlineRules(
      [motions],
      ctx({ existingRuleDeadlines: new Map([["trial", deadlineDateFromKey("2027-04-15")]]) })
    );
    expect(planned[0].dueKey).toBe("2027-03-16");
  });

  test("anchor rule not on the matter → reported", () => {
    const { unplanned } = planDeadlineRules([motions], ctx());
    expect(unplanned[0].reason).toBe("anchor_rule_missing");
  });

  test("an unplannable anchor makes its dependents unplannable too", () => {
    const { planned, unplanned } = planDeadlineRules([trial, motions], ctx());
    expect(planned).toHaveLength(0);
    expect(unplanned.map((u) => [u.rule.id, u.reason])).toEqual([
      ["trial", "needs_date"],
      ["motions", "anchor_rule_missing"],
    ]);
  });

  test("a loop in the batch is reported instead of recursing forever", () => {
    const a = rule({ id: "a", anchor: "rule", anchorRuleId: "b" });
    const b = rule({ id: "b", anchor: "rule", anchorRuleId: "a" });
    const { planned, unplanned } = planDeadlineRules([a, b], ctx());
    expect(planned).toHaveLength(0);
    expect(unplanned.map((u) => u.reason)).toContain("cycle");
  });
});

describe("wouldCreateCycle", () => {
  const anchors = new Map<string, string | null>([
    ["b", "c"],
    ["c", null],
  ]);

  test("self-reference and back-edges are cycles", () => {
    expect(wouldCreateCycle("a", "a", anchors)).toBe(true);
    // a → b → c → a
    expect(wouldCreateCycle("c", "b", new Map([...anchors, ["a", "b"]]))).toBe(true);
  });

  test("a straight chain is fine, including for a brand-new rule", () => {
    expect(wouldCreateCycle("a", "b", anchors)).toBe(false);
    expect(wouldCreateCycle(null, "b", anchors)).toBe(false);
  });
});
