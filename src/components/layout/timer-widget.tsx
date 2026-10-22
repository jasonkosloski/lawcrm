/**
 * Floating Timer Widget — bottom-right pill on every page (mounted
 * in AppShell).
 *
 * States:
 *   - idle: a minimal-but-VISIBLE round play button (deliberate call:
 *     hiding it entirely would make the feature undiscoverable, so
 *     idle renders the smallest useful affordance; a 36px icon covers
 *     less of the page than a labelled pill. One click starts the
 *     clock with no matter attached).
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
 * the layout revalidation catches up. The local copy is re-synced
 * only when the server session's CONTENT changes (not on every RSC
 * payload — the layout re-renders for unrelated revalidations), and
 * the activity text being typed lives in its own draft so a payload
 * landing mid-keystroke can't overwrite it.
 *
 * Every server-action call is wrapped: a thrown action (deploy skew,
 * DB error) or an `{ ok: false }` result rolls the optimistic state
 * back, re-reads the server, and shows an inline error. Unhandled, a
 * rejection inside a transition is rethrown into the nearest error
 * boundary — and this widget lives in the layout, so that would
 * replace the whole app.
 *
 * Stopping goes through the dialog → `stopTimer`, which writes the
 * TimeEntry (source "timer") and deletes the session. `canLogTime`
 * (time_entries.create, resolved server-side) disables Stop for users
 * who can only discard — stopTimer would otherwise bounce them to "/"
 * with the dialog still open.
 */

"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { discardTimer, startTimer, updateTimer } from "@/app/actions/timer";
import {
  TIME_ENTRY_INCREMENT_HOURS,
  formatElapsed,
  roundElapsedToBillingIncrement,
} from "@/lib/time-entry-constants";
import type { ActiveTimerSession, TimerMatterOption } from "@/lib/queries/timer";
import { StopTimerDialog } from "@/components/time-entries/stop-timer-dialog";
import { inputClass } from "@/components/ui/field";

const OPTIMISTIC_SESSION_ID = "optimistic";

export const TIMER_NETWORK_ERROR =
  "Couldn't reach the server. Your timer wasn't changed — please try again.";

/** Content fingerprint of a server session: the local copy re-syncs
 *  when this changes, not on object identity (every layout render
 *  delivers a fresh object). */
function sessionKey(s: ActiveTimerSession | null): string | null {
  return s ? [s.id, s.startedAt, s.matterId, s.matterName, s.activity].join("|") : null;
}

/** Ticking elapsed readout. Mounted only while a timer runs, so its
 *  "now" is fresh at mount (lazy initializer) and updates only from
 *  the interval callback. The server render and first client render
 *  can differ by seconds — hence suppressHydrationWarning. */
function ElapsedClock({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="text-xs tabular-nums" suppressHydrationWarning>
      {formatElapsed(Math.max(0, now - Date.parse(startedAt)))}
    </span>
  );
}

