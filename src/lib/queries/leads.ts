/**
 * Leads / Intake Queries
 *
 * Server-only data access for the intake queue and lead detail pages.
 * Keeps the row shape pre-computed (days-since-created, days-until-
 * statute) so the view layer stays pure rendering.
 */

import { cache } from "react";
import { paginate, type Page } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { leadAccessWhere } from "@/lib/lead-access";
import { LEAD_CLOSED_STAGES } from "@/lib/constants/lead-stage";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { dateKeyInTz, daysBetweenKeys, instantInTz, todayKey } from "@/lib/format-date";

// Stage value set + labels moved to their canonical client-safe home
// in `src/lib/constants/lead-stage.ts` (this server-only file can't
// be imported by client components). Re-exported for long-standing
// importers; new code should import from the constants file.
export {
  type LeadStage,
  LEAD_STAGE_ORDER,
  LEAD_STAGE_LABEL,
  LEAD_SOURCE_LABEL,
} from "@/lib/constants/lead-stage";

export type LeadListRow = {
  id: string;
  /** Linked Contact id when the lead has been backfilled / created
   *  through the new flow. Null only for un-backfilled legacy rows.
   *  When set, the intake list links the name through to the
   *  contact directory. */
  contactId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  source: string | null;
  sourceDetail: string | null;
  summary: string | null;
  stage: string;
  score: number | null;
  liabilityAssessment: string | null;
  damagesAssessment: string | null;
  /** The stored snapshot (`Lead.statuteWindow`): days of statute left
   *  AS OF the day the lead was created. It does not count down, so it
   *  is never displayed directly — use `statuteDaysRemaining`. */
  statuteWindow: number | null;
  /** Days of statute left TODAY (viewer's calendar): the snapshot minus
   *  the days elapsed since the lead came in. Negative = the window has
   *  run. Null when the lead has no statute window. */
  statuteDaysRemaining: number | null;
  conflictCheck: string;
  /** Restricted intake (ADR-049) — shown as a lock badge. */
  restricted: boolean;
  /** Calendar days since the lead came in (viewer's zone). */
  ageDays: number;
  isActive: boolean;
};

/** Whole calendar days (in `tz`) from the day the lead was created to
 *  today. Never negative. */
export function leadAgeDays(createdAt: Date, tz: string, now: Date): number {
  return Math.max(0, daysBetweenKeys(dateKeyInTz(createdAt, tz), todayKey(tz, now)));
}

/** `Lead.statuteWindow` is a one-time snapshot ("days remaining" when
 *  the lead was entered), so the live figure is the snapshot minus the
 *  days elapsed since. Without this the queue would read the same
 *  "340d" ten months later and the <= 30 day warning could never fire.
 *  Negative = the window has run. */
export function statuteDaysRemaining(
  statuteWindow: number | null,
  createdAt: Date,
  tz: string,
  now: Date,
): number | null {
  if (statuteWindow === null) return null;
  return statuteWindow - leadAgeDays(createdAt, tz, now);
}

/// Safety bound on ACTIVE leads in the queue. Open leads carry
/// statute-of-limitations exposure, so they are never paged behind the
/// closed history — this only guards against a runaway table, and the
/// page says so (`activeTruncated`) if it is ever hit.
export const ACTIVE_LEADS_SAFETY_CAP = 1000;
/// Page size for the CLOSED (converted / declined) history listed after
/// the active leads; `?page=N` pages through it (src/lib/pagination.ts).
export const CLOSED_LEADS_PAGE_SIZE = 200;

export type LeadList = {
  /** Every active lead (up to the safety cap), then one page of closed
   *  history, newest first within each group. */
  rows: LeadListRow[];
  /** More active leads exist than ACTIVE_LEADS_SAFETY_CAP. */
  activeTruncated: boolean;
  /** Paging metadata for the closed-history half. */
  closed: Omit<Page<LeadListRow>, "rows">;
};

export async function listLeads(
  now: Date = new Date(),
  /** 1-based `?page=` of the closed history; clamped into range. */
  closedPage = 1,
): Promise<LeadList> {
  const include = {
    // Joined Contact wins for display fields when present — keeps
    // intake and the contact directory consistent if the user edits
    // the Contact (e.g. updates the phone number). Falls back to
    // the legacy Lead.email/.phone columns for un-backfilled rows.
    contact: { select: { id: true, name: true, email: true, phone: true } },
  } as const;
  const closedStages = [...LEAD_CLOSED_STAGES];
  // Two queries so closed history can never push an older, still-open
  // lead out of the cap (the old single newest-200 query did, while the
  // header's uncapped activeCount still counted it).
  // Restricted intake (ADR-049): hidden leads are neither listed nor
  // counted. The fragment is a single NOT key, safe to spread.
  const access = await leadAccessWhere(await getCurrentUserId());
  const closedWhere = { ...access, stage: { in: closedStages } };
  const [tz, active, closed] = await Promise.all([
    getCurrentUserTimeZone(),
    prisma.lead.findMany({
      where: { ...access, stage: { notIn: closedStages } },
      // One past the bound detects that it was hit.
      take: ACTIVE_LEADS_SAFETY_CAP + 1,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include,
    }),
    paginate(
      closedPage,
      CLOSED_LEADS_PAGE_SIZE,
      () => prisma.lead.count({ where: closedWhere }),
      ({ skip, take }) =>
        prisma.lead.findMany({
          where: closedWhere,
          skip,
          take,
          // `id` tiebreak keeps the order stable across pages.
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          include,
        }),
    ),
  ]);
  const activeTruncated = active.length > ACTIVE_LEADS_SAFETY_CAP;
  if (activeTruncated) active.length = ACTIVE_LEADS_SAFETY_CAP;
  const { rows: closedRows, ...closedMeta } = closed;
  const rows = [...active, ...closedRows].map((l) => ({
    id: l.id,
    contactId: l.contact?.id ?? l.contactId,
    name: l.contact?.name ?? l.name,
    email: l.contact?.email ?? l.email,
    phone: l.contact?.phone ?? l.phone,
    source: l.source,
    sourceDetail: l.sourceDetail,
    summary: l.summary,
    stage: l.stage,
    score: l.score,
    liabilityAssessment: l.liabilityAssessment,
    damagesAssessment: l.damagesAssessment,
    statuteWindow: l.statuteWindow,
    statuteDaysRemaining: statuteDaysRemaining(l.statuteWindow, l.createdAt, tz, now),
    conflictCheck: l.conflictCheck,
    restricted: l.restricted,
    ageDays: leadAgeDays(l.createdAt, tz, now),
    isActive: !(LEAD_CLOSED_STAGES as readonly string[]).includes(l.stage),
  }));
  return { rows, activeTruncated, closed: closedMeta };
}

