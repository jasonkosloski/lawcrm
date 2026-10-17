/**
 * Shared zod field definitions for every action that writes a
 * TimeEntry (time-entries.ts, time-on-entity.ts, timer.ts).
 *
 * The hours bound and the UTBMS catalog guard used to be copy-pasted
 * into each action; tightening one (say, enforcing quarter-hour
 * precision) meant editing every copy. The error strings are asserted
 * by tests and shown in forms, so they live here verbatim.
 *
 * Not a "use server" file: server-action modules can only export
 * async functions, so shared schemas live here.
 */

import { z } from "zod";
import { isKnownUtbmsCode } from "@/lib/time-entry-constants";

/** Decimal hours as posted by the form: > 0 and ≤ 24. */
export const hoursField = z
  .string()
  .min(1, "Hours required")
  .refine((v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 && n <= 24;
  }, "Hours must be > 0 and ≤ 24");

/** Only catalog codes persist — the column feeds LEDES/insurer
 *  exports later, so junk from a hand-crafted POST is worse than a
 *  rejected form. Empty string / absent = "no code". */
export const utbmsCodeField = z
  .string()
  .trim()
  .refine((v) => v === "" || isKnownUtbmsCode(v), "Unknown UTBMS code")
  .optional();

/** The fields every time-entry form posts. `date` is the raw
 *  `YYYY-MM-DD` string — each action parses it with `parseDateOnly`
 *  (ADR-012) and returns a field error on null. */
export const timeEntryFields = {
  date: z.string().min(1, "Date is required"),
  hours: hoursField,
  activity: z.string().trim().min(1, "Activity is required").max(200),
  narrative: z.string().max(4000).optional().or(z.literal("")),
  utbmsCode: utbmsCodeField,
  billable: z.literal("on").optional(),
  noCharge: z.literal("on").optional(),
  privileged: z.literal("on").optional(),
};
