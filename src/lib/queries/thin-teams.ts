/**
 * "Thin teams" - open matters whose active roster would leave almost
 * nobody able to see them once the firm flips matter visibility to
 * "Team only": matters with NO active team member, and matters whose
 * only active member is the lead. The admin works down this list
 * (Settings -> Firm) before turning the wall on.
 *
 * Admin-facing and deliberately NOT access-filtered: the caller gates
 * it on the Admin role, and it must list exactly the matters the
 * admin cannot yet reason about. Archived matters are excluded.
 */

import { prisma } from "@/lib/prisma";

export type ThinTeamReason = "no_members" | "lead_only";

export type ThinTeamRow = {
  id: string;
  name: string;
  caseNumber: string | null;
  reason: ThinTeamReason;
  /** Active lead's name, when there is one. */
  leadName: string | null;
};

export type ThinTeams = {
  total: number;
  rows: ThinTeamRow[];
};

/** Cap on rows rendered; `total` still reports the full count. */
export const THIN_TEAMS_LIMIT = 100;

/** Pure classifier over a matter's ACTIVE roles (testable). */
export function classifyTeam(activeRoles: readonly string[]): ThinTeamReason | null {
  if (activeRoles.length === 0) return "no_members";
  if (activeRoles.length === 1 && activeRoles[0] === "lead") return "lead_only";
  return null;
}

export async function listThinTeams(): Promise<ThinTeams> {
  const matters = await prisma.matter.findMany({
    where: { isArchived: false },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      caseNumber: true,
      teamMembers: {
        where: { removedAt: null },
        select: { role: true, user: { select: { name: true } } },
      },
    },
  });
  const rows: ThinTeamRow[] = [];
  for (const m of matters) {
    const reason = classifyTeam(m.teamMembers.map((t) => t.role));
    if (!reason) continue;
    rows.push({
      id: m.id,
      name: m.name,
      caseNumber: m.caseNumber,
      reason,
      leadName: m.teamMembers.find((t) => t.role === "lead")?.user.name ?? null,
    });
  }
  return { total: rows.length, rows: rows.slice(0, THIN_TEAMS_LIMIT) };
}
