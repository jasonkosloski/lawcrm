/**
 * "Shared" badge for a file or folder the client can see in the portal.
 * The tooltip says why: shared directly, or via an ancestor folder.
 */

import type { shareReason } from "@/lib/portal/document-visibility";

export type ShareReason = ReturnType<typeof shareReason>;

export function ClientShareBadge({ reason }: { reason: ShareReason }) {
  if (!reason) return null;
  const title =
    reason.kind === "file"
      ? "Shared with client"
      : `Shared via folder ${reason.folderName}`;
  return (
    <span
      title={title}
      className="ml-2 inline-block text-2xs font-medium px-1.5 py-0.5 rounded-full bg-paper-2 text-ink-3 align-middle"
    >
      Shared
    </span>
  );
}
