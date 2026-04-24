/**
 * Matters Queries
 *
 * Server-only data access for the matters list and matter detail pages.
 * Detail lookups use the matter's `id` (cuid) — matter names are not
 * guaranteed unique (two Alvarez cases can coexist), so the opaque cuid
 * is the durable identifier.
 */

import { prisma } from "@/lib/prisma";

export type MatterListRow = {
  id: string;
  name: string;
  caseNumber: string | null;
  area: string;
  stage: string;
  feeStructure: string;
  trustBalance: number;
  color: string;
  leadInitials: string | null;
  nextDeadlineDays: number | null;
  isPinned: boolean;
  isArchived: boolean;
};

/**
 * All matters, ordered by most recently updated. Includes the lead attorney's
 * initials (if assigned) and days-until-next-open-deadline for the table.
 */
export async function listMatters(): Promise<MatterListRow[]> {
  const matters = await prisma.matter.findMany({
    orderBy: [{ isPinned: "desc" }, { updatedAt: "desc" }],
    include: {
      teamMembers: {
        where: { role: "lead" },
        take: 1,
        include: { user: { select: { initials: true } } },
      },
      deadlines: {
        where: { status: "open" },
        orderBy: { dueDate: "asc" },
        take: 1,
        select: { dueDate: true },
      },
    },
  });

  const now = Date.now();
  return matters.map((m) => ({
    id: m.id,
    name: m.name,
    caseNumber: m.caseNumber,
    area: m.area,
    stage: m.stage,
    feeStructure: m.feeStructure,
    trustBalance: m.trustBalance,
    color: m.color,
    leadInitials: m.teamMembers[0]?.user.initials ?? null,
    nextDeadlineDays: m.deadlines[0]
      ? Math.max(
          0,
          Math.ceil((m.deadlines[0].dueDate.getTime() - now) / (24 * 60 * 60 * 1000))
        )
      : null,
    isPinned: m.isPinned,
    isArchived: m.isArchived,
  }));
}

/**
 * Single matter with the relations needed for the detail header.
 * Returns `null` if the id doesn't exist — callers should `notFound()`.
 */
export async function getMatterById(id: string) {
  return prisma.matter.findUnique({
    where: { id },
    include: {
      client: true,
      teamMembers: {
        include: {
          user: {
            select: { id: true, name: true, initials: true, role: true },
          },
        },
        orderBy: { role: "asc" },
      },
    },
  });
}

export type MatterDetail = NonNullable<Awaited<ReturnType<typeof getMatterById>>>;
