/**
 * Deadline-rule planning — pure (no DB, no clock), ADR-019.
 *
 * Turns a set of deadline rules + what we know about a matter into
 * concrete due dates, without writing anything. The DB layer
 * (`apply.ts`) loads the inputs, calls `planDeadlineRules`, then
 * writes the result.
 *
 * Dates are handled as YYYY-MM-DD calendar-day keys end to end, so
 * no anchor can shift a due date by a day (ADR-012 date-only values):
 *   - incident_date: `Matter.incidentDate` is a date-only value
 *     (UTC midnight) → `dateOnlyKey`
 *   - matter_opened: an instant → the day it was in the caller's TZ
 *   - rule: an existing Deadline.dueDate (date-only) → `dateOnlyKey`
 *   - prompt: a key the user typed
 * The result is stored like every other date-only deadline
 * (`parseDateOnly`, UTC midnight).
 *
 * Due dates are plain calendar-day arithmetic: no weekend, holiday or
 * court-day adjustment is applied.
 */

import {
  addDaysToKey as shiftDayKey,
  dateKeyInTz,
  dateOnlyKey,
  parseDateOnly,
} from "@/lib/format-date";
import { addUtcMonths } from "@/lib/sol";

export const DEADLINE_RULE_ANCHORS = [
  "incident_date",
  "matter_opened",
  "prompt",
  "rule",
] as const;
export type DeadlineRuleAnchor = (typeof DEADLINE_RULE_ANCHORS)[number];

export const DEADLINE_RULE_ANCHOR_LABEL: Record<DeadlineRuleAnchor, string> = {
  incident_date: "Incident date",
  matter_opened: "Matter opened",
  prompt: "Date entered when applied",
  rule: "Another rule's deadline",
};

export const DEADLINE_RULE_KINDS = ["critical", "standard"] as const;
export type DeadlineRuleKind = (typeof DEADLINE_RULE_KINDS)[number];

/** Rule kind → the Deadline.kind the generated row carries. */
export function deadlineKindForRule(kind: string): "critical" | "auto_rule" {
  return kind === "critical" ? "critical" : "auto_rule";
}

export type PlannableRule = {
  id: string;
  title: string;
  anchor: DeadlineRuleAnchor;
  anchorRuleId: string | null;
  anchorLabel: string | null;
  offsetDays: number;
  /** "days" | "months" | "years" - how the offset was entered. Months
   *  and years are applied as calendar months (ADR-035); `offsetDays`
   *  stays the signed 365/30 total used to recover the amount. Absent
   *  or unknown = plain days. */
  offsetUnit?: string;
};

// ── Calendar-day keys ──────────────────────────────────────────────

/** A real calendar day with a 4-digit year (rejects 2026-02-30, year
 *  38501 and negative years that day arithmetic can overflow into). */
export function isDayKey(value: string): boolean {
  return parseDateOnly(value) !== null;
}

/** Date-only value (Matter.incidentDate, Deadline.dueDate) → its day key. */
export const dayKeyFromUtcDate = dateOnlyKey;

/** Add whole days to a day key (UTC arithmetic — no DST drift). The
 *  result can fall outside the 4-digit-year range for absurd offsets;
 *  check it with `isDayKey` before storing. */
export function addDaysToKey(key: string, days: number): string {
  if (parseDateOnly(key) === null) throw new Error(`Not a day key: ${key}`);
  return shiftDayKey(key, days);
}

/** Add calendar months to a day key (UTC; day of month clamps to the
 *  target month's length - Jan 31 + 1 month = Feb 28/29). */
export function addMonthsToKey(key: string, months: number): string {
  const d = parseDateOnly(key);
  if (d === null) throw new Error(`Not a day key: ${key}`);
  const out = addUtcMonths(d, months);
  // An absurd offset overflows the Date range; hand back a non-key so
  // the caller reports "out of range" instead of throwing.
  if (Number.isNaN(out.getTime())) return "out-of-range";
  return dateOnlyKey(out);
}

/** Day key → the stored Deadline.dueDate value. */
export function deadlineDateFromKey(key: string): Date {
  const d = parseDateOnly(key);
  if (!d) throw new Error(`Not a day key: ${key}`);
  return d;
}

// ── Offsets ────────────────────────────────────────────────────────

export const OFFSET_UNITS = ["days", "months", "years"] as const;
export type OffsetUnit = (typeof OFFSET_UNITS)[number];

/** Days per unit - the 365/30 convention used ONLY to store the offset
 *  in one signed integer (`offsetDays`) and to recover the entered
 *  amount. Due dates do not use it: months/years are applied as
 *  calendar months (`applyOffsetToKey`). */
