import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { getCurrentUserPermissions } from "@/lib/permission-check";
import {
  MATTER_DRAFT_RETENTION_DAYS,
  DRAFT_PERMISSION,
  draftAccessWhere,
} from "@/lib/draft-access";
import { DAY_MS } from "@/lib/format-date";

export type MatterDraftListItem = {
  id: string;
  clientLabel: string;
  practiceAreaName: string | null;
  updatedAt: Date;
  createdByName: string;
  canDelete: boolean;
  /** Days until the cleanup sweep; only set when 14 or fewer. */
  deletesInDays: number | null;
};


function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** The current user's drafts, newest first. */
export async function listMatterDrafts(): Promise<MatterDraftListItem[]> {
  const userId = await getCurrentUserId();
  const { isAdmin, granted } = await getCurrentUserPermissions();
  // Being named on a draft grants nothing by itself (draft-access.ts).
  if (!isAdmin && !granted.has(DRAFT_PERMISSION)) return [];
  const drafts = await prisma.matterDraft.findMany({
    where: draftAccessWhere(userId, isAdmin),
    orderBy: { updatedAt: "desc" },
    select: { id: true, createdById: true, values: true, updatedAt: true },
  });
  if (drafts.length === 0) return [];

  const vals = drafts.map((d) => (d.values ?? {}) as Record<string, unknown>);
  const contactIds = [
    ...new Set(vals.map((v) => str(v.clientId)).filter((id) => id && id !== "new")),
  ];
  const areaIds = [...new Set(vals.map((v) => str(v.practiceAreaId)).filter(Boolean))];
  const creatorIds = [...new Set(drafts.map((d) => d.createdById))];
  const [contacts, areas, creators] = await Promise.all([
    prisma.contact.findMany({
      where: { id: { in: contactIds } },
      select: { id: true, name: true },
    }),
    prisma.practiceArea.findMany({
      where: { id: { in: areaIds } },
      select: { id: true, name: true },
    }),
    prisma.user.findMany({
      where: { id: { in: creatorIds } },
      select: { id: true, name: true },
    }),
  ]);
  const contactName = new Map(contacts.map((c) => [c.id, c.name]));
  const areaName = new Map(areas.map((a) => [a.id, a.name]));
  const userName = new Map(creators.map((u) => [u.id, u.name]));

  const now = Date.now();
  return drafts.map((d, i) => {
    const v = vals[i];
    const daysLeft = Math.ceil(
      (d.updatedAt.getTime() + MATTER_DRAFT_RETENTION_DAYS * DAY_MS - now) / DAY_MS
    );
    return {
      id: d.id,
      clientLabel:
        str(v.newClientName) || contactName.get(str(v.clientId)) || "Untitled draft",
      practiceAreaName: areaName.get(str(v.practiceAreaId)) ?? null,
      updatedAt: d.updatedAt,
      createdByName: userName.get(d.createdById) ?? "Unknown",
      canDelete: isAdmin || d.createdById === userId,
      deletesInDays: daysLeft <= 14 ? Math.max(daysLeft, 0) : null,
    };
  });
}
