/**
 * Sync Now Button
 *
 * Small self-contained trigger for `syncMyEmailAccounts()`. Mounted
 * in the Communication page's TopBar `actions` slot (email view).
 *
 * Feedback is inline (no toast system in the app): a short status
 * note appears next to the button after a run and fades after a few
 * seconds. Pending state spins the refresh icon and disables the
 * button — the server action is safe to re-run, this is just UX.
 */

"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { cn, plural } from "@/lib/utils";
import { syncMyEmailAccounts } from "@/app/actions/email-sync";
import { Button } from "@/components/ui/button";

const NOTE_TTL_MS = 5000;

type Note = { tone: "ok" | "error"; text: string };

export function SyncNowButton() {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<Note | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Never leave a timer running past unmount.
  useEffect(
    () => () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
    },
    [],
  );

  const showNote = (next: Note) => {
    setNote(next);
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => setNote(null), NOTE_TTL_MS);
  };

  const run = () => {
    startTransition(async () => {
      try {
        const res = await syncMyEmailAccounts();
        if (res.results.length === 0) {
          showNote({ tone: "error", text: "No mailbox connected" });
        } else if (res.ok && res.results.every((r) => r.mode === "skipped")) {
          // Another sync already holds every account: nothing ran.
          showNote({ tone: "ok", text: "Sync already in progress" });
        } else if (res.ok) {
          const threads = res.results.reduce((sum, r) => sum + r.threadsSynced, 0);
          showNote({
            tone: "ok",
            text: threads > 0 ? `Synced ${plural(threads, "thread")}` : "Up to date",
          });
        } else {
          const firstError = res.results.find((r) => !r.ok)?.error;
          showNote({ tone: "error", text: firstError ?? "Sync failed" });
        }
      } catch {
        showNote({ tone: "error", text: "Sync failed — try again" });
      }
    });
  };

  return (
    <div className="flex items-center gap-2">
      {note && (
        <span
          role="status"
          className={cn(
            "text-2xs truncate max-w-56",
            note.tone === "ok" ? "text-ink-3" : "text-warn",
          )}
        >
          {note.text}
        </span>
      )}
      <Button
        variant="outline"
        size="xs"
        type="button"
        onClick={run}
        disabled={pending}
        title="Fetch the latest mail from your connected accounts"
        className={cn("text-2xs hover:bg-brand-soft", pending && "opacity-60 cursor-default")}
      >
        <RefreshCw size={12} className={cn(pending && "animate-spin")} />
        {pending ? "Syncing…" : "Sync now"}
      </Button>
    </div>
  );
}