const UNIT_DAYS: Record<OffsetUnit, number> = { days: 1, months: 30, years: 365 };

/** Largest total offset (in days) a rule may carry — about 100 years. */
export const MAX_OFFSET_DAYS = 36500;

/** Signed total days from the form's amount + unit + direction. */
export function packOffset(input: {
  amount: number;
  unit: OffsetUnit;
  direction: "after" | "before";
}): number {
  const total = Math.max(0, Math.floor(input.amount)) * UNIT_DAYS[input.unit];
  return input.direction === "before" ? -total : total;
}

/** Reverse of packOffset for edit forms. A stored value that isn't a
 *  whole number of its unit (shouldn't happen) falls back to days. */
export function unpackOffset(
  offsetDays: number,
  unit: string
): { amount: number; unit: OffsetUnit; direction: "after" | "before" } {
  const u: OffsetUnit = (OFFSET_UNITS as readonly string[]).includes(unit)
    ? (unit as OffsetUnit)
    : "days";
  const abs = Math.abs(offsetDays);
  const direction = offsetDays < 0 ? "before" : "after";
  if (abs % UNIT_DAYS[u] !== 0) return { amount: abs, unit: "days", direction };
  return { amount: abs / UNIT_DAYS[u], unit: u, direction };
}

/** The due-date key for an anchor key + a rule's stored offset.
 *  "2 years after" is the same calendar date two years on (Feb 29
 *  clamps to Feb 28), not 730 days; a "before" offset moves back the
 *  same way. A stored value that isn't a whole number of its unit
 *  falls back to plain days. */
export function applyOffsetToKey(
  anchorKey: string,
  offsetDays: number,
  unit: string | undefined
): string {
  const { amount, unit: u, direction } = unpackOffset(offsetDays, unit ?? "days");
  if (u === "days") return addDaysToKey(anchorKey, offsetDays);
  const months = (u === "years" ? amount * 12 : amount) * (direction === "before" ? -1 : 1);
  return addMonthsToKey(anchorKey, months);
}

/** Human description in the unit it was entered, e.g.
 *  "182 days after Incident date", "2 years after Incident date", "30 days before Trial", "On Matter opened". */
export function describeOffset(
  offsetDays: number,
  unit: string,
  anchorText: string
): string {
  if (offsetDays === 0) return `On ${anchorText}`;
  const { amount, unit: u, direction } = unpackOffset(offsetDays, unit);
  const label = amount === 1 ? u.slice(0, -1) : u;
  const span = `${amount} ${label}`;
  return `${span} ${direction} ${anchorText}`;
}

/** What a rule counts from, in words — "Incident date", "Trial"
 *  (another rule's title), or the prompt's label. */
export function ruleAnchorText(rule: {
  anchor: string;
  anchorLabel: string | null;
  anchorRuleTitle?: string | null;
}): string {
  switch (rule.anchor) {
    case "rule":
      return rule.anchorRuleTitle ?? "another rule";
    case "prompt":
      return rule.anchorLabel || "the entered date";
    default:
      return DEADLINE_RULE_ANCHOR_LABEL[rule.anchor as DeadlineRuleAnchor] ?? rule.anchor;
  }
}

/** Full one-line summary, e.g. "30 days before Trial". */
export function ruleSummary(rule: {
  anchor: string;
  anchorLabel: string | null;
  anchorRuleTitle?: string | null;
  offsetDays: number;
  offsetUnit: string;
}): string {
  return describeOffset(rule.offsetDays, rule.offsetUnit, ruleAnchorText(rule));
}

// ── Dependency graph ───────────────────────────────────────────────

/**
 * Would saving `ruleId` with `anchorRuleId` create a cycle? Walks the
 * anchor chain from the proposed anchor; reaching `ruleId` means yes.
 * `anchorOf` maps every OTHER rule's id → its anchorRuleId.
 */
export function wouldCreateCycle(
  ruleId: string | null,
  anchorRuleId: string,
  anchorOf: ReadonlyMap<string, string | null>
): boolean {
  if (ruleId !== null && anchorRuleId === ruleId) return true;
  const seen = new Set<string>();
  let cur: string | null | undefined = anchorRuleId;
  while (cur) {
    if (cur === ruleId) return true;
    if (seen.has(cur)) return true; // pre-existing loop — refuse too
    seen.add(cur);
    cur = anchorOf.get(cur) ?? null;
  }
  return false;
}

// ── Planning ───────────────────────────────────────────────────────

