import { type Tx } from "@/lib/prisma";
import { nextAvailableFolderName } from "@/lib/folder-tree";

/**
 * Re-home an intake lead's folders and documents onto the matter it
 * converted into (matterId set, leadId cleared in one write, so the
 * exactly-one-of scope invariant holds). Only ROOT lead folders can
 * collide with the matter's existing root folders; a collision gets a
 * "(n)" suffix. Nested folders keep their parent. Returns the number
 * of top-level documents moved (extracted email attachments move too
 * but are not counted).
 */
export async function rehomeLeadDocuments(
  tx: Tx,
  leadId: string,
  matterId: string
): Promise<number> {
  const [matterRoots, leadRoots] = await Promise.all([
    tx.documentFolder.findMany({
      where: { matterId, parentId: null },
      select: { name: true },
    }),
    tx.documentFolder.findMany({
      where: { leadId, parentId: null },
      select: { id: true, name: true },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    }),
  ]);
  const taken = new Set(matterRoots.map((f) => f.name.toLowerCase()));
  for (const folder of leadRoots) {
    const name = nextAvailableFolderName(folder.name, taken);
    taken.add(name.toLowerCase());
    if (name !== folder.name) {
      await tx.documentFolder.update({ where: { id: folder.id }, data: { name } });
    }
  }
  await tx.documentFolder.updateMany({
    where: { leadId },
    data: { matterId, leadId: null },
  });
  // Count top-level documents only: an email's extracted attachments
  // (parentDocumentId set) move too, but "N documents carried forward"
  // should match what the user uploaded.
  const topLevel = await tx.document.count({
    where: { leadId, parentDocumentId: null },
  });
  await tx.document.updateMany({
    where: { leadId },
    data: { matterId, leadId: null },
  });
  return topLevel;
}
