/**
 * Settings — Venues.
 *
 * The firm's list of case locations (courts / jurisdictions) picked on
 * matters. Visible to anyone holding any venue key; the editor shows each
 * control only with its own key.
 */

import { notFound } from "next/navigation";
import { requireUser } from "@/lib/current-user";
import {
  currentUserHasAnyPermission,
  currentUserHasPermission,
} from "@/lib/permission-check";
import { listVenues } from "@/lib/queries/venues";
import { VenueEditor } from "@/components/settings/venue-editor";

export default async function VenuesPage() {
  await requireUser();
  if (
    !(await currentUserHasAnyPermission(["venues.add", "venues.edit", "venues.delete"]))
  ) {
    notFound();
  }

  const [venues, canAdd, canEdit, canDelete] = await Promise.all([
    listVenues({ activeOnly: false }),
    currentUserHasPermission("venues.add"),
    currentUserHasPermission("venues.edit"),
    currentUserHasPermission("venues.delete"),
  ]);

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <div>
        <h1 className="text-lg font-semibold text-ink">Venues</h1>
        <p className="text-xs text-ink-4 mt-1 leading-relaxed">
          The firm&apos;s list of case locations, such as courts and
          jurisdictions, that you pick on matters. Archive a venue to hide it
          from pickers while keeping it on existing matters. A venue that is in
          use on a matter can&apos;t be deleted, only archived.
        </p>
      </div>
      <VenueEditor
        venues={venues}
        canAdd={canAdd}
        canEdit={canEdit}
        canDelete={canDelete}
      />
    </div>
  );
}
