import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ── Pluralization ──────────────────────────────────────────────────

/** Nouns whose plural isn't "+s" / "+es" / "y→ies". Add here as
 *  they show up in count labels — this is a display helper, not a
 *  full inflection engine. */
const IRREGULAR_PLURALS: Record<string, string> = {
  person: "people",
  child: "children",
};

/** Plural form of a single (lowercase or capitalized) English noun.
 *  Handles the regular rules we actually hit in count labels:
 *  "+s", sibilant "+es" (match → matches), consonant-y → "ies"
 *  (party → parties, entry → entries), plus the irregulars map.
 *  Pass `pluralForm` to override for anything exotic. */
export function pluralize(noun: string, pluralForm?: string): string {
  if (pluralForm) return pluralForm;
  const lower = noun.toLowerCase();
  const irregular = IRREGULAR_PLURALS[lower];
  if (irregular) {
    // Preserve a leading capital ("Person" → "People").
    return noun[0] === noun[0]?.toUpperCase() && noun[0] !== noun[0]?.toLowerCase()
      ? irregular[0].toUpperCase() + irregular.slice(1)
      : irregular;
  }
  if (/(?:s|x|z|ch|sh)$/i.test(noun)) return `${noun}es`;
  if (/[^aeiou]y$/i.test(noun)) return `${noun.slice(0, -1)}ies`;
  return `${noun}s`;
}

/** Count label that gets the singular right: `plural(1, "matter")`
 *  → "1 matter", `plural(2, "matter")` → "2 matters". Third arg
 *  overrides the plural form for irregulars the rules don't cover. */
export function plural(n: number, noun: string, pluralForm?: string): string {
  return `${n} ${n === 1 ? noun : pluralize(noun, pluralForm)}`;
}
