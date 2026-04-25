/**
 * Practice area options for create/convert pickers.
 *
 * Returns active areas with their non-archived stages in canonical
 * order. Used by:
 *   - Lead conversion dialog (intake → matter)
 *   - (future) inline matter create from elsewhere
 */

import { prisma } from "@/lib/prisma";

export type PracticeAreaOption = {
  id: string;
  name: string;
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
  return areas.filter((a) => a.stages.length > 0);
}
