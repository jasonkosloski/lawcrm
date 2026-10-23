/**
 * Typed field catalog for structured templates. Declarative: each
 * entry says where its value comes from (`get`) and which formats it
 * allows; formatting itself lives in format.ts. Pure and client-safe.
 *
 * Paths keep every legacy `template-merge.ts` key verbatim so legacy
 * `{{token}}` conversion is the identity mapping.
 */

import { addressLines, cityStateZip } from "@/lib/address";
import type { AppliesTo } from "./schema";

// ── Types ──────────────────────────────────────────────────────────────

export type FieldType = "text" | "date" | "boolean" | "enum" | "address" | "person";

export type FieldFormat =
  "long" | "short" | "iso" | "full" | "first" | "last" | "as_is" | "upper" | "block" | "one_line";

export type Scope = "matter" | "lead";

export type AddressValue = { lines: string[] };

/** A name-like value. Contacts store one `name`; when the contact is an
 *  organization (`isOrganization`), first/last formats return the full
 *  name. */
export type PersonValue = { name: string; isOrganization?: boolean };

export type FieldValue = string | Date | boolean | AddressValue | PersonValue | null;

export const FIELD_GROUPS = [
  "Firm",
  "Today & user",
  "Matter",
  "Lead",
  "Client",
  "Signer",
  "Recipient",
  "Parties",
  "Records request",
] as const;
export type FieldGroup = (typeof FIELD_GROUPS)[number];

export type ContactData = {
  name: string;
  isOrganization: boolean;
  /** Organization the contact belongs to (distinct from being one). */
  organization: string | null;
  email: string | null;
  phone: string | null;
  addressLines: string[];
};

export type SignerData = {
  name: string;
  title: string | null;
  barNumber: string | null;
  email: string | null;
  phone: string | null;
};

export type CounselData = {
  name: string;
  email: string | null;
  phone: string | null;
  addressLines: string[];
};

export type PartyItem = {
  name: string;
  isOrganization: boolean;
  email: string | null;
  phone: string | null;
  addressLines: string[];
  role: string | null;
  /** Representation, for opposing parties. */
  counsel: CounselData | null;
};

export type PersonItem = {
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
};

export type ListItem = PartyItem | PersonItem;

export type PartyListKey =
  | "clients"
  | "opposing"
  | "defendants"
  | "plaintiffs"
  | "opposingCounsel"
  | "witnesses"
  | "experts";

export type TemplateData = {
  scope: Scope;
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
  user: { name: string | null };
  /** An instant; formatted in `timeZone`. */
  today: Date;
  timeZone: string | null;
  matter: {
    name: string;
    caseNumber: string | null;
    court: string | null;
    venueName: string | null;
    venueAddressLine1: string | null;
    venueAddressLine2: string | null;
    venueCity: string | null;
    venueCounty: string | null;
    venueState: string | null;
    venueZip: string | null;
    /** Venue caption name, else venue name. */
    courtCaption: string | null;
    practiceArea: string | null;
    stage: string | null;
    /** Date-only fields are UTC-midnight calendar dates (ADR-012). */
    incidentDate: Date | null;
    solDate: Date | null;
    filedDate: Date | null;
    trialDate: Date | null;
    opposingParty: string | null;
  } | null;
  lead: {
    name: string;
    incidentDate: Date | null;
    location: string | null;
    source: string | null;
    summary: string | null;
    stage: string | null;
  } | null;
  client: ContactData | null;
  signer: SignerData | null;
  recipient: ContactData | null;
  parties: Record<PartyListKey, PartyItem[]>;
  team: PersonItem[];
  request: {
    subject: string;
    description: string | null;
    type: string | null;
    dateRangeStart: Date | null;
    dateRangeEnd: Date | null;
    responseDueDate: Date | null;
    sentDate: Date | null;
  } | null;
  custodian: ContactData | null;
};

export type CatalogField = {
  path: string;
  label: string;
  group: FieldGroup;
  type: FieldType;
  scopes: Scope[];
  formats: FieldFormat[];
  defaultFormat: FieldFormat | null;
  /** Date fields: true for calendar dates (UTC-midnight, never zone
   *  shifted); false/absent for instants like `today`. */
  dateOnly?: boolean;
  /** Item fields (CatalogList.itemFields) read `item`; others ignore it. */
  get(d: TemplateData, item?: ListItem): FieldValue;
};

export type CatalogList = {
  path: string;
  label: string;
  scopes: Scope[];
  /** Paths relative to the item: "name", "address", "counsel.name". */
  itemFields: CatalogField[];
  get(d: TemplateData): ListItem[];
};

