import { visibilityChangeForMove } from "@/lib/portal/share-delta";

/**
 * Client-safe copy for the move dialog: what moving these files to
 * `targetFolderId` does to client visibility, or null when nothing changes.
 */
export function moveWarning(
  docs: { clientShare: string | null; folderId: string | null }[],
  targetFolderId: string | null,
  folders: { id: string; parentId: string | null; clientShared: boolean }[]
): string | null {
  return visibilityWarning(visibilityChangeForMove(docs, targetFolderId, folders));
}

/** The warning copy for a visibility delta, or null when it is zero. */
export function visibilityWarning({
  becomesVisible,
  becomesHidden,
}: {
  becomesVisible: number;
  becomesHidden: number;
}): string | null {
  const parts: string[] = [];
  if (becomesVisible > 0) {
    parts.push(
      becomesVisible === 1
        ? "This file will become visible to the client."
        : `${becomesVisible} files will become visible to the client.`
    );
  }
  if (becomesHidden > 0) {
    parts.push(
      becomesHidden === 1
        ? "This file will no longer be visible to the client."
        : `${becomesHidden} files will no longer be visible to the client.`
    );
  }
  return parts.length > 0 ? parts.join(" ") : null;
}
