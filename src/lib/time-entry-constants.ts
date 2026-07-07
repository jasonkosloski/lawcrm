/**
 * Time-entry shared constants + pure helpers.
 *
 * Form-state types live here (kept out of the "use server" action
 * files because those can only export async functions), alongside:
 *
 *   - the billing rounding increment + timer-elapsed rounding rule
 *   - the start–end → decimal-hours computation for the composer's
 *     time-range duration mode
 *   - the UTBMS code catalog (standard A100 activity set + L100
 *     litigation task set) that feeds the composer pickers
 */

export type TimeEntryFormState = {
  status: "idle" | "ok" | "error";
  errors?: Record<string, string[]>;
  values?: Record<string, string>;
};

export const timeEntryInitialState: TimeEntryFormState = { status: "idle" };

// ── Rounding convention ─────────────────────────────────────────────────

/**
 * Billing increment in decimal hours.
 *
 * Quarter-hour (0.25 h) — this is the convention the schema already
 * documents on `TimeEntry.hours` ("these are quarter-hour
 * increments"); the manual composers accept free-decimal input, so
 * the schema comment is the authoritative statement of the firm's
 * increment. Timer-elapsed durations round UP to this increment
 * (standard legal-billing convention: partial increments bill as a
 * whole one), with a minimum of one increment so a 30-second timer
 * still produces a billable 0.25 h rather than a zero-hour entry
 * the server would reject.
 */
export const TIME_ENTRY_INCREMENT_HOURS = 0.25;

/**
 * Round a timer's elapsed milliseconds UP to the billing increment
 * (minimum one increment). Non-finite / negative input clamps to the
 * minimum — a clock-skewed `startedAt` in the future must not
 * produce a negative or NaN prefill.
 */
export function roundElapsedToBillingIncrement(elapsedMs: number): number {
  const incrementMs = TIME_ENTRY_INCREMENT_HOURS * 3_600_000;
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return TIME_ENTRY_INCREMENT_HOURS;
  }
  const increments = Math.max(1, Math.ceil(elapsedMs / incrementMs));
  return increments * TIME_ENTRY_INCREMENT_HOURS;
}

/**
 * Format elapsed milliseconds as "H:MM:SS" for the ticking widget.
 * Negative / non-finite input renders as zero (same clock-skew
 * defense as the rounding helper).
 */
export function formatElapsed(elapsedMs: number): string {
  const totalSeconds =
    !Number.isFinite(elapsedMs) || elapsedMs <= 0
      ? 0
      : Math.floor(elapsedMs / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${h}:${pad(m)}:${pad(s)}`;
}

// ── Start–end duration mode ─────────────────────────────────────────────

/**
 * Decimal hours between two same-day "HH:MM" strings (the values an
 * <input type="time"> produces). Returns null when either input is
 * missing/malformed or the end isn't strictly after the start —
 * overnight ranges are deliberately not inferred (an end before the
 * start is far more often a typo than a cross-midnight session;
 * anyone who really worked past midnight can enter decimal hours).
 * Result is rounded to 2 decimals so 20 minutes shows as 0.33, not
 * 0.3333333333333333.
 */
export function computeHoursFromTimeRange(
  start: string,
  end: string
): number | null {
  const parse = (v: string): number | null => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(v);
    if (!m) return null;
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (hh > 23 || mm > 59) return null;
    return hh * 60 + mm;
  };
  const s = parse(start);
  const e = parse(end);
  if (s === null || e === null || e <= s) return null;
  return Math.round(((e - s) / 60) * 100) / 100;
}

// ── UTBMS codes ─────────────────────────────────────────────────────────

export type UtbmsCode = { code: string; label: string };

/** Standard UTBMS A100 activity codes (what kind of work). */
export const UTBMS_ACTIVITY_CODES: readonly UtbmsCode[] = [
  { code: "A101", label: "Plan and prepare for" },
  { code: "A102", label: "Research" },
  { code: "A103", label: "Draft/revise" },
  { code: "A104", label: "Review/analyze" },
  { code: "A105", label: "Communicate (in firm)" },
  { code: "A106", label: "Communicate (with client)" },
  { code: "A107", label: "Communicate (other outside counsel)" },
  { code: "A108", label: "Communicate (other external)" },
  { code: "A109", label: "Appear for/attend" },
  { code: "A110", label: "Manage data/files" },
  { code: "A111", label: "Other" },
];

/** Standard UTBMS L-series litigation task codes (what phase of the
 *  case). Flat list — the L100/L200/… phase grouping is encoded in
 *  the code prefix and surfaced by ordering, which is enough for a
 *  picker; don't add nesting until an insurer-billing feature needs
 *  it. */
export const UTBMS_LITIGATION_TASK_CODES: readonly UtbmsCode[] = [
  { code: "L110", label: "Fact Investigation/Development" },
  { code: "L120", label: "Analysis/Strategy" },
  { code: "L130", label: "Experts/Consultants" },
  { code: "L140", label: "Document/File Management" },
  { code: "L150", label: "Budgeting" },
  { code: "L160", label: "Settlement/Non-Binding ADR" },
  { code: "L190", label: "Other Case Assessment" },
  { code: "L210", label: "Pleadings" },
  { code: "L220", label: "Preliminary Injunctions/Provisional Remedies" },
  { code: "L230", label: "Court Mandated Conferences" },
  { code: "L240", label: "Dispositive Motions" },
  { code: "L250", label: "Other Written Motions and Submissions" },
  { code: "L260", label: "Class Action Certification and Notice" },
  { code: "L310", label: "Written Discovery" },
  { code: "L320", label: "Document Production" },
  { code: "L330", label: "Depositions" },
  { code: "L340", label: "Expert Discovery" },
  { code: "L350", label: "Discovery Motions" },
  { code: "L390", label: "Other Discovery" },
  { code: "L410", label: "Fact Witnesses" },
  { code: "L420", label: "Expert Witnesses" },
  { code: "L430", label: "Written Motions and Submissions (Trial)" },
  { code: "L440", label: "Other Trial Preparation and Support" },
  { code: "L450", label: "Trial and Hearing Attendance" },
  { code: "L460", label: "Post-Trial Motions and Submissions" },
  { code: "L510", label: "Appellate Motions and Submissions" },
  { code: "L520", label: "Appellate Briefs" },
  { code: "L530", label: "Oral Argument" },
];

const UTBMS_CODE_SET: ReadonlySet<string> = new Set(
  [...UTBMS_ACTIVITY_CODES, ...UTBMS_LITIGATION_TASK_CODES].map((c) => c.code)
);

/** Server-side validation guard: only codes from the catalog are
 *  persisted, so a hand-crafted POST can't write junk into a column
 *  that later feeds LEDES/insurer exports. */
export function isKnownUtbmsCode(code: string): boolean {
  return UTBMS_CODE_SET.has(code);
}

/** Human label for a stored code ("A103 — Draft/revise"); falls back
 *  to the bare code for values written before the catalog existed. */
export function utbmsCodeLabel(code: string): string {
  const match = [...UTBMS_ACTIVITY_CODES, ...UTBMS_LITIGATION_TASK_CODES].find(
    (c) => c.code === code
  );
  return match ? `${match.code} — ${match.label}` : code;
}
