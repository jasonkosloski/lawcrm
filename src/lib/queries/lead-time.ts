/**
 * Lead (intake) time queries — the data layer for /intake/[id]/time.
 *
 * Lead-scoped TimeEntry rows only (leadId set, matterId null per the
 * exactly-one-of scope invariant on TimeEntry). Deliberately thinner
 * than the matter Time tab's getMatterTimeEntries: intake entries
 * are created by the lead composer alone, so there are no
 * spawned-from chips, attached notes, or invoice links to resolve —
 * and no money columns to sum (intake work has no billing rate until
 * a matter exists; billable flags mark carry-forward intent).
 *
 * Volume stays small (a lead accrues dozens of entries at most
 * before it converts or is declined — conversion re-homes them onto
 * the matter), so totals are computed over the fetched rows rather
 * than a separate groupBy.
 */

import { prisma } from "@/lib/prisma";

export type LeadTimeEntryRow = {
  id: string;
  date: Date;
  hours: number;
  activity: string;
  narrative: string | null;
  utbmsCode: string | null;
  billable: boolean;
  noCharge: boolean;
  privileged: boolean;
  /** manual today; the type mirrors TimeEntry.source for future
   *  timer / capture flows on leads. */
  source: string;
  status: string;
  userName: string;
  userInitials: string;
};

export type LeadTimeSummary = {
  totalHours: number;
  /** billable && !noCharge — hours flagged to carry forward as
   *  billable work when the lead converts. */
  billableHours: number;
};

/** Shed float-accumulation noise from summed Float hours — same
 *  convention as src/lib/queries/time.ts. */
const round2 = (n: number): number => Math.round(n * 100) / 100;

export async function getLeadTimeEntries(
  leadId: string
): Promise<LeadTimeEntryRow[]> {
  const rows = await prisma.timeEntry.findMany({
    where: { leadId },
    include: { user: { select: { name: true, initials: true } } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  return rows.map((e) => ({
    id: e.id,
    date: e.date,
    hours: e.hours,
    activity: e.activity,
    narrative: e.narrative,
    utbmsCode: e.utbmsCode,
    billable: e.billable,
    noCharge: e.noCharge,
    privileged: e.privileged,
    source: e.source,
    status: e.status,
    userName: e.user.name,
    userInitials: e.user.initials,
  }));
}

/** Totals over a fetched row list — callers already hold the rows,
 *  so this stays a pure sum instead of a second query. */
export function summarizeLeadTime(
  rows: Pick<LeadTimeEntryRow, "hours" | "billable" | "noCharge">[]
): LeadTimeSummary {
  return {
    totalHours: round2(rows.reduce((sum, r) => sum + r.hours, 0)),
    billableHours: round2(
      rows
        .filter((r) => r.billable && !r.noCharge)
        .reduce((sum, r) => sum + r.hours, 0)
    ),
  };
}
