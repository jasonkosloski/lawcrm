/**
 * Venue table + add/edit dialog + archive/restore/delete controls for
 * /settings/venues. Each control renders only with its permission.
 */

"use client";

import { useState, useTransition } from "react";
import { Archive, ArchiveRestore, Pencil, Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  createVenue,
  deleteVenue,
  setVenueActive,
  updateVenue,
} from "@/app/actions/venues";
import type { VenueOption } from "@/lib/queries/venues";
import { inputClass, labelClass } from "@/components/ui/field";

type VenueRow = VenueOption & { matterCount: number };

const iconBtn =
  "inline-flex items-center justify-center w-7 h-7 rounded-md text-ink-3 hover:text-brand-700 hover:bg-brand-soft disabled:opacity-60";

export function VenueEditor({
  venues,
  canAdd,
  canEdit,
  canDelete,
  defaultState = "",
}: {
  venues: VenueRow[];
  canAdd: boolean;
  canEdit: boolean;
  canDelete: boolean;
  /** State prefilled on a new venue (the firm's state). */
  defaultState?: string;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<VenueRow | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok && res.error) setError(res.error);
    });
  };

  return (
    <>
      {canAdd && (
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus size={14} /> Add venue
          </Button>
        </div>
      )}

      {error && (
        <div role="alert" className="text-2xs text-warn">
          {error}
        </div>
      )}

      {venues.length === 0 ? (
        <Card>
          <CardContent className="px-4 py-6 text-xs text-ink-4">
            No venues yet.
          </CardContent>
        </Card>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>City</TableHead>
              <TableHead>County</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Matters</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {venues.map((v) => (
              <TableRow key={v.id} className={v.isActive ? "" : "opacity-70"}>
                <TableCell className="font-medium text-ink">{v.name}</TableCell>
                <TableCell>{v.city ?? ""}</TableCell>
                <TableCell>{v.county ?? ""}</TableCell>
                <TableCell>{v.state}</TableCell>
                <TableCell>{v.matterCount}</TableCell>
                <TableCell>{v.isActive ? "Active" : "Archived"}</TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-0.5">
                    {canEdit && (
                      <button
                        type="button"
                        aria-label={`Edit ${v.name}`}
                        title="Edit"
                        onClick={() => {
                          setEditing(v);
                          setOpen(true);
                        }}
                        className={iconBtn}
                      >
                        <Pencil size={13} />
                      </button>
                    )}
                    {canEdit && (
                      <button
                        type="button"
                        aria-label={`${v.isActive ? "Archive" : "Restore"} ${v.name}`}
                        title={v.isActive ? "Archive" : "Restore"}
                        disabled={pending}
                        onClick={() => run(() => setVenueActive(v.id, !v.isActive))}
                        className={iconBtn}
                      >
                        {v.isActive ? <Archive size={13} /> : <ArchiveRestore size={13} />}
                      </button>
                    )}
                    {canDelete && v.matterCount === 0 && (
                      <button
                        type="button"
                        aria-label={`Delete ${v.name}`}
                        title="Delete"
                        disabled={pending}
                        onClick={() => run(() => deleteVenue(v.id))}
                        className={iconBtn}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <VenueDialog open={open} onOpenChange={setOpen} venue={editing} defaultState={defaultState} />
    </>
  );
}

function VenueDialog({
  open,
  onOpenChange,
  venue,
  defaultState,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  venue: VenueRow | null;
  defaultState: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{venue ? "Edit venue" : "New venue"}</DialogTitle>
          <DialogDescription>
            A court or jurisdiction that matters can be filed in.
          </DialogDescription>
        </DialogHeader>
        {/* Keyed so the form state resets per row / open. */}
        <VenueForm
          key={`${venue?.id ?? "new"}-${open}`}
          venue={venue}
          defaultState={defaultState}
          onDone={() => onOpenChange(false)}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function VenueForm({
  venue,
  defaultState,
  onDone,
  onCancel,
}: {
  venue: VenueRow | null;
  defaultState: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(venue?.name ?? "");
  const [city, setCity] = useState(venue?.city ?? "");
  const [county, setCounty] = useState(venue?.county ?? "");
  const [state, setState] = useState(venue?.state ?? defaultState);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    startSaving(async () => {
      const input = { name, city, county, state };
      const res = venue ? await updateVenue(venue.id, input) : await createVenue(input);
      if (res.ok) return onDone();
      if (res.code === "invalid") setErrors(res.errors);
      else if (res.code === "exists") setFormError(`A venue named "${res.venue.name}" already exists.`);
      else if (res.code === "archived")
        setFormError(`"${res.venue.name}" exists but is archived. Restore it instead.`);
      else setFormError("This venue no longer exists.");
    });
  };

  const errP = (k: string) =>
    errors[k]?.[0] ? (
      <p role="alert" className="text-2xs text-warn">
        {errors[k][0]}
      </p>
    ) : null;

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="venue-name" className={labelClass}>
          Name <span className="text-warn">*</span>
        </label>
        <input id="venue-name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} className={inputClass()} />
        {errP("name")}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="venue-city" className={labelClass}>City</label>
          <input id="venue-city" maxLength={80} value={city} onChange={(e) => setCity(e.target.value)} className={inputClass()} />
          {errP("city")}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="venue-county" className={labelClass}>County</label>
          <input id="venue-county" maxLength={80} value={county} onChange={(e) => setCounty(e.target.value)} className={inputClass()} />
          {errP("county")}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="venue-state" className={labelClass}>
          State <span className="text-warn">*</span>
        </label>
        <input id="venue-state" required maxLength={60} value={state} onChange={(e) => setState(e.target.value)} className={inputClass()} />
        {errP("state")}
      </div>
      {formError && (
        <p role="alert" className="text-2xs text-warn">
          {formError}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? "Saving…" : venue ? "Save" : "Create"}
        </Button>
      </DialogFooter>
    </form>
  );
}
