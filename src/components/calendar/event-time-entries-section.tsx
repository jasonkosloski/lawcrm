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
import { confirmAction, notifyError } from "@/lib/feedback";
import { deleteTimeEntry } from "@/app/actions/time-entries";
// Entry dates are date-only values (ADR-012): `formatDateOnly` reads
// them in UTC, so the server render and every browser show the day
// they were saved on. (`formatDate` without a zone ran in the
// browser's zone and showed Denver users the previous day.)
import { formatDateOnly } from "@/lib/format-date";
import { formatHours } from "@/lib/time-entry-constants";
import type { EventTimeEntry } from "@/lib/queries/calendar";
import {
  canDeleteRecord,
  useEventAttachmentsViewer,
} from "./event-attachments-context";
import { EventTimeEntryComposer } from "./event-time-entry-composer";
import { TIME_ENTRY_STATUS_LABEL } from "@/lib/constants/time-entry-status";

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
          <div className="text-2xs font-medium text-ink-3">
            Time {entries.length > 0 && `(${entries.length})`}
          </div>
          {entries.length > 0 && (
            <div className="text-2xs font-mono text-ink-3">
              {formatHours(totalHours)}h total
              {billableHours !== totalHours &&
                ` · ${formatHours(billableHours)}h billable`}
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
  // Deleting a colleague's entry needs time_entries.delete_any; hide
  // the button rather than bounce the user to "/" on denial.
  const { viewerId, canDeleteAnyTimeEntry } = useEventAttachmentsViewer();
  const canDelete = canDeleteRecord(
    entry.userId,
    viewerId,
    canDeleteAnyTimeEntry
  );

  const onDelete = async () => {
    if (
      !(await confirmAction({
        title: "Delete this time entry?",
        description: "This can't be undone.",
        confirmLabel: "Delete time entry",
        destructive: true,
      }))
    )
      return;
    startTransition(async () => {
      const res = await deleteTimeEntry(entry.id);
      if (!res.ok && res.error) notifyError(res.error);
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
              className="inline-flex items-center gap-0.5 text-3xs text-ink-4"
            >
              <Lock size={10} />
              priv
            </span>
          )}
        </div>
        <span className="font-mono text-2xs text-ink-3 shrink-0">
          {formatDateOnly(entry.date, "short")}
        </span>
        <span
          className={cn(
            "font-mono text-xs shrink-0",
            mutedForBilling ? "text-ink-4" : "text-ink"
          )}
        >
          {formatHours(entry.hours)}h
        </span>
        {canDelete && (
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
        )}
      </div>

      {entry.narrative && (
        <div className="text-2xs text-ink-3 leading-relaxed pl-8">
          {entry.narrative}
        </div>
      )}

      <div className="flex items-center gap-2 pl-8 text-3xs text-ink-4 font-mono">
        <span>{(TIME_ENTRY_STATUS_LABEL as Record<string, string>)[entry.status]?.toLowerCase() ?? entry.status}</span>
        {!entry.billable && <span>· non-billable</span>}
        {entry.noCharge && <span>· no charge</span>}
      </div>
    </li>
  );
}