export type PlanContext = {
  /** Matter.incidentDate (UTC midnight), if any. */
  incidentDate: Date | null;
  /** Matter.createdAt. */
  matterOpenedAt: Date;
  /** TZ used to turn matterOpenedAt into a calendar day. */
  tz: string;
  /** Deadlines already on the matter that came from a rule:
   *  ruleId → that deadline's dueDate. Used by "rule" anchors. */
  existingRuleDeadlines: ReadonlyMap<string, Date>;
  /** Explicit anchor dates (day keys) by rule id — the "prompt"
   *  anchor's answer, or a fallback the user typed when another
   *  anchor couldn't be resolved. Wins over every other source. */
  anchorDates?: ReadonlyMap<string, string>;
};

export type PlannedDeadline = {
  rule: PlannableRule;
  anchorKey: string;
  dueKey: string;
};

export type UnplannedRule = {
  rule: PlannableRule;
  reason:
    | "no_incident_date"
    | "needs_date"
    | "anchor_rule_missing"
    | "cycle"
    | "out_of_range";
};

/**
 * Plan due dates for `rules`. Rules anchored on another rule in the
 * same batch are planned after it (dependency order), so a batch can
 * chain: "Trial (entered)" → "Pretrial motions 30 days before trial".
 * Anything that can't be dated comes back in `unplanned` with a
 * reason — the caller decides whether that means "ask for a date"
 * (manual) or "create a set-the-date task" (automatic).
 */
export function planDeadlineRules(
  rules: readonly PlannableRule[],
  ctx: PlanContext
): { planned: PlannedDeadline[]; unplanned: UnplannedRule[] } {
  const planned: PlannedDeadline[] = [];
  const unplanned: UnplannedRule[] = [];
  const plannedKeyByRule = new Map<string, string>();
  const inBatch = new Map(rules.map((r) => [r.id, r]));
  const state = new Map<string, "visiting" | "done">();

  const anchorKeyFor = (rule: PlannableRule): string | UnplannedRule["reason"] => {
    const explicit = ctx.anchorDates?.get(rule.id);
    if (explicit && isDayKey(explicit)) return explicit;
    switch (rule.anchor) {
      case "incident_date":
        return ctx.incidentDate
          ? dayKeyFromUtcDate(ctx.incidentDate)
          : "no_incident_date";
      case "matter_opened":
        return dateKeyInTz(ctx.matterOpenedAt, ctx.tz);
      case "prompt":
        return "needs_date";
      case "rule": {
        if (!rule.anchorRuleId) return "anchor_rule_missing";
        const fromBatch = plannedKeyByRule.get(rule.anchorRuleId);
        if (fromBatch) return fromBatch;
        const existing = ctx.existingRuleDeadlines.get(rule.anchorRuleId);
        if (existing) return dayKeyFromUtcDate(existing);
        return "anchor_rule_missing";
      }
    }
  };

  const visit = (rule: PlannableRule): void => {
    const st = state.get(rule.id);
    if (st === "done") return;
    if (st === "visiting") return; // cycle — reported by the caller below
    state.set(rule.id, "visiting");
    // Plan an in-batch anchor first so this rule can count from it.
    if (rule.anchor === "rule" && rule.anchorRuleId) {
      const dep = inBatch.get(rule.anchorRuleId);
      if (dep) {
        if (state.get(dep.id) === "visiting") {
          state.set(rule.id, "done");
          unplanned.push({ rule, reason: "cycle" });
          return;
        }
        visit(dep);
      }
    }
    const anchor = anchorKeyFor(rule);
    if (isDayKey(anchor)) {
      const dueKey = applyOffsetToKey(anchor, rule.offsetDays, rule.offsetUnit);
      if (!isDayKey(dueKey)) {
        // An absurd stored offset (e.g. thousands of years) overflows
        // the 4-digit year — report it instead of throwing later.
        unplanned.push({ rule, reason: "out_of_range" });
      } else {
        plannedKeyByRule.set(rule.id, dueKey);
        planned.push({ rule, anchorKey: anchor, dueKey });
      }
    } else {
      unplanned.push({ rule, reason: anchor as UnplannedRule["reason"] });
    }
    state.set(rule.id, "done");
  };

  for (const rule of rules) visit(rule);
  return { planned, unplanned };
}

/** Plain-English reason for an unplanned rule (UI + task text). */
export function unplannedReasonText(
  u: UnplannedRule,
  anchorRuleTitle?: string | null
): string {
  switch (u.reason) {
    case "no_incident_date":
      return "the matter has no incident date yet";
    case "needs_date":
      return `it needs a date (${u.rule.anchorLabel || "anchor date"})`;
    case "anchor_rule_missing":
      return `it counts from "${anchorRuleTitle ?? "another rule"}", which isn't on this matter yet`;
    case "cycle":
      return "its anchor rules form a loop";
    case "out_of_range":
      return "the calculated date is out of range — check the rule's offset";
  }
}
