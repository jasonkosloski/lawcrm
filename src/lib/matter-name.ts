/**
 * Auto matter-name helpers (pure, shared by NewMatterForm).
 *
 * The firm's pattern is `Last, First - Case Number - Location`. Only
 * person names are inverted; organization-like names ("Colorado Freedom
 * Fund", "Acme LLC") are used as typed, and generational / professional
 * suffixes ("Jr.", "III", "Esq.") stay attached to the person instead of
 * becoming the surname.
 */

const SUFFIX_RE = /^(jr|sr|ii|iii|iv|esq)\.?$/i;

/** Words that mark a name as an organization rather than a person. */
const ORG_WORD_RE =
  /(^|[\s,])(llc|l\.l\.c|inc|corp|corporation|co|company|ltd|llp|pllc|pc|p\.c|fund|foundation|association|assn|trust|union|society|coalition|center|department|university)\.?(?=$|[\s,])/i;
const ORG_PREFIX_RE = /^(the|city of|county of|state of)\s/i;

/** Heuristic: does this name read like an organization? */
export function looksLikeOrganization(name: string): boolean {
  const n = name.trim();
  return ORG_WORD_RE.test(n) || ORG_PREFIX_RE.test(n);
}

export type NameParts = {
  firstName: string;
  lastName: string;
  /** Trailing suffix ("Jr.", "III"), re-appended after the first name. */
  suffix: string;
};

/** Split a full name into first + last on the last whitespace, peeling a
 *  trailing suffix off first. Handles single-word names ("Madonna" →
 *  last only), multi-part first names ("Mary Jane Watson" →
 *  first="Mary Jane", last="Watson") and suffixes ("Maria Alvarez Jr." →
 *  first="Maria", last="Alvarez", suffix="Jr."). Organization-like names
 *  come back whole in `lastName` so they are never inverted. */
export function splitName(full: string): NameParts {
  const trimmed = full.trim();
  if (!trimmed) return { firstName: "", lastName: "", suffix: "" };
  if (looksLikeOrganization(trimmed)) {
    return { firstName: "", lastName: trimmed, suffix: "" };
  }
  const parts = trimmed.split(/\s+/);
  let suffix = "";
  if (parts.length > 1 && SUFFIX_RE.test(parts[parts.length - 1])) {
    suffix = parts.pop()!;
    // "Alvarez, Jr." -> drop the comma left on the surname.
    parts[parts.length - 1] = parts[parts.length - 1].replace(/,$/, "");
  }
  if (parts.length === 1) {
    return { firstName: "", lastName: parts[0], suffix };
  }
  return {
    lastName: parts[parts.length - 1],
    firstName: parts.slice(0, -1).join(" "),
    suffix,
  };
}

/** Build the firm's matter-name pattern from the filled-in parts.
 *  Only joins non-empty segments with " - " so partial fills read
 *  naturally: "Alvarez, Maria - Aurora" rather than "Alvarez, Maria
 *  -  - Aurora". */
export function buildAutoMatterName(parts: {
  firstName: string;
  lastName: string;
  suffix?: string;
  caseNumber: string;
  location: string;
}): string {
  const segments: string[] = [];
  const f = parts.firstName.trim();
  const l = parts.lastName.trim();
  const s = (parts.suffix ?? "").trim();
  if (f && l) segments.push(`${l}, ${f}${s ? ` ${s}` : ""}`);
  else if (l) segments.push(s ? `${l} ${s}` : l);
  else if (f) segments.push(s ? `${f} ${s}` : f);
  const c = parts.caseNumber.trim();
  if (c) segments.push(c);
  const loc = parts.location.trim();
  if (loc) segments.push(loc);
  return segments.join(" - ");
}

/** The auto name for a client name + case number + location. Pass
 *  `isOrganization` when the picked contact is known to be an
 *  organization (the name is then never inverted). */
export function autoMatterName(input: {
  clientName: string;
  isOrganization?: boolean;
  caseNumber: string;
  location: string;
}): string {
  const name = input.clientName.trim();
  const nameParts = input.isOrganization
    ? { firstName: "", lastName: name, suffix: "" }
    : splitName(name);
  return buildAutoMatterName({
    ...nameParts,
    caseNumber: input.caseNumber,
    location: input.location,
  });
}
