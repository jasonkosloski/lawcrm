/**
 * Flagged-moment category constants — client-safe (no Prisma imports).
 *
 * Canonical home for the FlaggedMoment.category value set (see the
 * schema doc comment on FlaggedMoment). Categories are the reviewer's
 * shorthand while scrubbing bodycam / dashcam / call recordings:
 * what kind of moment is this, and how loudly should it render.
 *
 * Tones map onto the app's status-chip vocabulary
 * (docs/UI_PATTERNS.md → Status Chip): `warn` for the
 * jury-is-listening categories (use of force, critical), `brand`
 * for the legal-hook categories (Miranda, contradiction), `neutral`
 * for reviewer bookkeeping (emphasis, anomaly).
 */

export const FLAG_CATEGORIES = [
  "critical",
  "emphasis",
  "anomaly",
  "miranda",
  "use_of_force",
  "contradiction",
] as const;

export type FlagCategory = (typeof FLAG_CATEGORIES)[number];

export const FLAG_CATEGORY_LABEL: Record<FlagCategory, string> = {
  critical: "Critical",
  emphasis: "Emphasis",
  anomaly: "Anomaly",
  miranda: "Miranda",
  use_of_force: "Use of force",
  contradiction: "Contradiction",
};

/** Chip tone per category — keys into FLAG_TONE_CHIP_CLASS below. */
export const FLAG_CATEGORY_TONE: Record<
  FlagCategory,
  "warn" | "brand" | "neutral"
> = {
  critical: "warn",
  use_of_force: "warn",
  miranda: "brand",
  contradiction: "brand",
  emphasis: "neutral",
  anomaly: "neutral",
};

/** Tone → pill classes, matching the app-wide status-chip recipes
 *  (same strings the document viewer's STATUS_META uses). */
export const FLAG_TONE_CHIP_CLASS: Record<
  (typeof FLAG_CATEGORY_TONE)[FlagCategory],
  string
> = {
  warn: "bg-warn-soft text-warn border-warn-border",
  brand: "bg-brand-soft text-brand-700 border-brand-200",
  neutral: "bg-paper-2 text-ink-3 border-line",
};

/** Convenience: category → its full chip class string. */
export function flagCategoryChipClass(category: FlagCategory): string {
  return FLAG_TONE_CHIP_CLASS[FLAG_CATEGORY_TONE[category]];
}
