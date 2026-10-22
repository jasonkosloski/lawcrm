/**
 * File Thread Picker
 *
 * The clickable "Unfiled" / record pill in the email thread reader
 * header. Two states:
 *
 *   - Unfiled → "File to matter or lead…" pill with a warn-amber tint.
 *     Click opens a popover with the shared RecordPicker.
 *   - Filed → the current matter / lead chip (a lead carries a small
 *     "Lead" tag) with an icon button that opens the same popover and
 *     an "Unfile" option.
 *
 * "Unfile" is hidden when `canUnfile` is false: a thread with email
 * sent from the app must stay filed (the action refuses it too).
 *
 * Without `communication.file_email` (`canFile` false) the picker is
 * read-only: the action would redirect the viewer to the dashboard, so
 * they get the plain chip / "Unfiled" label instead.
 */

"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Briefcase, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { notifyError } from "@/lib/feedback";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { setEmailThreadRecord } from "@/app/actions/email-filing";
import type { RecordScope } from "@/lib/record-scope";
import type { FilingLeadOption, FilingMatterOption } from "@/lib/queries/communication";
import { RecordPicker } from "./record-picker";

export function FileThreadPicker({
  threadId,
  current,
  currentLabel,
  currentMeta = null,
  matters,
  leads,
  canFile = true,
  canUnfile = true,
}: {
  threadId: string;
  current: RecordScope | null;
  /** Display name of the current record (matter or lead name). */
  currentLabel: string | null;
  /** Colour dot / area for a matter chip; falls back to the options
   *  list (a closed matter isn't in it). */
  currentMeta?: { color: string; area: string } | null;
  matters: FilingMatterOption[];
  leads: FilingLeadOption[];
  /** `communication.file_email` - false renders the read-only chip. */
  canFile?: boolean;
  /** False when the thread has app-sent mail: it must stay filed. */
  canUnfile?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const file = (scope: RecordScope | null) => {
    setOpen(false);
    setError(null);
    startTransition(async () => {
      try {
        const res = await setEmailThreadRecord(threadId, scope);
        if (!res.ok && res.error) {
          setError(res.error);
          notifyError(res.error);
        }
      } catch {
        // A thrown action must not swap the page for the error boundary.
        const msg = "Couldn't update the filing - try again.";
        setError(msg);
        notifyError(msg);
      }
    });
  };

  const option =
    current?.kind === "matter" ? matters.find((m) => m.id === current.matterId) : undefined;
  const matterColor = currentMeta?.color ?? option?.color ?? null;
  const matterArea = currentMeta?.area ?? option?.area ?? null;

  const chip = current ? (
    <Link
      href={
        current.kind === "matter" ? `/matters/${current.matterId}` : `/intake/${current.leadId}`
      }
      className="inline-flex items-center gap-1.5 font-mono text-ink-3 hover:text-brand-700"
    >
      {current.kind === "matter" ? (
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: matterColor ?? undefined }}
        />
      ) : (
        <span className="px-1 rounded border border-line text-ink-4">Lead</span>
      )}
      {currentLabel}
      {matterArea ? ` · ${matterArea}` : ""}
    </Link>
  ) : null;

  if (!canFile) {
    return chip ? (
      <span className="inline-flex items-center gap-1.5 text-2xs">{chip}</span>
    ) : (
      <span className="text-2xs font-medium text-warn">Unfiled</span>
    );
  }

  const trigger = current ? (
    <span className="inline-flex items-center gap-1.5 text-2xs">
      {chip}
      <PopoverTrigger
        render={
          <button
            type="button"
            disabled={pending}
            title="Change matter or lead"
            aria-label="Change matter or lead"
            className="inline-flex items-center justify-center w-5 h-5 rounded-md text-ink-4 hover:text-brand-700 hover:bg-paper-2"
          >
            <Briefcase size={11} />
          </button>
        }
      />
    </span>
  ) : (
    <PopoverTrigger
      render={
        <button
          type="button"
          disabled={pending}
          className={cn(
            "inline-flex items-center gap-1 h-6 px-2 text-2xs font-medium rounded-md border transition-colors",
            "bg-warn-soft text-warn border-warn-border",
            "hover:border-warn",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          <Briefcase size={11} />
          File to matter or lead…
        </button>
      }
    />
  );

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        {trigger}
        <PopoverContent align="start" className="w-72">
          <div className="flex flex-col gap-2">
            <div className="text-2xs font-medium text-ink-3">File to matter or lead</div>
            <RecordPicker
              matters={matters}
              leads={leads}
              value={current}
              onChange={file}
              disabled={pending}
            />
            {current && canUnfile && (
              <div className="border-t border-line pt-2">
                <button
                  type="button"
                  onClick={() => file(null)}
                  className="w-full inline-flex items-center gap-1.5 px-2 py-1 text-2xs text-warn hover:bg-warn-soft rounded-md"
                >
                  <X size={11} />
                  Unfile (move back to inbox)
                </button>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
      {error && (
        <span role="alert" className="text-2xs text-warn">
          {error}
        </span>
      )}
    </>
  );
}
