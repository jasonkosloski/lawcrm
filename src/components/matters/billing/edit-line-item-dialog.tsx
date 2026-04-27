/**
 * Edit Line Item Dialog — in-place edit of a single TimeEntry row
 * attached to a draft or approved invoice.
 *
 * Editable fields: date, activity, narrative, hours, rate. The
 * amount is computed client-side from hours × rate as a preview
 * (the server recomputes authoritatively). On contingent matters
 * where the entry never had a rate, the rate field stays empty
 * and amount renders as "—" — the entry sits on the invoice as
 * a record of work but doesn't contribute to the subtotal.
 *
 * Server: see `updateInvoiceLineItem` in `app/actions/billing.ts`.
 * The action gates on invoice state (draft/approved only) and on
 * `time_entries.edit_any` for non-author actors.
 */

"use client";

import { useActionState, useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { updateInvoiceLineItem } from "@/app/actions/billing";
import {
  lineItemEditInitialState,
  type LineItemEditState,
} from "@/lib/billing-form";

const formatMoney = (n: number): string =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const toIso = (d: Date): string => {
  // YYYY-MM-DD in the browser's local timezone — matches the
  // `<input type="date">` expected format.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export function EditLineItemDialog({
  timeEntryId,
  initial,
}: {
  timeEntryId: string;
  initial: {
    date: Date;
    activity: string;
    narrative: string | null;
    hours: number;
    rate: number | null;
  };
}) {
  const [open, setOpen] = useState(false);
  const action = updateInvoiceLineItem.bind(null, timeEntryId);
  const [state, formAction, isPending] = useActionState<
    LineItemEditState,
    FormData
  >(action, lineItemEditInitialState);

  // Mirror form state into local state for the live amount preview.
  // We don't need to round-trip these to the server on submit (the
  // form's native FormData captures them) — these mirrors only drive
  // the "Amount: $X.XX" preview line.
  const [hoursStr, setHoursStr] = useState(String(initial.hours));
  const [rateStr, setRateStr] = useState(
    initial.rate !== null ? String(initial.rate) : ""
  );

  // Reset form state when reopening so a previous error doesn't
  // linger after the user closed + reopened the dialog.
  useEffect(() => {
    if (open) {
      setHoursStr(String(initial.hours));
      setRateStr(initial.rate !== null ? String(initial.rate) : "");
    }
  }, [open, initial.hours, initial.rate]);

  // Close + reset on a successful submit.
  useEffect(() => {
    if (state.status === "ok") {
      setOpen(false);
    }
  }, [state.status]);

  const previewAmount = (() => {
    const h = Number(hoursStr);
    const r = Number(rateStr);
    if (!Number.isFinite(h) || h <= 0) return null;
    if (!rateStr || !Number.isFinite(r) || r <= 0) return null;
    return h * r;
  })();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Edit line item"
        title="Edit line item"
        className="inline-flex items-center justify-center w-6 h-6 rounded-md text-ink-4 hover:bg-paper-2 hover:text-ink"
      >
        <Pencil size={11} />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <form action={formAction} className="flex flex-col gap-3">
            <DialogHeader>
              <DialogTitle>Edit line item</DialogTitle>
              <DialogDescription className="text-2xs">
                Changes write straight to the underlying time entry.
                Allowed only while this invoice is still a draft or
                approved — once sent, void + regenerate.
              </DialogDescription>
            </DialogHeader>

            {state.status === "error" && state.error && (
              <div className="text-2xs text-warn bg-warn-soft border border-warn-border rounded-md px-2.5 py-1.5">
                {state.error}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-2xs text-ink-3">
                Date
                <input
                  type="date"
                  name="date"
                  defaultValue={toIso(initial.date)}
                  required
                  className="h-8 px-2 rounded-md border border-line text-xs text-ink bg-white"
                />
                {state.errors?.date?.[0] && (
                  <span className="text-2xs text-warn">
                    {state.errors.date[0]}
                  </span>
                )}
              </label>

              <label className="flex flex-col gap-1 text-2xs text-ink-3">
                Hours
                <input
                  type="number"
                  name="hours"
                  step="0.1"
                  min="0.1"
                  max="24"
                  value={hoursStr}
                  onChange={(e) => setHoursStr(e.target.value)}
                  required
                  className="h-8 px-2 rounded-md border border-line text-xs text-ink bg-white font-mono"
                />
                {state.errors?.hours?.[0] && (
                  <span className="text-2xs text-warn">
                    {state.errors.hours[0]}
                  </span>
                )}
              </label>
            </div>

            <label className="flex flex-col gap-1 text-2xs text-ink-3">
              Activity
              <input
                type="text"
                name="activity"
                defaultValue={initial.activity}
                required
                maxLength={200}
                className="h-8 px-2 rounded-md border border-line text-xs text-ink bg-white"
              />
              {state.errors?.activity?.[0] && (
                <span className="text-2xs text-warn">
                  {state.errors.activity[0]}
                </span>
              )}
            </label>

            <label className="flex flex-col gap-1 text-2xs text-ink-3">
              Narrative <span className="text-ink-4">(optional)</span>
              <textarea
                name="narrative"
                defaultValue={initial.narrative ?? ""}
                rows={3}
                maxLength={4000}
                className="px-2 py-1.5 rounded-md border border-line text-xs text-ink bg-white resize-y"
              />
              {state.errors?.narrative?.[0] && (
                <span className="text-2xs text-warn">
                  {state.errors.narrative[0]}
                </span>
              )}
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-2xs text-ink-3">
                Rate
                <input
                  type="number"
                  name="rate"
                  step="0.01"
                  min="0"
                  value={rateStr}
                  onChange={(e) => setRateStr(e.target.value)}
                  placeholder="$/hr"
                  className="h-8 px-2 rounded-md border border-line text-xs text-ink bg-white font-mono"
                />
                {state.errors?.rate?.[0] && (
                  <span className="text-2xs text-warn">
                    {state.errors.rate[0]}
                  </span>
                )}
              </label>

              <div className="flex flex-col gap-1 text-2xs text-ink-3">
                Amount
                <div
                  className={cn(
                    "h-8 px-2 rounded-md border border-line bg-paper-2 flex items-center font-mono text-xs",
                    previewAmount === null ? "text-ink-4" : "text-ink"
                  )}
                  aria-live="polite"
                >
                  {previewAmount !== null ? formatMoney(previewAmount) : "—"}
                </div>
                <span className="text-2xs text-ink-4">
                  {previewAmount !== null
                    ? "Computed from hours × rate"
                    : "Leave rate empty for contingent / no-rate entries"}
                </span>
              </div>
            </div>

            <DialogFooter className="mt-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setOpen(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={isPending}>
                {isPending ? "Saving…" : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
