/**
 * Command-palette scoping prefixes — pure parsing + value tagging.
 *
 * Syntax (documented in the palette's placeholder + footer):
 *   `#query` → matters only
 *   `@query` → people only (contacts, firm users, AND leads — a
 *              scoped person search that misses a lead named "Jane"
 *              would feel broken, so leads count as people here)
 *   `>query` → actions only (navigation + create-new + contextual)
 *
 * A prefix is recognized ONLY as the first non-whitespace character
 * of the input — a mid-word `#` ("case #123") is part of the query,
 * not a scope. Bare queries parse to `scope: null` and keep the
 * palette's existing behavior.
 *
 * Scoping is enforced in cmdk's custom `filter` via value tagging:
 * every CommandItem's `value` is wrapped by `paletteValue(kind, …)`
 * which prepends a `$kind$ ` sentinel; the filter splits it back out
 * with `splitPaletteValue`, drops rows whose kind the active scope
 * doesn't allow, and matches the search term against the untagged
 * text only (so typing "$matter$" never matches anything, and the
 * tag never pollutes ranking).
 *
 * Kept free of React/component imports so it stays a pure module —
 * unit-tested in prefix.test.ts.
 */

import type { SearchHitType } from "@/lib/constants/search";

export type PaletteScope = "matters" | "people" | "actions";

/** What a CommandItem's value is tagged as. `person` covers contacts
 *  and firm users; leads keep their own tag but are allowed under the
 *  `people` scope (see scopeAllowsKind). */
export type PaletteValueKind = "matter" | "person" | "lead" | "action";

export type ParsedPaletteQuery = {
  scope: PaletteScope | null;
  /** The query with any prefix stripped, trimmed. What matching,
   *  min-length gates, and /search?q= should all use. */
  term: string;
};

const PREFIX_SCOPE: Record<string, PaletteScope> = {
  "#": "matters",
  "@": "people",
  ">": "actions",
};

/**
 * Split a raw palette query into scope + term.
 *
 * - `""`        → { scope: null,      term: "" }
 * - `"smith"`   → { scope: null,      term: "smith" }
 * - `"#"`       → { scope: "matters", term: "" }   (prefix only → show whole group)
 * - `"# smith"` → { scope: "matters", term: "smith" } (prefix + space ok)
 * - `"case #1"` → { scope: null,      term: "case #1" } (mid-word # is literal)
 */
export function parsePaletteQuery(raw: string): ParsedPaletteQuery {
  const input = raw.trimStart();
  const scope = PREFIX_SCOPE[input.charAt(0)] ?? null;
  if (!scope) return { scope: null, term: raw.trim() };
  return { scope, term: input.slice(1).trim() };
}

// ── Value tagging ───────────────────────────────────────────────────────

/** Separator between a value's matchable text and its unique-id
 *  suffix (an ASCII control char: it can't appear in user text and
 *  survives cmdk's value trim). */
const UID_SEP = "\u001f";

/** Wrap a CommandItem `value` with its kind sentinel.
 *
 *  cmdk treats `value` as the item's IDENTITY (selection and
 *  arrow-key navigation compare values), so two rows that render the
 *  same text (a Recent row and its Navigation twin, two contacts with
 *  the same name) must not share one — pass a `uid` that is unique
 *  per rendered row (e.g. `recent:matter:<id>`). The uid is stripped
 *  again by splitPaletteValue and never takes part in matching. */
export function paletteValue(kind: PaletteValueKind, text: string, uid?: string): string {
  return `$${kind}$ ${text}${uid ? `${UID_SEP}${uid}` : ""}`;
}

const VALUE_TAG_RE = /^\$(matter|person|lead|action)\$ /;

/** Inverse of paletteValue. Unknown / missing tags come back with
 *  `kind: null` and the value untouched (forward-compat: an untagged
 *  row still matches bare queries, it just never matches a scope). */
export function splitPaletteValue(value: string): {
  kind: PaletteValueKind | null;
  text: string;
} {
  const sep = value.lastIndexOf(UID_SEP);
  const bare = sep === -1 ? value : value.slice(0, sep);
  const m = VALUE_TAG_RE.exec(bare);
  if (!m) return { kind: null, text: bare };
  return {
    kind: m[1] as PaletteValueKind,
    text: bare.slice(m[0].length),
  };
}

/** Which value kinds survive under each scope. */
export function scopeAllowsKind(scope: PaletteScope, kind: PaletteValueKind | null): boolean {
  if (kind === null) return false;
  switch (scope) {
    case "matters":
      return kind === "matter";
    case "people":
      return kind === "person" || kind === "lead";
    case "actions":
      return kind === "action";
  }
}

/**
 * ?type= value for /search when the "Search everywhere" row fires
 * under a scope. Typed against SearchHitType (client-safe constants
 * module), so a renamed search type fails to compile here instead of
 * producing a dead ?type= link.
 *
 * - matters → full-text scoped to the matter group
 * - people  → scoped to contacts (users/leads have no full-text group;
 *             contacts is the closest useful narrowing)
 * - actions → null: actions aren't full-text-searchable, the row hides
 */
export const SCOPE_SEARCH_TYPE: Record<PaletteScope, SearchHitType | null> = {
  matters: "matter",
  people: "contact",
  actions: null,
};
