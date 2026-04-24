/**
 * Matters Filters & Sort
 *
 * Shared between the server page (reads `searchParams`, runs the query)
 * and the client toolbar (reads/writes URL via router). URL query params
 * are the source of truth — that makes every view sharable, keeps the
 * back button honest, and removes the need for in-memory sync.
 *
 * URL format:
 *   ?q=alvarez                 — text search (name/case number)
 *   ?area=§1983&area=Housing/FHA — repeated for multi-select
 *   ?stage=Discovery&stage=Dispositive
 *   ?lead=<userId>&lead=<userId>
 *   ?fee=contingent&fee=hourly
 *   ?trust=has|none|over-10k   — single value
 *   ?deadline=within-7d|within-30d|overdue|none
 *   ?archived=1                — include archived matters
 *   ?pinned=1                  — pinned only
 *   ?hide_closed=1             — exclude Closed + Settled
 *   ?sort=name|area|lead|stage|trust|fee|deadline|created
 *   ?dir=asc|desc
 */

export type TrustFilter = "any" | "has" | "none" | "over-10k";
export type DeadlineFilter =
  | "any"
  | "within-7d"
  | "within-30d"
  | "overdue"
  | "none";

export type MattersFilter = {
  q: string;
  areas: string[];
  stages: string[];
  leadIds: string[];
  feeStructures: string[];
  trust: TrustFilter;
  deadline: DeadlineFilter;
  includeArchived: boolean;
  pinnedOnly: boolean;
  hideClosed: boolean;
};

export type SortField =
  | "name"
  | "area"
  | "lead"
  | "stage"
  | "trust"
  | "fee"
  | "deadline"
  | "created";

export type SortDir = "asc" | "desc";

export type MattersSort = { field: SortField; dir: SortDir };

/** Canonical practice-case-stage order (case lifecycle). Used to sort by stage. */
export const STAGE_ORDER = [
  "Intake",
  "Pre-suit",
  "Retained",
  "Discovery",
  "Dispositive",
  "Pretrial",
  "Cert",
  "Trial/Settle",
  "Settled",
  "Closed",
] as const;

/** Human-friendly labels for fee structure values. */
export const FEE_LABELS: Record<string, string> = {
  contingent: "Contingent",
  hourly: "Hourly",
  flat: "Flat fee",
  hybrid: "Hybrid",
  pro_bono: "Pro bono",
};

/** Default sort — applied when the user hasn't clicked a sortable header.
 *  Server also applies pinned-first as a tiebreaker on top of this. */
export const DEFAULT_SORT: MattersSort = { field: "created", dir: "desc" };

/** Normalizes a searchParams-ish shape to a single value or array. */
const getOne = (
  sp: Record<string, string | string[] | undefined>,
  key: string
): string | undefined => {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v;
};

const getAll = (
  sp: Record<string, string | string[] | undefined>,
  key: string
): string[] => {
  const v = sp[key];
  if (Array.isArray(v)) return v.filter(Boolean);
  if (typeof v === "string" && v.length > 0) return [v];
  return [];
};

export const EMPTY_FILTER: MattersFilter = {
  q: "",
  areas: [],
  stages: [],
  leadIds: [],
  feeStructures: [],
  trust: "any",
  deadline: "any",
  includeArchived: false,
  pinnedOnly: false,
  hideClosed: false,
};

const isTrust = (v: string | undefined): v is TrustFilter =>
  v === "any" || v === "has" || v === "none" || v === "over-10k";
const isDeadline = (v: string | undefined): v is DeadlineFilter =>
  v === "any" ||
  v === "within-7d" ||
  v === "within-30d" ||
  v === "overdue" ||
  v === "none";
const isSortField = (v: string | undefined): v is SortField =>
  v === "name" ||
  v === "area" ||
  v === "lead" ||
  v === "stage" ||
  v === "trust" ||
  v === "fee" ||
  v === "deadline" ||
  v === "created";

export function parseMattersParams(
  sp: Record<string, string | string[] | undefined>
): { filter: MattersFilter; sort: MattersSort } {
  const trust = getOne(sp, "trust");
  const deadline = getOne(sp, "deadline");
  const sortField = getOne(sp, "sort");
  const sortDir = getOne(sp, "dir");

  return {
    filter: {
      q: getOne(sp, "q") ?? "",
      areas: getAll(sp, "area"),
      stages: getAll(sp, "stage"),
      leadIds: getAll(sp, "lead"),
      feeStructures: getAll(sp, "fee"),
      trust: isTrust(trust) ? trust : "any",
      deadline: isDeadline(deadline) ? deadline : "any",
      includeArchived: getOne(sp, "archived") === "1",
      pinnedOnly: getOne(sp, "pinned") === "1",
      hideClosed: getOne(sp, "hide_closed") === "1",
    },
    sort: {
      field: isSortField(sortField) ? sortField : DEFAULT_SORT.field,
      dir: sortDir === "asc" ? "asc" : sortDir === "desc" ? "desc" : DEFAULT_SORT.dir,
    },
  };
}

/** True if any filter is active (used to show the "clear" link). */
export function isFilterActive(f: MattersFilter): boolean {
  return (
    f.q.length > 0 ||
    f.areas.length > 0 ||
    f.stages.length > 0 ||
    f.leadIds.length > 0 ||
    f.feeStructures.length > 0 ||
    f.trust !== "any" ||
    f.deadline !== "any" ||
    f.includeArchived ||
    f.pinnedOnly ||
    f.hideClosed
  );
}

/** Builds a new URLSearchParams from current state, omitting defaults. */
export function buildMattersSearchParams(
  filter: MattersFilter,
  sort: MattersSort
): URLSearchParams {
  const p = new URLSearchParams();
  if (filter.q) p.set("q", filter.q);
  for (const a of filter.areas) p.append("area", a);
  for (const s of filter.stages) p.append("stage", s);
  for (const l of filter.leadIds) p.append("lead", l);
  for (const f of filter.feeStructures) p.append("fee", f);
  if (filter.trust !== "any") p.set("trust", filter.trust);
  if (filter.deadline !== "any") p.set("deadline", filter.deadline);
  if (filter.includeArchived) p.set("archived", "1");
  if (filter.pinnedOnly) p.set("pinned", "1");
  if (filter.hideClosed) p.set("hide_closed", "1");
  if (
    sort.field !== DEFAULT_SORT.field ||
    sort.dir !== DEFAULT_SORT.dir
  ) {
    p.set("sort", sort.field);
    p.set("dir", sort.dir);
  }
  return p;
}
