/**
 * Template merge engine — the field catalog + `{{token}}` renderer
 * behind the document-template library.
 *
 * Client-safe and pure: resolvers read from a plain `MergeContext`
 * object (no Prisma, no session). Server actions build the context
 * from the matter + firm + user (see
 * `src/app/actions/document-templates.ts`); the settings editor's
 * live preview feeds `SAMPLE_MERGE_CONTEXT` instead so it never
 * needs a matter fetch.
 *
 * Merge semantics — never silently swallow:
 *   - Known field that resolves      → replaced with the value.
 *   - Known field that resolves NULL → replaced with a visible
 *     "[key — not on file]" placeholder AND reported in `missing`,
 *     so the generated letter can't quietly ship a blank where the
 *     client's address should be.
 *   - Unknown token ({{typo.field}}) → left in the output exactly
 *     as written AND reported in `unresolved`, so the UI can warn
 *     before anyone files the thing. Malformed tokens ({{client-name}},
 *     {{client name}}) are treated the same way.
 */

import { formatDate, formatDateOnly } from "@/lib/format-date";

// ── Context ────────────────────────────────────────────────────────────

export type MergeContext = {
  matter: {
    name: string;
    /** Court docket number (`Matter.caseNumber`) — the matter's only
     *  number-ish identifier today. Null until a case is filed. */
    caseNumber: string | null;
    /** Practice-area display name (resolved from the FK). */
    practiceArea: string | null;
    /** Current lifecycle stage display name. */
    stage: string | null;
    court: string | null;
    opposingParty: string | null;
    incidentDate: Date | null;
    /** `Matter.statuteOfLimitationsDate`. */
    solDate: Date | null;
  };
  /** The matter's client contact; null when no client is linked. */
  client: {
    name: string;
    email: string | null;
    phone: string | null;
    /** Composed single-line mailing address (street, city ST zip). */
    address: string | null;
  } | null;
  firm: {
    name: string;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    phone: string | null;
    email: string | null;
  };
  /** The user generating the document. */
  user: { name: string | null };
  /** "Now" for the {{today}} field — injectable for tests/previews. */
  today: Date;
  /** IANA zone the date fields format in; null = runtime local. */
  timeZone: string | null;
};

/** "Denver, CO 80202" — joins whatever city/state/zip parts exist,
 *  null when none do. Shared by the firm + client address fields. */
export function composeCityStateZip(
  city: string | null,
  state: string | null,
  zip: string | null
): string | null {
  const locality = [city, state].filter(Boolean).join(", ");
  const line = [locality, zip].filter(Boolean).join(" ").trim();
  return line.length > 0 ? line : null;
}

// ── Field catalog ──────────────────────────────────────────────────────

export type MergeFieldGroup = "Matter" | "Client" | "Firm" | "General";

export type MergeField = {
  /** Token key as written in template bodies: `{{matter.name}}`. */
  key: string;
  label: string;
  description: string;
  group: MergeFieldGroup;
  /** Null = "not on file" — merge renders a visible placeholder and
   *  reports the key in `missing`. Never return "" to mean absent. */
  resolve: (ctx: MergeContext) => string | null;
};

/** Real instants (today) render "long" ("April 15, 2026") in the
 *  generating user's zone — letter-appropriate. */
const instantDate = (d: Date, ctx: MergeContext): string =>
  formatDate(d, "long", ctx.timeZone);

/** Date-only values (Matter incidentDate / statuteOfLimitationsDate)
 *  are calendar dates stored at UTC midnight (ADR-012). They are read
 *  on the UTC day grid and NEVER shifted into the user's zone — doing
 *  so renders them a day early for every user west of UTC, which in a
 *  letter or pleading is a wrong incident date / limitations date. */
const calendarDate = (d: Date | null): string | null =>
  d ? formatDateOnly(d, "long") : null;

/** Normalize "present but blank" to null so it takes the visible
 *  missing-placeholder path instead of merging an invisible "". */
