/**
 * Attorney helpers: who counts as an attorney (an active user with at
 * least one bar admission) and which bar number applies to a state.
 */

import type { Prisma } from "@/generated/prisma/client";
import { prisma, type Tx } from "@/lib/prisma";
import { stateCode } from "@/lib/us-states";

/** Roles a person can hold on a matter team as an attorney. */
export const ATTORNEY_ROLES = ["lead", "co_counsel", "of_counsel"] as const;

/** Where clause matching attorneys: active users with a bar admission. */
export const attorneyUserWhere: Prisma.UserWhereInput = {
  isActive: true,
  barAdmissions: { some: {} },
};

/** True when the user is an active attorney (has at least one admission). */
export async function isAttorney(
  userId: string,
  db: Tx | typeof prisma = prisma,
): Promise<boolean> {
  const count = await db.user.count({ where: { ...attorneyUserWhere, id: userId } });
  return count > 0;
}

/** The convert dialog's preselected lead: the converter if an attorney,
 *  else the intake team's only attorney, else nobody (they pick). */
export function defaultLeadAttorneyId(
  currentUserId: string,
  intakeUserIds: string[],
  attorneyIds: string[],
): string | null {
  if (attorneyIds.includes(currentUserId)) return currentUserId;
  const onTeam = attorneyIds.filter((id) => intakeUserIds.includes(id));
  return onTeam.length === 1 ? onTeam[0] : null;
}

/** The bar number admitted in the state named or coded by `stateText`;
 *  null when the text matches no state or the user has no admission there. */
export function barNumberFor(
  admissions: { state: string; number: string }[],
  stateText: string | null,
): string | null {
  const code = stateCode(stateText);
  if (!code) return null;
  return admissions.find((a) => a.state === code)?.number ?? null;
}

export { LEAD_NOT_ATTORNEY, NO_ATTORNEYS } from "@/lib/attorney-messages";
