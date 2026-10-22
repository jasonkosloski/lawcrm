/**
 * Matter-name token templates (pure). A template mixes literal text with
 * `{token}` placeholders, e.g. `{client_last}, {client_first} - {case_number}`.
 * Tokens with an empty value drop out together with the literal text that
 * introduced them, so partial fills read naturally.
 */
import { splitName } from "./matter-name";

export const MATTER_NAME_TOKENS = [
  "client_first",
  "client_last",
  "client_full",
  "case_number",
  "location",
  "county",
  "state",
  "opposing_party",
  "practice_area",
  "year",
] as const;

export type MatterNameToken = (typeof MATTER_NAME_TOKENS)[number];

export const DEFAULT_MATTER_NAME_TEMPLATE =
  "{client_last}, {client_first} - {case_number} - {location}";

export type Segment = { kind: "literal"; text: string } | { kind: "token"; token: MatterNameToken };

export type MatterNameInput = {
  clientName: string;
  isOrganization?: boolean;
  caseNumber: string;
  venue: { name: string; county: string | null; state: string } | null;
  opposingParty: string;
  practiceAreaName: string;
  now: Date;
  timeZone: string;
};

const TOKEN_SET = new Set<string>(MATTER_NAME_TOKENS);

/** Split a template into alternating literal/token segments. */
export function parseTemplate(
  t: string,
): { ok: true; segments: Segment[] } | { ok: false; error: string } {
  const segments: Segment[] = [];
  let literal = "";
  let tokenCount = 0;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === "}") {
      return { ok: false, error: 'Unbalanced braces: unexpected "}".' };
    }
    if (ch !== "{") {
      literal += ch;
      continue;
    }
    const end = t.indexOf("}", i + 1);
    if (end === -1) {
      return { ok: false, error: 'Unbalanced braces: missing closing "}".' };
    }
    const name = t.slice(i + 1, end);
    if (name.includes("{")) {
      return { ok: false, error: 'Unbalanced braces: missing closing "}".' };
    }
    if (!TOKEN_SET.has(name)) {
      return { ok: false, error: `Unknown token "${name}".` };
    }
    segments.push({ kind: "literal", text: literal });
    segments.push({ kind: "token", token: name as MatterNameToken });
    literal = "";
    tokenCount++;
    i = end;
  }
  if (tokenCount === 0) {
    return { ok: false, error: "Template must contain at least one token." };
  }
  segments.push({ kind: "literal", text: literal });
  return { ok: true, segments };
}

function yearIn(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric" }).format(now);
}

export function tokenValues(input: MatterNameInput): Record<MatterNameToken, string> {
  const name = input.clientName.trim();
  const parts = input.isOrganization
    ? { firstName: "", lastName: name, suffix: "" }
    : splitName(name);
  const suffix = parts.suffix.trim();
  const first = parts.firstName.trim();
  const last = parts.lastName.trim();
  // The suffix follows the first name; with no first name it follows the last.
  const clientFirst = first && suffix ? `${first} ${suffix}` : first;
  const clientLast = !first && last && suffix ? `${last} ${suffix}` : last;
  return {
    client_first: clientFirst,
    client_last: clientLast || (!first && suffix ? suffix : ""),
    client_full: name,
    case_number: input.caseNumber.trim(),
    location: input.venue?.name.trim() ?? "",
    county: input.venue?.county?.trim() ?? "",
    state: input.venue?.state.trim() ?? "",
    opposing_party: input.opposingParty.trim(),
    practice_area: input.practiceAreaName.trim(),
    year: yearIn(input.now, input.timeZone),
  };
}

/** Render a template; an invalid template or all-empty tokens yield "". */
export function renderMatterName(template: string, input: MatterNameInput): string {
  const parsed = parseTemplate(template);
  if (!parsed.ok) return "";
  const values = tokenValues(input);
  const segs = parsed.segments;
  // segs = L0 T1 L1 T2 ... Tn Ln
  const n = (segs.length - 1) / 2;
  let out = "";
  let any = false;
  for (let j = 1; j <= n; j++) {
    const tok = segs[2 * j - 1] as { kind: "token"; token: MatterNameToken };
    const value = values[tok.token].trim();
    if (!value) continue;
    const before = (segs[2 * (j - 1)] as { text: string }).text;
    out += (any ? before : (segs[0] as { text: string }).text) + value;
    any = true;
    if (j === n) out += (segs[2 * n] as { text: string }).text;
  }
  if (!any) return "";
  return out
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:[-,]\s*)+|(?:\s*[-,])+$/g, "")
    .trim();
}

/** The practice area's own template when set, else the firm default. */
export function effectiveTemplate(
  area: { matterNameTemplate: string | null } | null,
  firmTemplate: string,
): string {
  return area?.matterNameTemplate || firmTemplate;
}