const text = (v: string | null | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

export const MERGE_FIELDS: readonly MergeField[] = [
  // ── Matter ──
  {
    key: "matter.name",
    label: "Matter name",
    description: 'Display name, e.g. "Alvarez v. City of Aurora".',
    group: "Matter",
    resolve: (ctx) => text(ctx.matter.name),
  },
  {
    key: "matter.caseNumber",
    label: "Case number",
    description: 'Court docket number, e.g. "2026-CV-00481".',
    group: "Matter",
    resolve: (ctx) => text(ctx.matter.caseNumber),
  },
  {
    key: "matter.practiceArea",
    label: "Practice area",
    description: "The matter's practice area name.",
    group: "Matter",
    resolve: (ctx) => text(ctx.matter.practiceArea),
  },
  {
    key: "matter.stage",
    label: "Stage",
    description: "Current lifecycle stage of the matter.",
    group: "Matter",
    resolve: (ctx) => text(ctx.matter.stage),
  },
  {
    key: "matter.court",
    label: "Court",
    description: 'Court and judge, e.g. "D. Colorado · Hon. L. Martinez".',
    group: "Matter",
    resolve: (ctx) => text(ctx.matter.court),
  },
  {
    key: "matter.opposingParty",
    label: "Opposing party",
    description: "Name of the opposing party or counsel.",
    group: "Matter",
    resolve: (ctx) => text(ctx.matter.opposingParty),
  },
  {
    key: "matter.incidentDate",
    label: "Incident date",
    description: "Date the cause of action accrued.",
    group: "Matter",
    resolve: (ctx) => calendarDate(ctx.matter.incidentDate),
  },
  {
    key: "matter.solDate",
    label: "SOL date",
    description: "Statute-of-limitations deadline.",
    group: "Matter",
    resolve: (ctx) => calendarDate(ctx.matter.solDate),
  },

  // ── Client ──
  {
    key: "client.name",
    label: "Client name",
    description: "The matter's client contact.",
    group: "Client",
    resolve: (ctx) => text(ctx.client?.name ?? null),
  },
  {
    key: "client.email",
    label: "Client email",
    description: "Client's email address.",
    group: "Client",
    resolve: (ctx) => text(ctx.client?.email ?? null),
  },
  {
    key: "client.phone",
    label: "Client phone",
    description: "Client's primary phone number.",
    group: "Client",
    resolve: (ctx) => text(ctx.client?.phone ?? null),
  },
  {
    key: "client.address",
    label: "Client address",
    description: "Client's mailing address on one line.",
    group: "Client",
    resolve: (ctx) => text(ctx.client?.address ?? null),
  },

  // ── Firm ──
  {
    key: "firm.name",
    label: "Firm name",
    description: "Your firm's display name.",
    group: "Firm",
    resolve: (ctx) => text(ctx.firm.name),
  },
  {
    key: "firm.addressLine1",
    label: "Firm address line 1",
    description: "Street address of the primary office.",
    group: "Firm",
    resolve: (ctx) => text(ctx.firm.addressLine1),
  },
  {
    key: "firm.addressLine2",
    label: "Firm address line 2",
    description: "Suite / unit line, when the office has one.",
    group: "Firm",
    resolve: (ctx) => text(ctx.firm.addressLine2),
  },
  {
    key: "firm.cityStateZip",
    label: "Firm city/state/zip",
    description: 'Composed locality line, e.g. "Denver, CO 80202".',
    group: "Firm",
    resolve: (ctx) =>
      composeCityStateZip(ctx.firm.city, ctx.firm.state, ctx.firm.zip),
  },
  {
    key: "firm.phone",
    label: "Firm phone",
    description: "Main reception line.",
    group: "Firm",
    resolve: (ctx) => text(ctx.firm.phone),
  },
  {
    key: "firm.email",
    label: "Firm email",
    description: "Main contact email.",
    group: "Firm",
    resolve: (ctx) => text(ctx.firm.email),
  },

  // ── General ──
  {
    key: "user.name",
    label: "Your name",
    description: "The user generating the document.",
    group: "General",
    resolve: (ctx) => text(ctx.user.name),
  },
  {
    key: "today",
    label: "Today's date",
    description:
      'Generation date, e.g. "April 15, 2026" (your time zone).',
    group: "General",
    resolve: (ctx) => instantDate(ctx.today, ctx),
  },
];

const FIELD_BY_KEY = new Map(MERGE_FIELDS.map((f) => [f.key, f]));

/** Catalog grouped for the editor's insert-field picker, in display
 *  order. Precomputed once — the list is static. */
export const MERGE_FIELD_GROUPS: ReadonlyArray<{
  group: MergeFieldGroup;
  fields: readonly MergeField[];
}> = (["Matter", "Client", "Firm", "General"] as const).map((group) => ({
  group,
  fields: MERGE_FIELDS.filter((f) => f.group === group),
}));

// ── Merge ──────────────────────────────────────────────────────────────

export type MergeResult = {
  text: string;
  /** Tokens with no catalog entry — left intact in the output. */
  unresolved: string[];
  /** Known fields with nothing on file — rendered as a visible
   *  "[key — not on file]" placeholder. */
  missing: string[];
};

/** Matches any short `{{ ... }}` span (no nested braces). The inner
 *  text is trimmed and checked against KEY_RE below; a span that is
 *  not a well-formed key ({{client-name}}, {{client name}}) is still
 *  reported as unresolved rather than silently shipping literally. */
const TOKEN_RE = /\{\{([^{}]{0,80})\}\}/g;

/** A well-formed field key: dotted alphanumeric. */
const KEY_RE = /^[A-Za-z0-9_.]+$/;

/**
 * Render a template body against a context. Every token outcome is
 * visible in the output and reported — see the file header for the
 * three-way semantics. Lists are de-duplicated, first-seen order.
 */
export function mergeTemplate(
  body: string,
  ctx: MergeContext
): MergeResult {
  const unresolved: string[] = [];
  const missing: string[] = [];
  const seenUnresolved = new Set<string>();
  const seenMissing = new Set<string>();

  const text = body.replace(TOKEN_RE, (token, inner: string) => {
    const key = inner.trim();
    const field = KEY_RE.test(key) ? FIELD_BY_KEY.get(key) : undefined;
    if (!field) {
      if (!seenUnresolved.has(key)) {
        seenUnresolved.add(key);
        unresolved.push(key);
      }
      return token; // keep the literal {{key}} visible
    }
    const value = field.resolve(ctx);
    if (value === null) {
      if (!seenMissing.has(key)) {
        seenMissing.add(key);
        missing.push(key);
      }
      return `[${key} — not on file]`;
    }
    return value;
  });

  return { text, unresolved, missing };
}

// ── Sample context ─────────────────────────────────────────────────────

/**
 * Obviously-fake context for the settings editor's live preview —
 * no matter fetch needed, deterministic output. Every field is
 * populated so the preview only warns about UNKNOWN tokens (typos),
 * never about sample data gaps.
 */
export const SAMPLE_MERGE_CONTEXT: MergeContext = {
  matter: {
    name: "Sample v. Example Insurance Co.",
    caseNumber: "2026-CV-00000",
    practiceArea: "Personal Injury (sample)",
    stage: "Discovery (sample)",
    court: "Sample District Court · Hon. A. Example",
    opposingParty: "Example Insurance Co.",
    // Date-only values live at UTC midnight (ADR-012).
    incidentDate: new Date(Date.UTC(2025, 5, 1)), // June 1, 2025
    solDate: new Date(Date.UTC(2027, 5, 1)), // June 1, 2027
  },
  client: {
    name: "Sam Sample (sample client)",
    email: "sam.sample@example.com",
    phone: "(555) 555-0100",
    address: "123 Placeholder Ave, Sampletown, CO 80000",
  },
  firm: {
    name: "Your Firm Name, P.C.",
    addressLine1: "456 Example St",
    addressLine2: "Suite 700",
    city: "Sampletown",
    state: "CO",
    zip: "80000",
    phone: "(555) 555-0199",
    email: "info@yourfirm.example",
  },
  user: { name: "You (preview)" },
  // Fixed instant so the preview is stable; UTC noon keeps the day
  // the same in any zone the browser runs.
  today: new Date(Date.UTC(2026, 3, 15, 12)), // April 15, 2026
  timeZone: null,
};
