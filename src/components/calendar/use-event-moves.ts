/**
 * `useEventMoves` — optimistic move dispatch shared by WeekView
 * and DayView.
 *
 * Owns the move pipeline in one place so every calendar surface
 * that hosts draggable chips behaves identically: drop / resize
 * fires the server action in a transition AND immediately updates
 * a local overlay so the chip jumps to its new spot with zero
 * perceived latency. When the server confirms (router revalidates,
 * the `items` prop changes), pending entries the server agrees
 * with are cleared so the chip stays put with no flash. Failure
 * rolls back the overlay and surfaces an error.
 *
 * The pure overlay state machine (`applyPending` /
 * `reconcilePending`) lives in `optimistic-moves.ts` with its own
 * tests; this hook is only the React wiring around it.
 */

"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moveCalendarEvent } from "@/app/actions/calendar-events";
import type { CalendarItem } from "@/lib/queries/calendar";
import {
  applyPending,
  reconcilePending,
  type PendingMove,
} from "./optimistic-moves";

/** Posted by the day cells when a chip lands somewhere new — drop
 *  on a time slot, drop on the all-day row, or chip-edge resize.
 *  The shape mirrors the move action's input minus the eventId
 *  (carried alongside). */
export type MoveEventFn = (
  eventId: string,
  schedule: { isAllDay: boolean; start: Date; end: Date }
) => void;

export function useEventMoves(items: CalendarItem[]): {
  /** Server items with the optimistic overlay applied — feed this
   *  to the bucketing, not the raw `items` prop, so a moved chip
   *  lands in its new column / time slot immediately. */
  renderItems: CalendarItem[];
  moveEvent: MoveEventFn;
} {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [pending, setPending] = useState<Map<string, PendingMove>>(
    () => new Map()
  );

  // When fresh server data arrives, drop any pending entries the
  // server now agrees with. Entries that DON'T match stay until
  // the next move or rollback — that keeps the chip in its
  // optimistic position even if a separate revalidate fires (e.g.
  // an unrelated mutation triggered a `/calendar` revalidate).
  useEffect(() => {
    setPending((prev) => reconcilePending(items, prev));
  }, [items]);

  const moveEvent: MoveEventFn = (eventId, schedule) => {
    // Apply optimistic overlay synchronously so the chip jumps now.
    setPending((prev) => {
      const next = new Map(prev);
      next.set(eventId, {
        isAllDay: schedule.isAllDay,
        startTime: schedule.start,
        endTime: schedule.end,
      });
      return next;
    });
    startTransition(async () => {
      const res = await moveCalendarEvent(eventId, {
        isAllDay: schedule.isAllDay,
        startTime: schedule.start.toISOString(),
        endTime: schedule.end.toISOString(),
      });
      if (!res.ok) {
        // Roll back the overlay so the chip snaps to its real
        // server-saved position, then surface the error.
        setPending((prev) => {
          const next = new Map(prev);
          next.delete(eventId);
          return next;
        });
        // eslint-disable-next-line no-alert
        alert(res.error ?? "Couldn't move event.");
        return;
      }
      // Refresh pulls the server's saved state into the items prop;
      // the effect above clears matching pending entries on
      // arrival, leaving the chip in place.
      router.refresh();
    });
  };

  return { renderItems: applyPending(items, pending), moveEvent };
}
