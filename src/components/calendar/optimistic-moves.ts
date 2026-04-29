/**
 * Pure helpers for the calendar's optimistic move overlay.
 *
 * Lives outside week-view.tsx so the test can import without
 * pulling in the React tree. The state machine is small but
 * load-bearing: get it wrong and chips snap back, double-render,
 * or stick on a position the server rejected.
 */

import type { CalendarItem } from "@/lib/queries/calendar";

/** A pending move waiting for server confirmation. */
export type PendingMove = {
  isAllDay: boolean;
  startTime: Date;
  endTime: Date;
};

/** Apply a map of pending moves over a server-rendered items
 *  array. Pending entries replace the schedule fields of the
 *  matching event (matched by `id`); non-event items pass
 *  through. Empty pending map is a no-op (returns the input
 *  reference unchanged). */
export function applyPending(
  items: CalendarItem[],
  pending: Map<string, PendingMove>
): CalendarItem[] {
  if (pending.size === 0) return items;
  return items.map((item) => {
    if (item.kind !== "event") return item;
    const move = pending.get(item.id);
    if (!move) return item;
    return {
      ...item,
      isAllDay: move.isAllDay,
      startTime: move.startTime,
      endTime: move.endTime,
    };
  });
}

/** Given an items array (the latest server data) and the current
 *  pending overlay, return a NEW pending overlay with entries
 *  removed for any event whose server-saved schedule already
 *  matches the optimistic target. Used in WeekView's effect that
 *  reconciles pending state when fresh server data arrives. */
export function reconcilePending(
  items: CalendarItem[],
  pending: Map<string, PendingMove>
): Map<string, PendingMove> {
  if (pending.size === 0) return pending;
  const next = new Map(pending);
  let changed = false;
  for (const [id, move] of pending) {
    const serverItem = items.find(
      (i) => i.kind === "event" && i.id === id
    );
    if (!serverItem || serverItem.kind !== "event") continue;
    const matches =
      serverItem.startTime.getTime() === move.startTime.getTime() &&
      serverItem.endTime.getTime() === move.endTime.getTime() &&
      serverItem.isAllDay === move.isAllDay;
    if (matches) {
      next.delete(id);
      changed = true;
    }
  }
  return changed ? next : pending;
}