// ── Helpers ────────────────────────────────────────────────────────────

const BOTH: Scope[] = ["matter", "lead"];
const MATTER: Scope[] = ["matter"];
const LEAD: Scope[] = ["lead"];

const TEXT_FORMATS: FieldFormat[] = ["as_is", "upper"];
const DATE_FORMATS: FieldFormat[] = ["long", "short", "iso"];
const NAME_FORMATS: FieldFormat[] = ["full", "first", "last"];
const ADDRESS_FORMATS: FieldFormat[] = ["block", "one_line"];

const str = (v: string | null | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

const person = (name: string | null | undefined, isOrganization = false): PersonValue | null => {
  const n = str(name);
  return n ? { name: n, isOrganization } : null;
};

const address = (lines: string[] | null | undefined): AddressValue | null => {
  const l = (lines ?? []).map((x) => x.trim()).filter(Boolean);
  return l.length > 0 ? { lines: l } : null;
};

type Def = Omit<CatalogField, "scopes" | "formats" | "defaultFormat"> &
  Partial<Pick<CatalogField, "scopes" | "formats" | "defaultFormat">>;

/** Fill in the per-type format defaults. */
function field(def: Def): CatalogField {
  let formats: FieldFormat[];
  let defaultFormat: FieldFormat | null;
  switch (def.type) {
    case "date":
      formats = DATE_FORMATS;
      defaultFormat = "long";
      break;
    case "person":
      formats = NAME_FORMATS;
      defaultFormat = "full";
      break;
    case "address":
      formats = ADDRESS_FORMATS;
      defaultFormat = "one_line";
      break;
    case "boolean":
      formats = [];
      defaultFormat = null;
      break;
    default:
      formats = TEXT_FORMATS;
      defaultFormat = null;
  }
  return {
    scopes: BOTH,
    formats,
    defaultFormat,
    ...def,
  };
}

const text = (
  path: string,
  label: string,
  group: FieldGroup,
  get: CatalogField["get"],
  scopes: Scope[] = BOTH,
  type: "text" | "enum" = "text",
) => field({ path, label, group, type, scopes, get });

const date = (
  path: string,
  label: string,
  group: FieldGroup,
  get: CatalogField["get"],
  scopes: Scope[] = BOTH,
  dateOnly = true,
) => field({ path, label, group, type: "date", scopes, dateOnly, get });

// ── Fields ─────────────────────────────────────────────────────────────

const contactFields = (
  prefix: "client" | "recipient" | "custodian",
  group: FieldGroup,
  noun: string,
  pick: (d: TemplateData) => ContactData | null,
): CatalogField[] => [
  field({
    path: `${prefix}.name`,
    label: `${noun} name`,
    group,
    type: "person",
    get: (d) => {
      const c = pick(d);
      return c ? person(c.name, c.isOrganization) : null;
    },
  }),
  text(`${prefix}.organization`, `${noun} organization`, group, (d) => str(pick(d)?.organization)),
  field({
    path: `${prefix}.address`,
    label: `${noun} address`,
    group,
    type: "address",
    get: (d) => address(pick(d)?.addressLines),
  }),
  text(`${prefix}.email`, `${noun} email`, group, (d) => str(pick(d)?.email)),
  text(`${prefix}.phone`, `${noun} phone`, group, (d) => str(pick(d)?.phone)),
];

const m = (d: TemplateData) => d.matter;
const l = (d: TemplateData) => d.lead;

export const FIELDS: readonly CatalogField[] = [
  // ── Firm ──
  text("firm.name", "Firm name", "Firm", (d) => str(d.firm.name)),
  field({
    path: "firm.address",
    label: "Firm address",
    group: "Firm",
    type: "address",
    get: (d) => address(addressLines(d.firm)),
  }),
  text("firm.addressLine1", "Firm address line 1", "Firm", (d) => str(d.firm.addressLine1)),
  text("firm.addressLine2", "Firm address line 2", "Firm", (d) => str(d.firm.addressLine2)),
  text("firm.cityStateZip", "Firm city/state/zip", "Firm", (d) =>
    cityStateZip(d.firm.city, d.firm.state, d.firm.zip),
  ),
  text("firm.phone", "Firm phone", "Firm", (d) => str(d.firm.phone)),
  text("firm.email", "Firm email", "Firm", (d) => str(d.firm.email)),

  // ── Today & user ──
  date("today", "Today's date", "Today & user", (d) => d.today, BOTH, false),
  field({
    path: "user.name",
    label: "Your name",
    group: "Today & user",
    type: "person",
    get: (d) => person(d.user.name),
  }),

  // ── Matter (matter scope only) ──
  text("matter.name", "Matter name", "Matter", (d) => str(m(d)?.name), MATTER),
  text("matter.caseNumber", "Case number", "Matter", (d) => str(m(d)?.caseNumber), MATTER),
  text("matter.court", "Court", "Matter", (d) => str(m(d)?.court), MATTER),
  text("matter.courtCaption", "Court caption", "Matter", (d) => str(m(d)?.courtCaption), MATTER),
  text("matter.venueName", "Venue name", "Matter", (d) => str(m(d)?.venueName), MATTER),
  text("matter.venueCity", "Venue city", "Matter", (d) => str(m(d)?.venueCity), MATTER),
  text("matter.venueCounty", "Venue county", "Matter", (d) => str(m(d)?.venueCounty), MATTER),
  text("matter.venueState", "Venue state", "Matter", (d) => str(m(d)?.venueState), MATTER),
  field({
    path: "matter.venueAddress",
    label: "Venue address",
    group: "Matter",
    type: "address",
    get: (d) => {
      const v = m(d);
      if (!v) return null;
      return address(
        addressLines({
          addressLine1: v.venueAddressLine1,
          addressLine2: v.venueAddressLine2,
          city: v.venueCity,
          state: v.venueState,
          zip: v.venueZip,
        }),
      );
    },
    scopes: MATTER,
  }),
  text(
    "matter.venueAddressLine1",
    "Venue address line 1",
    "Matter",
    (d) => str(m(d)?.venueAddressLine1),
    MATTER,
  ),
  text(
    "matter.venueAddressLine2",
    "Venue address line 2",
    "Matter",
    (d) => str(m(d)?.venueAddressLine2),
    MATTER,
  ),
  text(
    "matter.venueCityStateZip",
    "Venue city/state/zip",
    "Matter",
    (d) => {
      const v = m(d);
      return v ? cityStateZip(v.venueCity, v.venueState, v.venueZip) : null;
    },
    MATTER,
  ),
  text(
    "matter.practiceArea",
    "Practice area",
    "Matter",
    (d) => str(m(d)?.practiceArea),
    MATTER,
    "enum",
  ),
  text("matter.stage", "Stage", "Matter", (d) => str(m(d)?.stage), MATTER, "enum"),
  date("matter.incidentDate", "Incident date", "Matter", (d) => m(d)?.incidentDate ?? null, MATTER),
  date("matter.solDate", "SOL date", "Matter", (d) => m(d)?.solDate ?? null, MATTER),
  date("matter.filedDate", "Filed date", "Matter", (d) => m(d)?.filedDate ?? null, MATTER),
  date("matter.trialDate", "Trial date", "Matter", (d) => m(d)?.trialDate ?? null, MATTER),
  text("matter.opposingParty", "Opposing party", "Matter", (d) => str(m(d)?.opposingParty), MATTER),

  // ── Lead (lead scope only) ──
  text("lead.name", "Lead name", "Lead", (d) => str(l(d)?.name), LEAD),
  date("lead.incidentDate", "Lead incident date", "Lead", (d) => l(d)?.incidentDate ?? null, LEAD),
  text("lead.location", "Incident location", "Lead", (d) => str(l(d)?.location), LEAD),
  text("lead.source", "Lead source", "Lead", (d) => str(l(d)?.source), LEAD, "enum"),
  text("lead.summary", "Lead summary", "Lead", (d) => str(l(d)?.summary), LEAD),
  text("lead.stage", "Lead stage", "Lead", (d) => str(l(d)?.stage), LEAD, "enum"),

  // ── Client ──
  ...contactFields("client", "Client", "Client", (d) => d.client),

  // ── Signer ──
  field({
    path: "signer.name",
    label: "Signer name",
    group: "Signer",
    type: "person",
    get: (d) => person(d.signer?.name),
  }),
  text("signer.title", "Signer title", "Signer", (d) => str(d.signer?.title)),
  text("signer.barNumber", "Signer bar number", "Signer", (d) => str(d.signer?.barNumber)),
  text("signer.email", "Signer email", "Signer", (d) => str(d.signer?.email)),
  text("signer.phone", "Signer phone", "Signer", (d) => str(d.signer?.phone)),

  // ── Recipient ──
  ...contactFields("recipient", "Recipient", "Recipient", (d) => d.recipient),

  // ── Records request ──
  text("request.subject", "Request subject", "Records request", (d) => str(d.request?.subject)),
  text("request.description", "Request description", "Records request", (d) =>
    str(d.request?.description),
  ),
  text("request.type", "Request type", "Records request", (d) => str(d.request?.type)),
  date(
    "request.dateRangeStart",
    "Records from",
    "Records request",
    (d) => d.request?.dateRangeStart ?? null,
  ),
  date(
    "request.dateRangeEnd",
    "Records through",
    "Records request",
    (d) => d.request?.dateRangeEnd ?? null,
  ),
  date(
    "request.responseDueDate",
    "Response due date",
    "Records request",
    (d) => d.request?.responseDueDate ?? null,
  ),
  date("request.sentDate", "Date sent", "Records request", (d) => d.request?.sentDate ?? null),
  ...contactFields("custodian", "Records request", "Custodian", (d) => d.custodian),
];

// ── Lists ──────────────────────────────────────────────────────────────

const asParty = (i: ListItem | undefined): Partial<PartyItem> => (i ?? {}) as Partial<PartyItem>;
const itemOrg = (i: ListItem | undefined): boolean => asParty(i).isOrganization === true;

const ITEM_FIELDS: CatalogField[] = [
  field({
    path: "name",
    label: "Name",
    group: "Parties",
    type: "person",
    get: (_d, i) => person(i?.name, itemOrg(i)),
  }),
  field({
    path: "address",
    label: "Address",
    group: "Parties",
    type: "address",
    get: (_d, i) => address(asParty(i).addressLines),
  }),
  text("email", "Email", "Parties", (_d, i) => str(i?.email)),
  text("phone", "Phone", "Parties", (_d, i) => str(i?.phone)),
  text("role", "Role", "Parties", (_d, i) => str(i?.role)),
  field({
    path: "counsel.name",
    label: "Counsel name",
    group: "Parties",
    type: "person",
    get: (_d, i) => person(asParty(i).counsel?.name),
  }),
  field({
    path: "counsel.address",
    label: "Counsel address",
    group: "Parties",
    type: "address",
    get: (_d, i) => address(asParty(i).counsel?.addressLines),
  }),
  text("counsel.email", "Counsel email", "Parties", (_d, i) => str(asParty(i).counsel?.email)),
  text("counsel.phone", "Counsel phone", "Parties", (_d, i) => str(asParty(i).counsel?.phone)),
];

const partyList = (key: PartyListKey, label: string): CatalogList => ({
  path: `parties.${key}`,
  label,
  scopes: MATTER,
  itemFields: ITEM_FIELDS,
  get: (d) => d.parties[key],
});

export const LISTS: readonly CatalogList[] = [
  partyList("clients", "Clients"),
  partyList("opposing", "Opposing parties"),
  partyList("defendants", "Defendants"),
  partyList("plaintiffs", "Plaintiffs"),
  partyList("opposingCounsel", "Opposing counsel"),
  partyList("witnesses", "Witnesses"),
  partyList("experts", "Expert witnesses"),
  {
    path: "team",
    label: "Team members",
    scopes: BOTH,
    // Team members have no address or counsel.
    itemFields: ITEM_FIELDS.filter((f) => ["name", "email", "phone", "role"].includes(f.path)),
    get: (d) => d.team,
  },
];

// ── Lookups ────────────────────────────────────────────────────────────

const FIELD_BY_PATH = new Map(FIELDS.map((f) => [f.path, f]));
const LIST_BY_PATH = new Map(LISTS.map((x) => [x.path, x]));

export const fieldByPath = (path: string): CatalogField | undefined => FIELD_BY_PATH.get(path);
export const listByPath = (path: string): CatalogList | undefined => LIST_BY_PATH.get(path);

/** Fields usable in a template with this `appliesTo`. "both" keeps only
 *  fields valid in both scopes. */
export function fieldsForScope(appliesTo: AppliesTo): CatalogField[] {
  return FIELDS.filter((f) =>
    appliesTo === "both" ? f.scopes.length === 2 : f.scopes.includes(appliesTo),
  );
}

// ── Sample data ────────────────────────────────────────────────────────

const sampleCounsel: CounselData = {
  name: "Pat Counsel (sample)",
  email: "pat.counsel@example.com",
  phone: "(555) 555-0140",
  addressLines: ["900 Example Plaza", "Sampletown, CO 80000"],
};

const sampleParty = (name: string, role: string, extra: Partial<PartyItem> = {}): PartyItem => ({
  name,
  isOrganization: false,
  email: `${name.split(" ")[0].toLowerCase()}@example.com`,
  phone: "(555) 555-0150",
  addressLines: ["100 Placeholder Ave", "Sampletown, CO 80000"],
  role,
  counsel: sampleCounsel,
  ...extra,
});

const sampleContact = (name: string, extra: Partial<ContactData> = {}): ContactData => ({
  name,
  isOrganization: false,
  organization: "Sample Co. (sample)",
  email: "contact@example.com",
  phone: "(555) 555-0100",
  addressLines: ["123 Placeholder Ave", "Sampletown, CO 80000"],
  ...extra,
});

const defendants = [
  sampleParty("Example Insurance Co.", "Defendant", { isOrganization: true }),
  sampleParty("Dana Defendant", "Defendant"),
];
const plaintiffs = [
  sampleParty("Sam Sample", "Plaintiff"),
  sampleParty("Alex Sample", "Plaintiff"),
];

/** Obviously-fake data for the editor preview and catalog tests. Every
 *  field is populated; every list has at least two items. */
export const SAMPLE_TEMPLATE_DATA: TemplateData = {
  scope: "matter",
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
  // UTC noon keeps the day the same in any zone.
  today: new Date(Date.UTC(2026, 3, 15, 12)),
  timeZone: null,
  matter: {
    name: "Sample v. Example Insurance Co.",
    caseNumber: "2026-CV-00000",
    court: "Sample District Court · Hon. A. Example",
    venueName: "Sample County District Court",
    venueAddressLine1: "100 Sample Courthouse Plaza",
    venueAddressLine2: "Room 000",
    venueCity: "Sampletown",
    venueCounty: "Sample County",
    venueState: "CO",
    venueZip: "80000",
    courtCaption: "DISTRICT COURT, CITY AND COUNTY OF SAMPLE, STATE OF EXAMPLE",
    practiceArea: "Personal Injury (sample)",
    stage: "Discovery (sample)",
    incidentDate: new Date(Date.UTC(2025, 5, 1)),
    solDate: new Date(Date.UTC(2027, 5, 1)),
    filedDate: new Date(Date.UTC(2026, 0, 15)),
    trialDate: new Date(Date.UTC(2027, 2, 1)),
    opposingParty: "Example Insurance Co.",
  },
  lead: {
    name: "Sam Sample (sample lead)",
    incidentDate: new Date(Date.UTC(2025, 5, 1)),
    location: "Intersection of Example St and Sample Ave",
    source: "Referral (sample)",
    summary: "Sample intake summary.",
    stage: "Intake (sample)",
  },
  client: sampleContact("Sam Sample (sample client)", {
    email: "sam.sample@example.com",
    addressLines: ["123 Placeholder Ave", "Sampletown, CO 80000"],
  }),
  signer: {
    name: "Jordan Attorney (sample)",
    title: "Attorney",
    barNumber: "00000",
    email: "jordan@yourfirm.example",
    phone: "(555) 555-0198",
  },
  recipient: sampleContact("Riley Recipient (sample)"),
  parties: {
    clients: plaintiffs,
    opposing: defendants,
    defendants,
    plaintiffs,
    opposingCounsel: [
      sampleParty("Pat Counsel (sample)", "Opposing counsel", { counsel: sampleCounsel }),
      sampleParty("Casey Counsel (sample)", "Opposing counsel"),
    ],
    witnesses: [
      sampleParty("Wes Witness", "Lay witness"),
      sampleParty("Willa Witness", "Lay witness"),
    ],
    experts: [
      sampleParty("Dr. Eve Expert", "Expert witness"),
      sampleParty("Dr. Max Expert", "Expert witness"),
    ],
  },
  team: [
    {
      name: "Jordan Attorney (sample)",
      email: "jordan@yourfirm.example",
      phone: "(555) 555-0198",
      role: "Lead attorney",
    },
    {
      name: "Taylor Paralegal (sample)",
      email: "taylor@yourfirm.example",
      phone: "(555) 555-0197",
      role: "Paralegal",
    },
  ],
  request: {
    subject: "Sample records request",
    description: "All charts and billing records (sample).",
    type: "Medical records (sample)",
    dateRangeStart: new Date(Date.UTC(2024, 0, 1)),
    dateRangeEnd: new Date(Date.UTC(2025, 5, 1)),
    responseDueDate: new Date(Date.UTC(2026, 4, 1)),
    sentDate: new Date(Date.UTC(2026, 3, 1)),
  },
  custodian: sampleContact("Sample Hospital (sample custodian)", {
    isOrganization: true,
    organization: "Sample Health System",
    email: "records@sample-hospital.example",
    phone: "(555) 555-0123",
    addressLines: ["789 Example Blvd", "Sampletown, CO 80000"],
  }),
};