export function TimerWidget({
  session: serverSession,
  matterOptions,
  canLogTime = true,
}: {
  session: ActiveTimerSession | null;
  matterOptions: TimerMatterOption[];
  /** Viewer holds `time_entries.create`. When false, Stop is disabled
   *  (Discard stays). The server action still enforces it. */
  canLogTime?: boolean;
}) {
  // Optimistic overlay: local session state wins until the server
  // session's content changes (start/discard flip it immediately; the
  // action's layout revalidation then confirms). Synced during render
  // by comparing against the previous server key — no effect needed.
  const router = useRouter();
  const [session, setSession] = useState(serverSession);
  const [prevServerKey, setPrevServerKey] = useState(sessionKey(serverSession));
  const serverKey = sessionKey(serverSession);
  if (serverKey !== prevServerKey) {
    setPrevServerKey(serverKey);
    setSession(serverSession);
  }

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [stopOpen, setStopOpen] = useState(false);
  // Elapsed-hours snapshot FROZEN at the moment Stop is clicked —
  // passing a live ticking value as the dialog's prefill would
  // re-trigger its reset-on-open effect every second and wipe the
  // user's edits mid-typing.
  const [stopHours, setStopHours] = useState(TIME_ENTRY_INCREMENT_HOURS);
  const [panelOpen, setPanelOpen] = useState(false);
  const [discardArmed, setDiscardArmed] = useState(false);
  // Activity text while the input is being edited; null = show the
  // session's value. Kept apart from `session` so a server payload
  // can't overwrite what the user is typing.
  const [activityDraft, setActivityDraft] = useState<string | null>(null);

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

  /** Roll back to `restore`, re-read the server, and tell the user. */
  const failWith = (restore: ActiveTimerSession | null, message: string) => {
    setSession(restore);
    setError(message);
    router.refresh();
  };

  /** Run one timer action inside a transition without ever letting a
   *  rejection escape into an error boundary. */
  const run = (
    action: () => Promise<{ ok: boolean; error?: string; code?: string }>,
    restore: ActiveTimerSession | null,
  ) => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await action();
        if (!res.ok) {
          if (res.code === "already_running") {
            // Stale idle pill: a clock is already running elsewhere.
            // Drop the optimistic copy and adopt the real one.
            setSession(restore);
            router.refresh();
            return;
          }
          failWith(restore, res.error ?? "The timer couldn't be updated.");
        }
      } catch (err) {
        console.warn("[timer-widget] action failed", err);
        failWith(restore, TIMER_NETWORK_ERROR);
      }
    });
  };

  const onStart = () => {
    // Optimistic: show the running pill immediately.
    setSession({
      id: OPTIMISTIC_SESSION_ID,
      matterId: null,
      matterName: null,
      activity: null,
      startedAt: new Date().toISOString(),
    });
    run(() => startTimer(), serverSession);
  };

  const onDiscard = () => {
    const previous = session;
    setSession(null);
    setActivityDraft(null);
    setPanelOpen(false);
    setDiscardArmed(false);
    run(() => discardTimer(), previous);
  };

  const errorBanner = error ? (
    <div
      role="alert"
      className="max-w-64 rounded-md bg-danger-soft px-2.5 py-1.5 text-2xs text-danger shadow-md"
    >
      {error}
    </div>
  ) : null;

  // ── Idle ──────────────────────────────────────────────────────────
  if (!session) {
    return (
      <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2">
        {errorBanner}
        <button
          type="button"
          onClick={onStart}
          disabled={isPending}
          className={cn(
            "flex items-center justify-center w-9 h-9 rounded-full text-ink-3",
            "bg-white border border-line shadow-md",
            "hover:text-ink hover:border-input transition-colors",
            "disabled:opacity-60",
          )}
          title="Start a timer"
          aria-label="Start a timer"
        >
          <Play size={14} aria-hidden />
        </button>
      </div>
    );
  }

  // ── Running ───────────────────────────────────────────────────────
  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2">
      {errorBanner}
      {panelOpen && (
        <div className="w-64 p-3 rounded-lg bg-white border border-line shadow-lg flex flex-col gap-2">
          <div className="text-xs font-medium text-ink-2">Timer details</div>
          <NativeSelect
            value={session.matterId ?? ""}
            onChange={(e) => {
              const matterId = e.target.value || null;
              const matterName = matterOptions.find((m) => m.id === matterId)?.name ?? null;
              const previous = session;
              setSession({ ...session, matterId, matterName });
              run(() => updateTimer({ matterId }), previous);
            }}
            aria-label="Timer matter"
            className="w-full"
          >
            <NativeSelectOption value="">No matter yet</NativeSelectOption>
            {matterOptions.map((m) => (
              <NativeSelectOption key={m.id} value={m.id}>
                {m.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <input
            type="text"
            value={activityDraft ?? session.activity ?? ""}
            onChange={(e) =>
              // Local echo while typing; persisted on blur so we
              // don't fire a server action per keystroke.
              setActivityDraft(e.target.value)
            }
            onBlur={(e) => {
              const activity = e.target.value.trim() || null;
              const previous = session;
              setSession({ ...session, activity });
              setActivityDraft(null);
              run(() => updateTimer({ activity }), previous);
            }}
            placeholder="What are you working on?"
            aria-label="Timer activity"
            className={cn(inputClass(false, "md"), "px-2.5 border-input placeholder:text-ink-5")}
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
          <span className="w-2 h-2 rounded-full bg-danger motion-safe:animate-pulse" />
          <ElapsedClock startedAt={session.startedAt} />
          {session.matterName && (
            <span className="text-2xs text-white/70 max-w-36 truncate">{session.matterName}</span>
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            // Timer-elapsed prefill, rounded UP to the billing
            // increment at this instant (see stopHours above).
            setStopHours(
              roundElapsedToBillingIncrement(Date.now() - Date.parse(session.startedAt)),
            );
            setStopOpen(true);
          }}
          // The optimistic placeholder has no real session id yet —
          // stopTimer consumes a specific session id, so wait for the
          // server copy. Users without time_entries.create can only
          // discard (ADR-013), so don't offer a dead-end composer.
          disabled={session.id === OPTIMISTIC_SESSION_ID || !canLogTime}
          className="flex items-center justify-center w-6 h-6 rounded-full bg-white/15 hover:bg-white/25 transition-colors ml-1 disabled:opacity-50"
          title={canLogTime ? "Stop timer and log time" : "You do not have permission to log time"}
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
              ? "px-2 bg-danger text-white text-2xs font-medium"
              : "w-6 text-white/60 hover:text-white hover:bg-white/15",
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
        sessionId={session.id}
        initialMatterId={session.matterId}
        initialActivity={session.activity}
        initialHours={stopHours}
      />
    </div>
  );
}
