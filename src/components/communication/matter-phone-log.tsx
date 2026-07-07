/**
 * Matter Phone Log
 *
 * The Phone channel of the matter-detail Communication tab — one row
 * per call / SMS / voicemail filed to this matter (directly or via
 * its thread's default routing), newest first. Rows link out to the
 * full thread reader on /communication?view=messages since the
 * embedded reader is email-only today.
 */

import Link from "next/link";
import {
  MessageSquare,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Voicemail,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatDate } from "@/lib/format-date";
import { formatPhone } from "@/lib/format-phone";
import {
  asCallOutcome,
  formatCallDuration,
  type EditableCallLog,
} from "@/lib/call-log-form";
import type { MatterMessengerItemRow } from "@/lib/queries/messenger";
import { ManualCallActions } from "./manual-call-actions";
import type { CallMatterOption } from "./log-call-button";

function itemIcon(item: MatterMessengerItemRow) {
  if (item.kind === "voicemail") return Voicemail;
  if (item.kind === "sms") return MessageSquare;
  const missed =
    item.callStatus === "missed" || item.callStatus === "no_answer";
  if (missed) return PhoneMissed;
  return item.direction === "inbound" ? PhoneIncoming : PhoneOutgoing;
}

function itemLabel(item: MatterMessengerItemRow): string {
  const who = item.contactName ?? formatPhone(item.contactPhone);
  if (item.kind === "voicemail") return `Voicemail from ${who}`;
  if (item.kind === "sms")
    return item.direction === "inbound" ? `Text from ${who}` : `Text to ${who}`;
  if (item.callStatus === "missed" || item.callStatus === "no_answer")
    return `Missed call · ${who}`;
  return item.direction === "inbound"
    ? `Inbound call · ${who}`
    : `Outbound call · ${who}`;
}

export function MatterPhoneLog({
  items,
  canEditCall = false,
  canDeleteCall = false,
  matterName,
  editMatters = [],
}: {
  items: MatterMessengerItemRow[];
  /** `communication.edit_call` / `.delete_call` — resolved by the
   *  page; gate the kebab on manual call rows. */
  canEditCall?: boolean;
  canDeleteCall?: boolean;
  /** Name of the matter this log belongs to — display label for a
   *  row whose item-level filing IS this matter (rows here are filed
   *  either to it or to nothing + inherited). */
  matterName?: string;
  /** Open-matter options for the edit dialog's re-file select. */
  editMatters?: CallMatterOption[];
}) {
  if (items.length === 0) {
    return (
      <Card className="p-6 flex items-center gap-3">
        <Phone size={14} className="text-ink-4 shrink-0" />
        <div className="text-xs text-ink-3 leading-relaxed">
          No calls or texts filed to this matter yet. Use{" "}
          <span className="font-medium text-ink-2">Log call</span> to record
          one, or file a thread from the main inbox.
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-0 overflow-hidden">
      <ul className="divide-y divide-line">
        {items.map((item) => {
          const Icon = itemIcon(item);
          const missed =
            item.kind === "call" &&
            (item.callStatus === "missed" || item.callStatus === "no_answer");
          const duration =
            item.kind === "call"
              ? formatCallDuration(item.callDurationSec)
              : null;
          // Edit/delete only on manually logged calls — provider
          // items are immutable records.
          const showActions =
            item.kind === "call" &&
            item.isManual &&
            (canEditCall || canDeleteCall);
          const editable: EditableCallLog | null = showActions
            ? {
                id: item.id,
                contactLabel:
                  item.contactName ?? formatPhone(item.contactPhone),
                direction: item.direction,
                outcome: asCallOutcome(item.callStatus),
                occurredAt: item.occurredAt,
                durationSec: item.callDurationSec,
                matterId: item.matterId,
                // Rows here are filed to this matter or inherit it —
                // when item-level filing exists it IS this matter.
                matterName: item.matterId ? (matterName ?? null) : null,
                summary: item.body,
              }
            : null;
          return (
            <li key={item.id} className="flex items-stretch">
              <Link
                href={`/communication?view=messages&thread=${item.threadId}`}
                className="flex-1 min-w-0 flex items-start gap-3 px-4 py-2.5 text-xs hover:bg-paper-2 transition-colors"
              >
                <Icon
                  size={13}
                  className={
                    (missed ? "text-warn" : "text-ink-4") + " shrink-0 mt-0.5"
                  }
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={
                        "font-medium truncate " +
                        (missed ? "text-warn" : "text-ink")
                      }
                    >
                      {itemLabel(item)}
                    </span>
                    {duration && (
                      <span className="text-2xs font-mono text-ink-4 shrink-0">
                        {duration}
                      </span>
                    )}
                  </div>
                  {item.body && (
                    <div className="text-ink-3 truncate mt-0.5">
                      {item.body}
                    </div>
                  )}
                </div>
                <span className="text-2xs font-mono text-ink-4 shrink-0">
                  {formatDate(item.occurredAt, "datetime")}
                </span>
              </Link>
              {editable && (
                <div className="flex items-center pr-3 shrink-0">
                  <ManualCallActions
                    item={editable}
                    canEdit={canEditCall}
                    canDelete={canDeleteCall}
                    matters={editMatters}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
