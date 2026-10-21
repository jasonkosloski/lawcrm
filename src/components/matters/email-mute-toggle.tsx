/**
 * Email Mute Toggle
 *
 * Bell button in the matter header that mutes or unmutes the current
 * user's notification EMAILS for this matter (the in-app bell is
 * unaffected, and deadline reminders still email). Same shape as
 * PinToggle: optimistic flip, sends the state clicked toward
 * (idempotent), reports failures instead of throwing.
 */

"use client";

import { Bell, BellOff } from "lucide-react";
import { useOptimistic, useTransition } from "react";
import { setMatterEmailMute } from "@/app/actions/notification-preferences";
import { cn } from "@/lib/utils";
import { notifyError } from "@/lib/feedback";

export function EmailMuteToggle({
  matterId,
  initialMuted,
}: {
  matterId: string;
  initialMuted: boolean;
}) {
  const [optimisticMuted, setOptimisticMuted] = useOptimistic(initialMuted);
  const [pending, startTransition] = useTransition();

  const onClick = () => {
    const target = !optimisticMuted;
    startTransition(async () => {
      setOptimisticMuted(target);
      try {
        const res = await setMatterEmailMute(matterId, target);
        if (!res.ok) notifyError(res.error ?? "Couldn't update email notifications.");
      } catch {
        notifyError("Couldn't update email notifications. Please try again.");
      }
    });
  };

  const Icon = optimisticMuted ? BellOff : Bell;
  const label = optimisticMuted
    ? "Unmute email notifications for this matter"
    : "Mute email notifications for this matter";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-pressed={optimisticMuted}
      aria-label={label}
      title={`${label} (deadline reminders still arrive)`}
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md border transition-colors",
        optimisticMuted
          ? "bg-paper-2 text-ink-2 border-line-2 hover:text-brand-700 hover:border-brand-300"
          : "bg-white text-ink-3 border-line hover:text-brand-700 hover:border-brand-300",
        pending && "opacity-70"
      )}
    >
      <Icon size={13} />
      {optimisticMuted ? "Muted" : "Email"}
    </button>
  );
}
