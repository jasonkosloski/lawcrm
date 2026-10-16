/**
 * Deadline-rule planning — pure (no DB, no clock), ADR-019.
 *
 * Turns a set of deadline rules + what we know about a matter into
 * concrete due dates, without writing anything. The DB layer
 * (`apply.ts`) loads the inputs, calls `planDeadlineRules`, then
 * writes the result.
 *
 * Dates are handled as YYYY-MM-DD calendar-day keys end to end, so
 * no anchor can shift a due date by a day:
 *   - incident_date: `Matter.incidentDate` is stored at UTC midnight
 *     (the documented SOL exception, ADR-012) → read via UTC getters
 *   - matter_opened: an instant → the day it was in the caller's TZ
 *   - rule: an existing Deadline.dueDate (date-only, server-local
 *     midnight) → read via local getters
 *   - prompt: a key the user typed
 * The result is stored the way every date-only deadline is
 * (`parseLocalDate`, server-local midnight).
 */

import { dateKeyInTz, parseLocalDate } from "@/lib/format-date";

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
};

// ── Calendar-day keys ──────────────────────────────────────────────

const KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDayKey(value: string): boolean {
  const m = KEY_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** UTC-midnight-stored date (Matter.incidentDate) → its day key. */
export function dayKeyFromUtcDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Server-local-midnight date (Deadline.dueDate) → its day key. */
export function dayKeyFromLocalDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Add whole days to a day key (UTC arithmetic — no DST drift). */
export function addDaysToKey(key: string, days: number): string {
  const m = KEY_RE.exec(key);
  if (!m) throw new Error(`Not a day key: ${key}`);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  d.setUTCDate(d.getUTCDate() + days);
  return dayKeyFromUtcDate(d);
}

/** Day key → the stored Deadline.dueDate value. */
export function deadlineDateFromKey(key: string): Date {
  const d = parseLocalDate(key);
  if (!d) throw new Error(`Not a day key: ${key}`);
  return d;
}

// ── Offsets ────────────────────────────────────────────────────────

export const OFFSET_UNITS = ["days", "months", "years"] as const;
export type OffsetUnit = (typeof OFFSET_UNITS)[number];

/** Days per unit — the same 365/30 convention as the SOL period. */
const UNIT_DAYS: Record<OffsetUnit, number> = { days: 1, months: 30, years: 365 };

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

/** Human description in the unit it was entered, e.g.
 *  "182 days after Incident date", "2 years (730 days) after Incident
 *  date", "30 days before Trial", "On Matter opened". */
export function describeOffset(
  offsetDays: number,
  unit: string,
  anchorText: string
): string {
  if (offsetDays === 0) return `On ${anchorText}`;
  const { amount, unit: u, direction } = unpackOffset(offsetDays, unit);
  const label = amount === 1 ? u.slice(0, -1) : u;
  const span =
    u === "days"
      ? `${amount} ${label}`
      : `${amount} ${label} (${Math.abs(offsetDays)} days)`;
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
    | "cycle";
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
        if (existing) return dayKeyFromLocalDate(existing);
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
      const dueKey = addDaysToKey(anchor, rule.offsetDays);
      plannedKeyByRule.set(rule.id, dueKey);
      planned.push({ rule, anchorKey: anchor, dueKey });
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
  }
}
