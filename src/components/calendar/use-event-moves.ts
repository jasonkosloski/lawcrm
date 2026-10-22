/**
 * `useEventMoves` — optimistic move dispatch shared by WeekView
 * and DayView.
 *
 * Owns the move pipeline in one place so every calendar surface
 * that hosts draggable chips behaves identically: drop / resize
 * fires the server action in a transition AND immediately updates
 * a local overlay so the chip jumps to its new spot with zero
 * perceived latency. When the server confirms (the action
 * revalidates /calendar, the `items` prop changes), pending entries
 * the server agrees with are cleared so the chip stays put with no
 * flash. Failure — a rejected result or a thrown error — rolls back
 * the overlay and surfaces an error.
 *
 * The pure overlay state machine (`applyPending` /
 * `reconcilePending`) lives in `optimistic-moves.ts` with its own
 * tests; this hook is only the React wiring around it.
 */

"use client";

import { useRef, useState, useTransition } from "react";
import { unstable_rethrow } from "next/navigation";
import { moveCalendarEvent } from "@/app/actions/calendar-events";
import { notifyError } from "@/lib/feedback";
import type { CalendarItem } from "@/lib/queries/calendar";
import { applyPending, reconcilePending, type PendingMove } from "./optimistic-moves";

/** Posted by the day cells when a chip lands somewhere new — drop
 *  on a time slot, drop on the all-day row, or chip-edge resize.
 *  The shape mirrors the move action's input minus the eventId
 *  (carried alongside). */
export type MoveEventFn = (
  eventId: string,
  schedule: { isAllDay: boolean; start: Date; end: Date },
) => void;

export function useEventMoves(
  items: CalendarItem[],
  /** Per-event edit gate (the same `canEditEvent` resolver the action
   *  enforces). Omitted = every event is movable. A move for an event
   *  the viewer can't edit is refused here instead of round-tripping
   *  to a server rejection. */
  canMove?: (eventId: string) => boolean,
): {
  /** Server items with the optimistic overlay applied — feed this
   *  to the bucketing, not the raw `items` prop, so a moved chip
   *  lands in its new column / time slot immediately. */
  renderItems: CalendarItem[];
  moveEvent: MoveEventFn;
} {
  const [, startTransition] = useTransition();
  const [pending, setPending] = useState<Map<string, PendingMove>>(() => new Map());

  // When fresh server data arrives, drop any pending entries the
  // server now agrees with. Entries that DON'T match stay until
  // the next move or rollback — that keeps the chip in its
  // optimistic position even if a separate revalidate fires (e.g.
  // an unrelated mutation triggered a `/calendar` revalidate).
  // Derived during render (remember the previous `items`, adjust
  // when it changes) rather than in an effect, so the reconciled
  // overlay never paints a frame behind the new data.
  const [seenItems, setSeenItems] = useState(items);
  if (items !== seenItems) {
    setSeenItems(items);
    setPending((prev) => reconcilePending(items, prev));
  }

  // Identity of the latest move per event. A rollback only removes
  // the overlay entry if it is still the one THIS call created — a
  // failed earlier drag must not yank a newer pending move.
  const latestMove = useRef(new Map<string, PendingMove>());

  const moveEvent: MoveEventFn = (eventId, schedule) => {
    if (canMove && !canMove(eventId)) {
      notifyError("You don't have permission to move this event.");
      return;
    }
    const mine: PendingMove = {
      isAllDay: schedule.isAllDay,
      startTime: schedule.start,
      endTime: schedule.end,
    };
    latestMove.current.set(eventId, mine);
    // Apply optimistic overlay synchronously so the chip jumps now.
    setPending((prev) => {
      const next = new Map(prev);
      next.set(eventId, mine);
      return next;
    });

    const rollback = (message: string) => {
      if (latestMove.current.get(eventId) === mine) {
        latestMove.current.delete(eventId);
        // Snap the chip back to its real server-saved position.
        setPending((prev) => {
          if (prev.get(eventId) !== mine) return prev;
          const next = new Map(prev);
          next.delete(eventId);
          return next;
        });
      }
      notifyError(message);
    };

    startTransition(async () => {
      try {
        const res = await moveCalendarEvent(eventId, {
          isAllDay: schedule.isAllDay,
          startTime: schedule.start.toISOString(),
          endTime: schedule.end.toISOString(),
        });
        if (!res.ok) rollback(res.error ?? "Couldn't move event.");
        // On success there is nothing to refresh by hand:
        // moveCalendarEvent revalidates /calendar, and a revalidating
        // server action returns the re-rendered route in the same
        // response. The new `items` prop clears the matching pending
        // entry via the reconcile step above.
      } catch (err) {
        // Let Next's own control-flow errors (a redirect to /login on
        // an expired session) through; anything else is a transient
        // failure — roll back and tell the user rather than bubbling
        // to the dashboard error boundary.
        unstable_rethrow(err);
        console.error("moveCalendarEvent failed", err);
        rollback("Couldn't move event. Please try again.");
      }
    });
  };

  return { renderItems: applyPending(items, pending), moveEvent };
}
