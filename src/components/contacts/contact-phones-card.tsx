/**
 * Contact phone-list card + manager dialog.
 *
 * Detail-page card listing every ContactPhone (label, number,
 * primary chip). "Manage" (contacts.edit only) opens a dialog that
 * edits the full list — add / remove / relabel / reorder / set
 * primary — and submits replace-all to `updateContactPhones`, which
 * enforces the exactly-one-primary + Contact.phone-mirror invariants
 * server-side.
 */

"use client";

import { useState, useTransition } from "react";
import {
  ChevronDown,
  ChevronUp,
  Pencil,
  Phone,
  Plus,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatPhone } from "@/lib/format-phone";
import { updateContactPhones } from "@/app/actions/contacts";
import type { ContactPhoneEntry } from "@/lib/contact-form";

export type ContactPhoneRow = {
  id: string;
  label: string | null;
  number: string;
  isPrimary: boolean;
};

const inputClass =
  "h-8 px-2.5 rounded-md border border-line bg-white text-xs text-ink w-full " +
  "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 " +
  "placeholder:text-ink-4";

export function ContactPhonesCard({
  contactId,
  phones,
  canEdit,
}: {
  contactId: string;
  phones: ContactPhoneRow[];
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <CardHeader className="pb-2 flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          Phone numbers
          <span className="text-2xs font-mono font-normal text-ink-4">
            {phones.length}
          </span>
        </CardTitle>
        {canEdit && (
          <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
            <Pencil />
            Manage
          </Button>
        )}
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {phones.length === 0 ? (
          <div className="py-2 text-xs text-ink-4">
            No phone numbers on file.
          </div>
        ) : (
          <ul className="flex flex-col">
            {phones.map((p) => (
              <li
                key={p.id}
                className="flex items-center gap-2.5 py-1.5 border-b border-line last:border-b-0 text-xs"
              >
                <Phone size={12} className="text-ink-4 shrink-0" />
                <span className="font-mono text-ink">
                  {formatPhone(p.number)}
                </span>
                {p.label && <span className="text-ink-3">{p.label}</span>}
                {p.isPrimary && (
                  <span className="ml-auto text-2xs font-medium px-1.5 py-0.5 rounded-full bg-brand-soft text-brand-700 border border-brand-200">
                    Primary
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {canEdit && (
        <ManagePhonesDialog
          contactId={contactId}
          phones={phones}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </Card>
  );
}

function ManagePhonesDialog({
  contactId,
  phones,
  open,
  onOpenChange,
}: {
  contactId: string;
  phones: ContactPhoneRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [rows, setRows] = useState<ContactPhoneEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Re-seed the working copy every time the dialog opens.
  const handleOpenChange = (next: boolean) => {
    if (next) {
      setRows(
        phones.map((p) => ({
          label: p.label ?? "",
          number: p.number,
          isPrimary: p.isPrimary,
        }))
      );
      setError(null);
    }
    onOpenChange(next);
  };

  const patch = (i: number, changes: Partial<ContactPhoneEntry>) =>
    setRows((prev) =>
      prev.map((r, idx) => (idx === i ? { ...r, ...changes } : r))
    );

  const setPrimary = (i: number) =>
    setRows((prev) => prev.map((r, idx) => ({ ...r, isPrimary: idx === i })));

  const remove = (i: number) =>
    setRows((prev) => prev.filter((_, idx) => idx !== i));

  const move = (i: number, delta: -1 | 1) =>
    setRows((prev) => {
      const j = i + delta;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const add = () =>
    setRows((prev) => [
      ...prev,
      { label: "", number: "", isPrimary: prev.length === 0 },
    ]);

  const save = () => {
    if (rows.some((r) => r.number.trim().length === 0)) {
      setError("Every phone needs a number — remove empty rows first.");
      return;
    }
    startTransition(async () => {
      const res = await updateContactPhones(contactId, rows);
      if (res.ok) {
        onOpenChange(false);
      } else {
        setError(res.error ?? "Could not save phone numbers");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Manage phone numbers</DialogTitle>
          <DialogDescription>
            The primary number is what shows across the app (matters,
            call logging, the directory).
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {rows.length === 0 && (
            <div className="py-2 text-xs text-ink-4">
              No phone numbers — add one below.
            </div>
          )}
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input
                type="radio"
                name="primary-phone"
                checked={r.isPrimary}
                onChange={() => setPrimary(i)}
                title="Set as primary"
                aria-label={`Set ${r.number || "this number"} as primary`}
                className="accent-brand-500 shrink-0"
              />
              <input
                type="text"
                value={r.number}
                onChange={(e) => patch(i, { number: e.target.value })}
                placeholder="(555) 555-5555"
                aria-label="Phone number"
                className={cn(inputClass, "flex-1 font-mono")}
              />
              <input
                type="text"
                value={r.label}
                onChange={(e) => patch(i, { label: e.target.value })}
                placeholder="Label"
                aria-label="Phone label"
                className={cn(inputClass, "w-24")}
              />
              <div className="flex flex-col shrink-0">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label="Move up"
                  className="p-0.5 rounded text-ink-3 hover:text-ink disabled:opacity-30"
                >
                  <ChevronUp size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === rows.length - 1}
                  aria-label="Move down"
                  className="p-0.5 rounded text-ink-3 hover:text-ink disabled:opacity-30"
                >
                  <ChevronDown size={12} />
                </button>
              </div>
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label="Remove phone"
                className="p-1 rounded text-ink-3 hover:text-warn shrink-0"
              >
                <X size={13} />
              </button>
            </div>
          ))}

          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-fit"
            onClick={add}
          >
            <Plus />
            Add phone
          </Button>

          {error && (
            <div className="text-xs text-warn px-3 py-2 rounded-md bg-warn-soft border border-warn-border">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save phones"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
