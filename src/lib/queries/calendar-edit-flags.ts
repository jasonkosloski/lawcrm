/**
 * Per-event edit affordances for the calendar UI.
 *
 * The calendar used to light up edit / drag controls from the single
 * blanket `events.edit` key, while every action gates with the
 * per-event `canEditEvent` resolver: a creator without `events.edit`
 * got a read-only UI for their own events, and an `events.edit`
 * holder was offered controls on a colleague's personal event that
 * the server then rejected. This resolves the SAME resolver the
 * actions use, once per request, so the UI offers exactly what the
 * server will accept. The actions remain the authority.
 */

import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { currentUserHasPermission } from "@/lib/permission-check";
import {
  canEditEvent,
  viewerMayTouchLoadedEvent,
} from "@/lib/calendar-visibility";
import { filterAccessibleMatterIds } from "@/lib/matter-access";

/**
 * The subset of `eventIds` the current viewer may edit (and so drag,
 * resize and see edit controls for). Ids that don't exist are simply
 * absent from the result.
 */
export async function getEditableEventIds(
  eventIds: readonly string[]
): Promise<Set<string>> {
  if (eventIds.length === 0) return new Set();
  const [viewerId, hasEventsEdit, hasEventsEditNonMatter] = await Promise.all([
    getCurrentUserId(),
    currentUserHasPermission("events.edit"),
    currentUserHasPermission("events.edit_non_matter"),
  ]);
  // A private event of someone else, or an event behind the matter wall,
  // never gets edit/drag/resize affordances, whatever the viewer's keys
  // (the same viewerMayTouchLoadedEvent rule the actions enforce) - so
  // the lookup always runs.
  const rows = await prisma.calendarEvent.findMany({
    where: { id: { in: [...eventIds] } },
    select: { id: true, createdById: true, matterId: true, visibility: true },
  });
  const accessible = await filterAccessibleMatterIds(
    viewerId,
    rows.flatMap((r) => (r.matterId ? [r.matterId] : []))
  );
  const editable = new Set<string>();
  for (const row of rows) {
    if (
      viewerMayTouchLoadedEvent(
        viewerId,
        row,
        row.matterId ? accessible.has(row.matterId) : true
      ) &&
      canEditEvent({
        viewerId,
        createdById: row.createdById,
        matterId: row.matterId,
        // Not consulted by the edit gate (matter events are gated on
        // events.edit alone — see calendar-visibility.ts).
        matterTeamUserIds: [],
        perms: { hasEventsEdit, hasEventsEditNonMatter },
      })
    ) {
      editable.add(row.id);
    }
  }
  return editable;
}
