/**
 * Floating Timer Widget — bottom-right pill on every page (mounted
 * in AppShell).
 *
 * States:
 *   - idle: a minimal-but-VISIBLE "Timer" pill (deliberate call:
 *     hiding it entirely would make the feature undiscoverable, so
 *     idle renders the smallest useful affordance — icon + label,
 *     one click starts the clock with no matter attached).
 *   - running: elapsed ticks client-side every second from the
 *     session's `startedAt` (no polling, no server round-trips);
 *     shows the matter name when set. Clicking the pill body opens
 *     a small panel to re-point matter/activity mid-run
 *     (updateTimer); Stop opens the prefilled StopTimerDialog;
 *     Discard is two-step (arms, then confirms) so one stray click
 *     can't throw away a running clock.
 *
 * The server-loaded session arrives as a prop; the widget layers an
 * optimistic local copy over it so start/discard feel instant while
 * the layout revalidation catches up. Stopping goes through the
 * dialog → `stopTimer`, which writes the TimeEntry (source "timer")
 * and deletes the session.
 */

"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Play, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  discardTimer,
  startTimer,
  updateTimer,
} from "@/app/actions/timer";
import {
  TIME_ENTRY_INCREMENT_HOURS,
  formatElapsed,
  roundElapsedToBillingIncrement,
} from "@/lib/time-entry-constants";
import type {
  ActiveTimerSession,
  TimerMatterOption,
} from "@/lib/queries/timer";
import { StopTimerDialog } from "@/components/time-entries/stop-timer-dialog";

