/**
 * Log Time on Communication Item Button
 *
 * A compact "Log time" pill that opens the shared
 * <LogTimeOnEntityDialog>. Used on:
 *   - Each EmailMessage card in the email thread reader
 *   - Each MessengerItem (SMS bubble / call event / voicemail card)
 *
 * Disabled with a tooltip when the source isn't filed to a matter
 * (matches the InboxActionButtons posture so the affordance feels
 * consistent across surfaces).
 */

"use client";

import { useState } from "react";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  addTimeEntryToEmailMessage,
  addTimeEntryToMessengerItem,
} from "@/app/actions/time-on-entity";
import { LogTimeOnEntityDialog } from "@/components/time-entries/log-time-on-entity-dialog";

export type CommSource =
  | { kind: "email"; messageId: string; label: string }
  | { kind: "messenger"; itemId: string; label: string };

export function LogTimeOnCommButton({
  source,
  isFiled,
  /** "compact" renders a square icon-only button — for cramped SMS
   *  bubbles. Default is the full pill. */
  variant = "default",
}: {
  source: CommSource;
  isFiled: boolean;
  variant?: "default" | "compact";
}) {
  const [open, setOpen] = useState(false);

  const action =
    source.kind === "email"
      ? addTimeEntryToEmailMessage.bind(null, source.messageId)
      : addTimeEntryToMessengerItem.bind(null, source.itemId);

  const tooltip = isFiled
    ? `Log time on this ${source.kind === "email" ? "email" : "message"}`
    : source.kind === "email"
      ? "File this email thread to a matter first"
      : "File this conversation to a matter first";

  if (variant === "compact") {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={!isFiled}
          aria-label="Log time"
          title={tooltip}
          className={cn(
            "inline-flex items-center justify-center w-6 h-6 rounded-md border border-line bg-white/70 text-ink-3 transition-colors",
            "hover:border-brand-300 hover:bg-brand-soft hover:text-brand-700",
            "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-line disabled:hover:bg-white/70 disabled:hover:text-ink-3"
          )}
        >
          <Clock size={11} />
        </button>
        <LogTimeOnEntityDialog
          open={open}
          onOpenChange={setOpen}
          action={action}
          parentLabel={source.label}
          parentKind={source.kind === "email" ? "email" : "message"}
        />
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!isFiled}
        title={tooltip}
        className={cn(
          "inline-flex items-center gap-1 h-7 px-2 text-2xs font-medium rounded-md border transition-colors",
          "bg-white text-ink-3 border-line",
          "hover:border-brand-300 hover:text-brand-700 hover:bg-brand-soft",
          "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-line disabled:hover:text-ink-3 disabled:hover:bg-white"
        )}
      >
        <Clock size={11} />
        Log time
      </button>
      <LogTimeOnEntityDialog
        open={open}
        onOpenChange={setOpen}
        action={action}
        parentLabel={source.label}
        parentKind="task"
      />
    </>
  );
}
