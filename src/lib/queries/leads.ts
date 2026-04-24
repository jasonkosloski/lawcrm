/**
 * Leads / Intake Queries
 *
 * Server-only data access for the intake queue and lead detail pages.
 * Keeps the row shape pre-computed (days-since-created, days-until-
 * statute) so the view layer stays pure rendering.
 */

import { prisma } from "@/lib/prisma";

export type LeadStage =
  | "new"
  | "contacted"
  | "qualifying"
  | "meeting"
  | "converted"
  | "declined"
  | "hold";

/** Ordering for stages — new leads surface first, converted/declined
 *  drop to the bottom (they're done). */
export const LEAD_STAGE_ORDER: LeadStage[] = [
  "new",
  "contacted",
  "qualifying",
  "meeting",
  "hold",
  "converted",
  "declined",
];

export const LEAD_STAGE_LABEL: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  qualifying: "Qualifying",
  meeting: "Meeting",
  hold: "On hold",
  converted: "Converted",
  declined: "Declined",
};

export const LEAD_SOURCE_LABEL: Record<string, string> = {
  web: "Web form",
  referral: "Referral",
  phone: "Phone",
  walk_in: "Walk-in",
  court_appointment: "Court appt.",
};

export type LeadListRow = {
  id: string;
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

export async function listLeads(): Promise<LeadListRow[]> {
  const leads = await prisma.lead.findMany({
    orderBy: [{ createdAt: "desc" }],
  });
  const now = new Date();
  return leads.map((l) => ({
    id: l.id,
    name: l.name,
    email: l.email,
    phone: l.phone,
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
    isActive: !["converted", "declined"].includes(l.stage),
  }));
}

export type LeadDetail = Awaited<ReturnType<typeof getLeadById>>;

export async function getLeadById(id: string) {
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) return null;

  // If the lead was converted, fetch the matter it became so the UI can
  // link directly to it. Not a Prisma relation today — join here.
  const convertedMatter = lead.convertedMatterId
    ? await prisma.matter.findUnique({
        where: { id: lead.convertedMatterId },
        select: { id: true, name: true, area: true, stage: true, color: true },
      })
    : null;

  return { ...lead, convertedMatter };
}

/** Aggregate counts for the intake-page header: total active, new today,
 *  conflict warnings. Cheap — small dataset. */
export async function getLeadSummary() {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const [activeCount, newTodayCount, conflictCount, convertedCount] =
    await Promise.all([
      prisma.lead.count({
        where: { stage: { notIn: ["converted", "declined"] } },
      }),
      prisma.lead.count({ where: { createdAt: { gte: startOfToday } } }),
      prisma.lead.count({
        where: { conflictCheck: { in: ["warn", "conflict"] } },
      }),
      prisma.lead.count({ where: { stage: "converted" } }),
    ]);

  return { activeCount, newTodayCount, conflictCount, convertedCount };
}
