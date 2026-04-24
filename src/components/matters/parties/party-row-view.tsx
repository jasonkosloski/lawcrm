/**
 * Party Row View — one row in the Parties table that toggles between
 * a read-only display and an in-place edit form.
 *
 * In display mode it renders the standard cells; in edit mode it
 * collapses into a single colSpan cell with the PartyEditForm. Edit
 * is available on every party (client, opposing, witnesses, other).
 * Delete is hidden on the primary client row — see PartyRowActions.
 */

"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { TableCell, TableRow } from "@/components/ui/table";
import type { PartyRow } from "@/lib/queries/matter-detail";
import type { PartyCategory } from "@/lib/party-constants";
import { PartyEditForm } from "./party-edit-form";
import { PartyRowActions } from "./party-row-actions";

export function PartyRowView({
  party,
  category,
  showsRepresentation,
  showsOrganization,
  colSpan,
}: {
  party: PartyRow;
  category: PartyCategory;
  showsRepresentation: boolean;
  showsOrganization: boolean;
  /** Total number of columns this row spans when in edit mode. */
  colSpan: number;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <TableRow>
        <TableCell colSpan={colSpan} className="p-3 bg-paper-2/30">
          <PartyEditForm
            party={party}
            category={category}
            onDone={() => setEditing(false)}
          />
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow>
      <TableCell className="pl-4 font-medium text-ink">
        <div className="flex items-center gap-2">
          <span>{party.name}</span>
          {party.isPrimaryClient && (
            <span
              className="text-2xs font-medium px-1.5 py-0.5 rounded-full bg-brand-soft text-brand-700 border border-brand-200"
              title="This matter's primary client — set via Matter → Edit"
            >
              Primary
            </span>
          )}
          {party.conflictStatus === "flagged" && (
            <span className="text-2xs font-medium px-1.5 py-0.5 rounded-full bg-warn-soft text-warn border border-warn-border">
              conflict flagged
            </span>
          )}
        </div>
      </TableCell>
      <TableCell className="text-2xs text-ink-3 capitalize">
        {party.role ? party.role.replace(/_/g, " ") : "—"}
      </TableCell>
      {showsOrganization && (
        <TableCell className="text-xs text-ink-3">
          {party.organization ?? "—"}
        </TableCell>
      )}
      <TableCell className="text-xs text-ink-3">
        <div className="flex flex-col leading-tight">
          {party.email && <span>{party.email}</span>}
          {party.phone && (
            <span className="font-mono text-2xs text-ink-4">
              {party.phone}
            </span>
          )}
          {!party.email && !party.phone && "—"}
        </div>
      </TableCell>
      {showsRepresentation && (
        <TableCell className="text-xs">
          <RepresentationCell party={party} />
        </TableCell>
      )}
      <TableCell className="text-xs text-ink-3 max-w-xs truncate">
        {party.notes ?? "—"}
      </TableCell>
      <TableCell className="pr-4">
        <div className="inline-flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setEditing(true)}
            title="Edit party"
            aria-label="Edit party"
            className={cn(
              "inline-flex items-center justify-center w-7 h-7 rounded-md",
              "text-ink-3 hover:text-brand-700 hover:bg-brand-soft transition-colors"
            )}
          >
            <Pencil size={12} />
          </button>
          {!party.isPrimaryClient && (
            <PartyRowActions
              matterContactId={party.id}
              name={party.name}
            />
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function RepresentationCell({ party }: { party: PartyRow }) {
  if (party.isRepresented === false) {
    return (
      <span className="inline-block text-2xs font-medium px-1.5 py-0.5 rounded-full border bg-paper-2 text-ink-3 border-line">
        Pro se
      </span>
    );
  }
  if (party.isRepresented === true && party.representationName) {
    return (
      <div className="flex flex-col leading-tight">
        <span className="text-ink font-medium truncate">
          {party.representationName}
        </span>
        {party.representationFirm && (
          <span className="text-2xs text-ink-3 truncate">
            {party.representationFirm}
          </span>
        )}
        {party.representationEmail && (
          <span className="text-2xs text-ink-4 truncate">
            {party.representationEmail}
          </span>
        )}
        {party.representationPhone && (
          <span className="text-2xs font-mono text-ink-4">
            {party.representationPhone}
          </span>
        )}
      </div>
    );
  }
  if (party.isRepresented === true) {
    return (
      <span className="text-2xs text-ink-4 italic">
        Represented (details unknown)
      </span>
    );
  }
  return <span className="text-ink-4">—</span>;
}
