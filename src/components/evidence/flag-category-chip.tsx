/**
 * Category chip for flagged moments — the one place the category →
 * label + tone mapping turns into pixels, shared by the viewer's
 * moments rail and the matter Evidence review tab. Server-safe.
 *
 * Unknown categories (schema is a free string) render neutral with
 * the raw value so a bad row degrades visibly instead of crashing.
 */

import {
  FLAG_CATEGORY_LABEL,
  FLAG_TONE_CHIP_CLASS,
  flagCategoryChipClass,
  type FlagCategory,
} from "@/lib/constants/flag-category";

export function FlagCategoryChip({ category }: { category: string }) {
  const known = category in FLAG_CATEGORY_LABEL;
  const label = known
    ? FLAG_CATEGORY_LABEL[category as FlagCategory]
    : category;
  const className = known
    ? flagCategoryChipClass(category as FlagCategory)
    : FLAG_TONE_CHIP_CLASS.neutral;
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-2xs font-medium whitespace-nowrap ${className}`}
    >
      {label}
    </span>
  );
}
