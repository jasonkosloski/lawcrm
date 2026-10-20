/**
 * Auto matter-name helpers (pure, shared by NewMatterForm).
 *
 * The firm's pattern is `Last, First - Case Number - Location`. Only
 * person names are inverted; organization-like names ("Colorado Freedom
 * Fund", "Acme LLC") are used as typed, and generational / professional
 * suffixes ("Jr.", "III", "Esq.") stay attached to the person instead of
 * becoming the surname.
 */

import {
  DEFAULT_MATTER_NAME_TEMPLATE,
  renderMatterName,
} from "./matter-name-template";

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

/** Temporary wrapper (Task 8 removes it): the default template over the old inputs. */
export function autoMatterName(input: {
  clientName: string;
  isOrganization?: boolean;
  caseNumber: string;
  location: string;
}): string {
  return renderMatterName(DEFAULT_MATTER_NAME_TEMPLATE, {
    clientName: input.clientName,
    isOrganization: input.isOrganization,
    caseNumber: input.caseNumber,
    venue: input.location ? { name: input.location, county: null, state: "" } : null,
    opposingParty: "",
    practiceAreaName: "",
    now: new Date(),
    timeZone: "UTC",
  });
}
