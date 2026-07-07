/**
 * Leads / Intake Queries
 *
 * Server-only data access for the intake queue and lead detail pages.
 * Keeps the row shape pre-computed (days-since-created, days-until-
 * statute) so the view layer stays pure rendering.
 */

import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { LEAD_CLOSED_STAGES } from "@/lib/constants/lead-stage";

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
  statuteWindow: number | null;
  conflictCheck: string;
  /** Days since the lead came in. */
  ageDays: number;
  isActive: boolean;
};

const daysBetween = (a: Date, b: Date): number =>
  Math.floor((a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000));

/// Hard cap on listLeads — same rationale as LIST_MATTERS_CAP in
/// matters.ts. Most firms have far fewer active leads than this,
/// and converted/declined leads still count toward the cap so this
/// is the "all intake history" bound. Build paging when needed.
const LIST_LEADS_CAP = 200;

export async function listLeads(): Promise<LeadListRow[]> {
  const leads = await prisma.lead.findMany({
    take: LIST_LEADS_CAP,
    orderBy: [{ createdAt: "desc" }],
    include: {
      // Joined Contact wins for display fields when present — keeps
      // intake and the contact directory consistent if the user edits
      // the Contact (e.g. updates the phone number). Falls back to
      // the legacy Lead.email/.phone columns for un-backfilled rows.
      contact: { select: { id: true, name: true, email: true, phone: true } },
    },
  });
  const now = new Date();
  return leads.map((l) => ({
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
    conflictCheck: l.conflictCheck,
    ageDays: Math.max(0, daysBetween(now, l.createdAt)),
    isActive: !(LEAD_CLOSED_STAGES as readonly string[]).includes(l.stage),
  }));
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

  // Resolve display fields once — joined Contact wins, legacy text
  // mirrors are the fallback for un-backfilled rows. Pages should
  // read displayName / displayEmail / displayPhone instead of the raw
  // lead.* columns.
  return {
    ...lead,
    convertedMatter,
    displayName: lead.contact?.name ?? lead.name,
    displayEmail: lead.contact?.email ?? lead.email,
    displayPhone: lead.contact?.phone ?? lead.phone,
  };
});

/** Aggregate counts for the intake-page header: total active, new today,
 *  conflict warnings. Cheap — small dataset. */
export async function getLeadSummary() {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const [activeCount, newTodayCount, conflictCount, convertedCount] =
    await Promise.all([
      prisma.lead.count({
        where: { stage: { notIn: [...LEAD_CLOSED_STAGES] } },
      }),
      prisma.lead.count({ where: { createdAt: { gte: startOfToday } } }),
      prisma.lead.count({
        where: { conflictCheck: { in: ["warn", "conflict"] } },
      }),
      prisma.lead.count({ where: { stage: "converted" } }),
    ]);

  return { activeCount, newTodayCount, conflictCount, convertedCount };
}
