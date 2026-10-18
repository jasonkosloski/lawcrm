import { type Tx } from "@/lib/prisma";
import { nextAvailableFolderName } from "@/lib/folder-tree";
import { scopeWhere, type RecordScope } from "@/lib/record-scope";

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

export type LeadUploadTarget =
  | {
      kind: "filed";
      /** Lead scope, or the matter the lead converted into. */
      scope: RecordScope;
      /** The requested folder if it resolves under `scope`, else null
       *  (the scope's root). */
      folderId: string | null;
    }
  /** The lead no longer exists (or converted with no matter recorded):
   *  nothing to attach the upload to. */
  | { kind: "gone" }
  /** The lead converted, but the uploader can't see the new matter.
   *  Fail closed: the caller must not file it (that would leak the
   *  file onto a matter they can't open) nor silently keep it. */
  | { kind: "forbidden"; matterId: string };

/**
 * Decide where an upload aimed at an intake lead lands. MUST run
 * inside the same interactive transaction as the document create:
 * the `FOR SHARE` lock waits behind convertLeadToMatter's in-flight
 * claim of the lead row and blocks a conversion that starts after
 * it until the create commits, so the row is never filed on a lead
 * whose records already moved. A lead converted mid-upload reroutes
 * to its matter (folders keep their ids when re-homed, so the folder
 * is re-checked under the matter scope; one that no longer resolves
 * falls back to the matter root).
 */
export async function resolveLeadUploadTarget(
  tx: Tx,
  leadId: string,
  userId: string,
  folderId: string | null,
  /** The matter-wall check (`canAccessMatter`) — injected so this
   *  module stays free of the auth import chain. */
  canAccess: (userId: string, matterId: string) => Promise<boolean>
): Promise<LeadUploadTarget> {
  await tx.$queryRaw`SELECT id FROM "leads" WHERE id = ${leadId} FOR SHARE`;
  const lead = await tx.lead.findUnique({
    where: { id: leadId },
    select: { stage: true, convertedMatterId: true },
  });
  if (!lead) return { kind: "gone" };

  let scope: RecordScope = { kind: "lead", leadId };
  if (lead.stage === "converted") {
    if (!lead.convertedMatterId) return { kind: "gone" };
    if (!(await canAccess(userId, lead.convertedMatterId))) {
      return { kind: "forbidden", matterId: lead.convertedMatterId };
    }
    scope = { kind: "matter", matterId: lead.convertedMatterId };
  }

  let resolvedFolder: string | null = null;
  if (folderId) {
    const folder = await tx.documentFolder.findFirst({
      where: { id: folderId, ...scopeWhere(scope) },
      select: { id: true },
    });
    resolvedFolder = folder ? folder.id : null;
  }
  return { kind: "filed", scope, folderId: resolvedFolder };
}
