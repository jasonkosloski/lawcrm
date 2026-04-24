/**
 * Event Time Entries Section — compact list + inline composer for
 * time entries attached to a specific calendar event.
 *
 * Mirrors EventNotesSection in shape so the two sections stack
 * naturally. Cards are flatter than the full Time tab rows — just
 * date, hours, activity, narrative preview, and a delete button.
 * The full Time tab remains the primary surface for bulk review
 * and invoicing.
 */

"use client";

import { useTransition } from "react";
import Link from "next/link";
import { ExternalLink, Lock, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { deleteTimeEntry } from "@/app/actions/time-entries";
import type { EventTimeEntry } from "@/lib/queries/calendar";
import { EventTimeEntryComposer } from "./event-time-entry-composer";

const formatDate = (d: Date): string =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function EventTimeEntriesSection({
  eventId,
  matterId,
  entries,
}: {
  eventId: string;
  /** Null for firm-wide events — time entries require a matter, so
   *  the composer hides when this is null. */
  matterId: string | null;
  entries: EventTimeEntry[];
}) {
  const totalHours = entries.reduce((s, e) => s + e.hours, 0);
  const billableHours = entries
    .filter((e) => e.billable && !e.noCharge)
    .reduce((s, e) => s + e.hours, 0);

  return (
    <div className="pt-3 border-t border-line flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <div className="text-2xs font-mono uppercase tracking-wider text-ink-4">
            Time {entries.length > 0 && `(${entries.length})`}
          </div>
          {entries.length > 0 && (
            <div className="text-2xs font-mono text-ink-3">
              {totalHours.toFixed(1)}h total
              {billableHours !== totalHours &&
                ` · ${billableHours.toFixed(1)}h billable`}
            </div>
          )}
        </div>
        {matterId && entries.length > 0 && (
          <Link
            href={`/matters/${matterId}/time`}
            className="inline-flex items-center gap-1 text-2xs text-brand-700 hover:underline"
          >
            All matter time
            <ExternalLink size={10} />
          </Link>
        )}
      </div>

      {entries.length > 0 && (
        <ul className="flex flex-col gap-2">
          {entries.map((e) => (
            <EventTimeEntryItem key={e.id} entry={e} />
          ))}
        </ul>
      )}

      {matterId ? (
        <EventTimeEntryComposer matterId={matterId} eventId={eventId} />
      ) : (
        <p className="text-2xs text-ink-4">
          Firm-wide events can&apos;t have time entries — link this event
          to a matter first.
        </p>
      )}
    </div>
  );
}

function EventTimeEntryItem({ entry }: { entry: EventTimeEntry }) {
  const [pending, startTransition] = useTransition();

  const onDelete = () => {
    if (!confirm("Delete this time entry? This can't be undone.")) return;
    startTransition(async () => {
      const res = await deleteTimeEntry(entry.id);
      if (!res.ok && res.error) alert(res.error);
    });
  };

  const mutedForBilling =
    entry.status === "billed" || entry.status === "written_off";

  return (
    <li
      className={cn(
        "rounded-md border border-line bg-paper-2/40 p-3 flex flex-col gap-1",
        pending && "opacity-60"
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-brand-50 text-2xs font-mono font-medium text-brand-700 border border-brand-100 shrink-0"
          title={entry.userName}
        >
          {entry.userInitials}
        </span>
        <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-ink truncate">
            {entry.activity}
          </span>
          {entry.privileged && (
            <span
              title="Privileged"
              className="inline-flex items-center gap-0.5 text-[10px] text-ink-4"
            >
              <Lock size={10} />
              priv
            </span>
          )}
        </div>
        <span className="font-mono text-2xs text-ink-3 shrink-0">
          {formatDate(entry.date)}
        </span>
        <span
          className={cn(
            "font-mono text-xs shrink-0",
            mutedForBilling ? "text-ink-4" : "text-ink"
          )}
        >
          {entry.hours.toFixed(1)}h
        </span>
        <button
          type="button"
          onClick={onDelete}
          disabled={pending}
          title={
            entry.status === "billed"
              ? "Entry is billed — unbill before deleting"
              : "Delete"
          }
          aria-label="Delete time entry"
          className={cn(
            "inline-flex items-center justify-center w-6 h-6 rounded-md text-ink-3 hover:text-warn hover:bg-warn-soft transition-colors disabled:opacity-60",
            entry.status === "billed" && "opacity-40"
          )}
        >
          <Trash2 size={11} />
        </button>
      </div>

      {entry.narrative && (
        <div className="text-2xs text-ink-3 leading-relaxed pl-8">
          {entry.narrative}
        </div>
      )}

      <div className="flex items-center gap-2 pl-8 text-[10px] text-ink-4 font-mono">
        <span>{STATUS_LABEL[entry.status] ?? entry.status}</span>
        {!entry.billable && <span>· non-billable</span>}
        {entry.noCharge && <span>· no charge</span>}
      </div>
    </li>
  );
}

const STATUS_LABEL: Record<string, string> = {
  draft: "draft",
  submitted: "submitted",
  billable: "billable",
  billed: "billed",
  written_off: "written off",
};
