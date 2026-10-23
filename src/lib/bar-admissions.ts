/** Parsing and saving of an attorney's per-state bar admissions. The
 *  editor posts them as one JSON string in the `barAdmissions` field. */

import { stateCode } from "@/lib/us-states";
import type { Tx } from "@/lib/prisma";

export type BarAdmissionInput = { state: string; number: string };

const MAX_ROWS = 60;
const MAX_NUMBER = 40;

/** `null` (field not posted) means "leave the admissions alone". */
export function parseBarAdmissions(
  raw: FormDataEntryValue | null,
): { ok: true; value: BarAdmissionInput[] | undefined } | { ok: false; error: string } {
  if (raw === null) return { ok: true, value: undefined };
  if (typeof raw !== "string") return { ok: false, error: "Invalid bar admissions." };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Invalid bar admissions." };
  }
  if (!Array.isArray(data)) return { ok: false, error: "Invalid bar admissions." };
  if (data.length > MAX_ROWS) {
    return { ok: false, error: `At most ${MAX_ROWS} bar admissions.` };
  }
  const seen = new Set<string>();
  const value: BarAdmissionInput[] = [];
  for (const item of data) {
    const rawState = typeof item?.state === "string" ? item.state : "";
    const number = typeof item?.number === "string" ? item.number.trim() : "";
    const state = stateCode(rawState);
    if (!state) return { ok: false, error: `Unknown state "${rawState}".` };
    if (!number) return { ok: false, error: `Enter a bar number for ${state}.` };
    if (number.length > MAX_NUMBER) {
      return { ok: false, error: `Bar number for ${state} is too long.` };
    }
    if (seen.has(state)) return { ok: false, error: `${state} is listed more than once.` };
    seen.add(state);
    value.push({ state, number });
  }
  return { ok: true, value };
}

/** Replace a user's admissions with `rows`. Returns whether anything
 *  changed, so callers can log only real edits. */
export async function replaceBarAdmissions(
  tx: Tx,
  userId: string,
  rows: BarAdmissionInput[],
): Promise<boolean> {
  const current = await tx.barAdmission.findMany({
    where: { userId },
    select: { state: true, number: true },
  });
  const same =
    current.length === rows.length &&
    rows.every((r) => current.some((c) => c.state === r.state && c.number === r.number));
  if (same) return false;
  await tx.barAdmission.deleteMany({ where: { userId } });
  if (rows.length > 0) {
    await tx.barAdmission.createMany({
      data: rows.map((r) => ({ userId, state: r.state, number: r.number })),
    });
  }
  return true;
}
