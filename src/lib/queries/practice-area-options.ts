/**
 * Practice area options for create/convert pickers.
 *
 * Returns active areas with their non-archived stages in canonical
 * order. Used by:
 *   - Lead conversion dialog (intake → matter)
 *   - (future) inline matter create from elsewhere
 */

import { prisma } from "@/lib/prisma";
import { normalizeAreaBillingTypes, type BillingType } from "@/lib/billing-type";

export type PracticeAreaOption = {
  id: string;
  name: string;
  /** Null/absent: the default "Fee agreement". */
  originatingDocLabel?: string | null;
  /** Billing types the area offers and the one preselected. */
  allowedBillingTypes: BillingType[];
  defaultBillingType: BillingType;
  stages: Array<{
    id: string;
    name: string;
    isTerminal: boolean;
    order: number;
  }>;
};

export async function getPracticeAreaOptions(): Promise<PracticeAreaOption[]> {
  const areas = await prisma.practiceArea.findMany({
    where: { isActive: true },
    orderBy: [{ order: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      originatingDocLabel: true,
      allowedBillingTypes: true,
      defaultBillingType: true,
      stages: {
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          isTerminal: true,
          order: true,
        },
        orderBy: { order: "asc" },
      },
    },
  });
  return areas
    .filter((a) => a.stages.length > 0)
    .map((a) => ({ ...a, ...normalizeAreaBillingTypes(a) }));
}
