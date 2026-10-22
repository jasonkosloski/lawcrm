import { isEffectivelyShared, sharedFolderIds } from "@/lib/portal/document-visibility";

/**
 * Client-safe (no server imports): what a move does to client visibility,
 * so the move dialog can warn before calling `moveDocuments`. Archived
 * files never count: the portal never shows them.
 */
export function visibilityChangeForMove(
  docs: { clientShare: string | null; folderId: string | null; status?: string }[],
  targetFolderId: string | null,
  folders: { id: string; parentId: string | null; clientShared: boolean }[],
): { becomesVisible: number; becomesHidden: number } {
  const shared = sharedFolderIds(folders);
  let becomesVisible = 0;
  let becomesHidden = 0;
  for (const doc of docs) {
    if (doc.status === "archived") continue;
    const before = isEffectivelyShared(doc, shared);
    const after = isEffectivelyShared({ ...doc, folderId: targetFolderId }, shared);
    if (!before && after) becomesVisible++;
    else if (before && !after) becomesHidden++;
  }
  return { becomesVisible, becomesHidden };
}