/**
 * Intake queue order: active leads first, then closed history (input
 * order kept — listLeads returns newest first). Among active leads,
 * UNSCORED ones lead (newest first): nothing computes scores yet, so a
 * fresh intake — the thing most in need of triage — would otherwise
 * sink below every scored lead. Then scored leads, highest first.
 */
export function sortIntakeQueue<T extends { isActive: boolean; score: number | null }>(
  leads: readonly T[],
): T[] {
  return [...leads].sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    if (!a.isActive) return 0;
    if (a.score === null || b.score === null) {
      if (a.score === b.score) return 0;
      return a.score === null ? -1 : 1;
    }
    return b.score - a.score;
  });
}

export type LeadDetail = Awaited<ReturnType<typeof getLeadById>>;

// Wrapped in React `cache()` so the lead [id] layout and the active tab
// page share one DB round-trip per request instead of each running the
// query (plus its converted-matter follow-up lookup).
export const getLeadById = cache(async (id: string) => {
  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      // Joined Contact — the lead's first-class contact record. UI
      // prefers contact.name/email/phone over the legacy Lead.* mirrors
      // so a phone-number edit on /contacts/[id] flows through here.
      contact: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          organization: true,
          phones: {
            orderBy: [{ isPrimary: "desc" }, { order: "asc" }],
            select: {
              id: true,
              label: true,
              number: true,
              isPrimary: true,
            },
          },
        },
      },
      // Restricted-intake team (ADR-049); listed on the Access card.
      teamMembers: {
        orderBy: { createdAt: "asc" },
        select: {
          userId: true,
          role: true,
          user: { select: { name: true, initials: true, jobTitle: true } },
        },
      },
    },
  });
  if (!lead) return null;

  // If the lead was converted, fetch the matter it became so the UI can
  // link directly to it. Not a Prisma relation today — join here.
  const row = lead.convertedMatterId
    ? await prisma.matter.findUnique({
        where: { id: lead.convertedMatterId },
        select: {
          id: true,
          name: true,
          color: true,
          practiceArea: { select: { name: true } },
          stage: { select: { name: true } },
        },
      })
    : null;

  const convertedMatter = row
    ? {
        id: row.id,
        name: row.name,
        color: row.color,
        area: row.practiceArea.name,
        stage: row.stage.name,
      }
    : null;

  const tz = await getCurrentUserTimeZone();

  // Resolve display fields once — joined Contact wins, legacy text
  // mirrors are the fallback for un-backfilled rows. Pages should
  // read displayName / displayEmail / displayPhone instead of the raw
  // lead.* columns.
  return {
    ...lead,
    convertedMatter,
    /** Live days of statute left (see `statuteDaysRemaining`). */
    statuteDaysRemaining: statuteDaysRemaining(lead.statuteWindow, lead.createdAt, tz, new Date()),
    displayName: lead.contact?.name ?? lead.name,
    displayEmail: lead.contact?.email ?? lead.email,
    displayPhone: lead.contact?.phone ?? lead.phone,
  };
});

/** Aggregate counts for the intake-page header: total active, new today,
 *  conflict warnings on OPEN leads. Cheap — small dataset. "Today" is the
 *  viewer's calendar day (createdAt is an instant — ADR-012). */
export async function getLeadSummary(now: Date = new Date()) {
  const tz = await getCurrentUserTimeZone();
  const [y, m, d] = todayKey(tz, now).split("-").map(Number);
  const startOfToday = instantInTz(y, m, d, 0, 0, tz);
  const openStage = { notIn: [...LEAD_CLOSED_STAGES] };
  // Same visibility as the queue it heads (ADR-049).
  const access = await leadAccessWhere(await getCurrentUserId());

  const [activeCount, newTodayCount, conflictCount, convertedCount] = await Promise.all([
    prisma.lead.count({ where: { ...access, stage: openStage } }),
    prisma.lead.count({
      where: { ...access, createdAt: { gte: startOfToday } },
    }),
    // Open leads only: a flagged lead that was later converted or
    // declined must not inflate the "N conflict" header forever.
    prisma.lead.count({
      where: {
        ...access,
        stage: openStage,
        conflictCheck: { in: ["warn", "conflict"] },
      },
    }),
    prisma.lead.count({ where: { ...access, stage: "converted" } }),
  ]);

  return { activeCount, newTodayCount, conflictCount, convertedCount };
}