export function TimerWidget({
  session: serverSession,
  matterOptions,
}: {
  session: ActiveTimerSession | null;
  matterOptions: TimerMatterOption[];
}) {
  // Optimistic overlay: local session state wins until the next
  // server value arrives (start/discard flip it immediately; the
  // action's layout revalidation then confirms).
  const [session, setSession] = useState(serverSession);
  useEffect(() => setSession(serverSession), [serverSession]);

  const [isPending, startTransition] = useTransition();
  const [stopOpen, setStopOpen] = useState(false);
  // Elapsed-hours snapshot FROZEN at the moment Stop is clicked —
  // passing a live ticking value as the dialog's prefill would
  // re-trigger its reset-on-open effect every second and wipe the
  // user's edits mid-typing.
  const [stopHours, setStopHours] = useState(TIME_ENTRY_INCREMENT_HOURS);
  const [panelOpen, setPanelOpen] = useState(false);
  const [discardArmed, setDiscardArmed] = useState(false);

  // 1s tick while running. `now === null` until mounted — elapsed is
  // wall-clock-derived, so rendering it on the server would guarantee
  // a hydration mismatch; the pill shows a placeholder for one frame.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!session) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [session]);

  // Disarm the discard confirm a few seconds after arming.
  const disarmRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armDiscard = () => {
    setDiscardArmed(true);
    if (disarmRef.current) clearTimeout(disarmRef.current);
    disarmRef.current = setTimeout(() => setDiscardArmed(false), 4000);
  };
  useEffect(() => {
    return () => {
      if (disarmRef.current) clearTimeout(disarmRef.current);
    };
  }, []);

  const onStart = () => {
    // Optimistic: show the running pill immediately.
    setSession({
      id: "optimistic",
      matterId: null,
      matterName: null,
      activity: null,
      startedAt: new Date().toISOString(),
    });
    startTransition(async () => {
      await startTimer();
    });
  };

  const onDiscard = () => {
    setSession(null);
    setPanelOpen(false);
    setDiscardArmed(false);
    startTransition(async () => {
      await discardTimer();
    });
  };

  // ── Idle ──────────────────────────────────────────────────────────
  if (!session) {
    return (
      <div className="fixed bottom-4 right-4 z-40">
        <button
          type="button"
          onClick={onStart}
          disabled={isPending}
          className={cn(
            "flex items-center gap-1.5 h-8 px-3 rounded-full text-xs text-ink-3",
            "bg-white border border-line shadow-md",
            "hover:border-brand-300 hover:text-brand-700 transition-colors",
            "disabled:opacity-60"
          )}
          title="Start a timer"
        >
          <Play size={12} />
          Timer
        </button>
      </div>
    );
  }

  // ── Running ───────────────────────────────────────────────────────
  const elapsedMs = now === null ? null : now - Date.parse(session.startedAt);

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2">
      {panelOpen && (
        <div className="w-64 p-3 rounded-lg bg-white border border-line shadow-lg flex flex-col gap-2">
          <div className="text-2xs font-semibold uppercase tracking-wider text-ink-3">
            Timer details
          </div>
          <select
            value={session.matterId ?? ""}
            onChange={(e) => {
              const matterId = e.target.value || null;
              const matterName =
                matterOptions.find((m) => m.id === matterId)?.name ?? null;
              setSession({ ...session, matterId, matterName });
              startTransition(async () => {
                await updateTimer({ matterId });
              });
            }}
            aria-label="Timer matter"
            className={cn(
              "h-8 px-2 rounded-md border border-line bg-white text-xs",
              session.matterId ? "text-ink" : "text-ink-4",
              "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30"
            )}
          >
            <option value="">No matter yet</option>
            {matterOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={session.activity ?? ""}
            onChange={(e) =>
              // Local echo while typing; persisted on blur so we
              // don't fire a server action per keystroke.
              setSession({ ...session, activity: e.target.value })
            }
            onBlur={(e) => {
              const activity = e.target.value.trim() || null;
              startTransition(async () => {
                await updateTimer({ activity });
              });
            }}
            placeholder="What are you working on?"
            aria-label="Timer activity"
            className={cn(
              "h-8 px-2.5 rounded-md border border-line bg-white text-xs text-ink",
              "placeholder:text-ink-4",
              "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30"
            )}
          />
        </div>
      )}

      <div className="flex items-center gap-1 h-9 pl-3 pr-1.5 rounded-full bg-ink text-white shadow-lg">
        <button
          type="button"
          onClick={() => setPanelOpen((v) => !v)}
          className="flex items-center gap-2 text-left"
          title="Edit timer matter / activity"
        >
          {/* Pulsing recording dot */}
          <span className="w-1.5 h-1.5 rounded-full bg-warn animate-pulse" />
          <span className="font-mono text-xs tabular-nums" suppressHydrationWarning>
            {elapsedMs === null ? "–:––:––" : formatElapsed(elapsedMs)}
          </span>
          {session.matterName && (
            <span className="text-2xs text-white/70 max-w-36 truncate">
              {session.matterName}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            // Timer-elapsed prefill, rounded UP to the billing
            // increment at this instant (see stopHours above).
            setStopHours(
              roundElapsedToBillingIncrement(
                Date.now() - Date.parse(session.startedAt)
              )
            );
            setStopOpen(true);
          }}
          className="flex items-center justify-center w-6 h-6 rounded-full bg-white/15 hover:bg-white/25 transition-colors ml-1"
          title="Stop timer and log time"
          aria-label="Stop timer"
        >
          <Square size={10} fill="currentColor" />
        </button>
        <button
          type="button"
          onClick={discardArmed ? onDiscard : armDiscard}
          className={cn(
            "flex items-center justify-center h-6 rounded-full transition-colors",
            discardArmed
              ? "px-2 bg-warn text-white text-2xs font-medium"
              : "w-6 text-white/60 hover:text-white hover:bg-white/15"
          )}
          title="Discard timer without logging"
          aria-label={discardArmed ? "Confirm discard" : "Discard timer"}
        >
          {discardArmed ? "Discard?" : <X size={12} />}
        </button>
      </div>

      <StopTimerDialog
        open={stopOpen}
        onOpenChange={setStopOpen}
        onStopped={() => setSession(null)}
        matterOptions={matterOptions}
        initialMatterId={session.matterId}
        initialActivity={session.activity}
        initialHours={stopHours}
      />
    </div>
  );
}
