/**
 * Media timestamp helpers — mm:ss (and h:mm:ss past the hour)
 * formatting + parsing for the evidence-review surfaces. Pure
 * functions so the flag composer, moments rail, and evidence page
 * all agree on exactly one clock notation.
 *
 * Storage is seconds (FlaggedMoment.timeSeconds Float); display is
 * "mm:ss" for anything under an hour and "h:mm:ss" above — bodycam
 * runs long. Parsing accepts what a reviewer would plausibly type:
 * "75" (bare seconds), "1:15", "01:15", "1:02:03". Fractional
 * seconds are floored on format and rejected on parse (the player
 * seeks by whole seconds; sub-second precision is a follow-up).
 */

/** Hard ceiling shared with the server action — 24h of media. */
export const MAX_MEDIA_SECONDS = 24 * 60 * 60;

/** Seconds → "m:ss" / "mm:ss" / "h:mm:ss". Negative, NaN, and
 *  non-finite inputs clamp to 0:00 (defensive — stored values are
 *  validated, but currentTime reads can race a source swap). */
export function formatMediaTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${ss}`;
  return `${m}:${ss}`;
}

/** "1:15" / "01:15" / "1:02:03" / bare "75" → seconds, or null when
 *  the input isn't a valid clock time. Rules:
 *   - 1–3 colon-separated integer segments;
 *   - non-leading segments must be 0–59 (and zero-padded typing like
 *     "1:5" is tolerated — it reads as 1:05);
 *   - result must land in [0, MAX_MEDIA_SECONDS]. */
export function parseMediaTime(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const parts = trimmed.split(":");
  if (parts.length > 3) return null;
  const nums: number[] = [];
  for (const part of parts) {
    // Digits only — rejects negatives, decimals, whitespace-in-part.
    if (!/^\d+$/.test(part)) return null;
    nums.push(Number(part));
  }
  // Sub-units (seconds, and minutes when hours are present) cap at 59.
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] > 59) return null;
  }
  let seconds = 0;
  for (const n of nums) seconds = seconds * 60 + n;
  if (seconds > MAX_MEDIA_SECONDS) return null;
  return seconds;
}

/** "0:42" or "0:42–1:05" — the rail/evidence-page span notation. */
export function formatMediaSpan(
  timeSeconds: number,
  endSeconds: number | null | undefined
): string {
  const start = formatMediaTime(timeSeconds);
  if (endSeconds === null || endSeconds === undefined) return start;
  return `${start}–${formatMediaTime(endSeconds)}`;
}
