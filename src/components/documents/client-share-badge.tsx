/**
 * "Shared" badge for a file or folder the client can see in the portal.
 * The tooltip says why: shared directly, or via an ancestor folder.
 */

import type { shareReason } from "@/lib/portal/document-visibility";
import { Badge } from "@/components/ui/badge";

export type ShareReason = ReturnType<typeof shareReason>;

export function ClientShareBadge({ reason }: { reason: ShareReason }) {
  if (!reason) return null;
  const title =
    reason.kind === "file" ? "Shared with client" : `Shared via folder ${reason.folderName}`;
  return (
    <Badge title={title} variant="neutral" className="ml-2 align-middle">
      Shared
    </Badge>
  );
}
