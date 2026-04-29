/**
 * Tests for the optimistic-move overlay helpers.
 *
 * `applyPending` drives the user-visible chip position the moment
 * a drop fires. `reconcilePending` runs after fresh server data
 * arrives and clears entries the server has caught up to — that's
 * what avoids the flash of the chip snapping to its old spot
 * before re-rendering in the new one.
 */

import { describe, expect, test } from "vitest";
import type { CalendarEventRow, CalendarItem } from "@/lib/queries/calendar";
import {
  applyPending,
  reconcilePending,
  type PendingMove,
} from "./optimistic-moves";

const baseEvent: CalendarEventRow = {
  id: "evt-1",
  kind: "event",
  title: "Strategy session",
  type: "meeting",
  startTime: new Date("2026-04-28T15:00:00.000Z"),
  endTime: new Date("2026-04-28T16:00:00.000Z"),
  isAllDay: false,
  location: null,
  color: "var(--color-ink-3)",
  matterId: null,
  matterName: null,
  attendeeCount: 0,
  attendeeNames: [],
  viewerCanSeeDetails: true,
};

describe("applyPending", () => {
  test("empty pending map returns the input reference (cheap no-op)", () => {
    const items: CalendarItem[] = [baseEvent];
    expect(applyPending(items, new Map())).toBe(items);
  });

  test("pending move replaces start/end/isAllDay on the matching event", () => {
    const items: CalendarItem[] = [baseEvent];
    const pending = new Map<string, PendingMove>([
      [
        "evt-1",
        {
          isAllDay: true,
          startTime: new Date("2026-04-29T00:00:00.000Z"),
          endTime: new Date("2026-04-29T00:00:00.000Z"),
        },
      ],
    ]);
    const out = applyPending(items, pending);
    expect(out).toHaveLength(1);
    const updated = out[0]!;
    if (updated.kind !== "event") throw new Error("expected event");
    expect(updated.isAllDay).toBe(true);
    expect(updated.startTime.toISOString()).toBe("2026-04-29T00:00:00.000Z");
    expect(updated.endTime.toISOString()).toBe("2026-04-29T00:00:00.000Z");
    // Non-schedule fields are preserved.
    expect(updated.title).toBe("Strategy session");
    expect(updated.id).toBe("evt-1");
  });

  test("entries for missing event ids are silently ignored", () => {
    const items: CalendarItem[] = [baseEvent];
    const pending = new Map<string, PendingMove>([
      [
        "evt-does-not-exist",
        {
          isAllDay: false,
          startTime: new Date("2026-05-01T10:00:00.000Z"),
          endTime: new Date("2026-05-01T11:00:00.000Z"),
        },
      ],
    ]);
    const out = applyPending(items, pending);
    // Original event survives unchanged; phantom pending entries
    // don't crash or insert ghost rows.
    expect(out[0]).toEqual(baseEvent);
  });

  test("non-event items pass through (deadlines aren't moveable)", () => {
    const deadline: CalendarItem = {
      id: "dl-1",
      kind: "deadline",
      title: "Discovery cutoff",
      dueDate: new Date("2026-04-30T00:00:00.000Z"),
      deadlineKind: "critical",
      status: "open",
      matterId: "m-1",
      matterName: "Smith v. Jones",
    };
    const items: CalendarItem[] = [baseEvent, deadline];
    // Pending is keyed by event id; a deadline's id has no claim
    // on any pending entry. Even if a malformed pending map keys
    // by deadline id, the type guard skips it.
    const pending = new Map<string, PendingMove>([
      [
        "dl-1",
        {
          isAllDay: false,
          startTime: new Date("2026-05-01T10:00:00.000Z"),
          endTime: new Date("2026-05-01T11:00:00.000Z"),
        },
      ],
    ]);
    const out = applyPending(items, pending);
    expect(out[1]).toEqual(deadline);
  });
});

describe("reconcilePending", () => {
  test("server-confirmed move is removed from pending", () => {
    const pending = new Map<string, PendingMove>([
      [
        "evt-1",
        {
          isAllDay: true,
          startTime: new Date("2026-04-29T00:00:00.000Z"),
          endTime: new Date("2026-04-29T00:00:00.000Z"),
        },
      ],
    ]);
    const serverItems: CalendarItem[] = [
      {
        ...baseEvent,
        isAllDay: true,
        startTime: new Date("2026-04-29T00:00:00.000Z"),
        endTime: new Date("2026-04-29T00:00:00.000Z"),
      },
    ];
    const out = reconcilePending(serverItems, pending);
    expect(out.size).toBe(0);
    // Returns a new Map (not the input reference).
    expect(out).not.toBe(pending);
  });

  test("server-disagreed move stays pending until next reconcile or rollback", () => {
    // Server saved a different start time than we optimistically
    // applied (e.g. server clamped the time). The chip should
    // stay in its optimistic spot until the user takes another
    // action — flickering between two wrong positions is worse
    // than holding one consistent one.
    const pending = new Map<string, PendingMove>([
      [
        "evt-1",
        {
          isAllDay: false,
          startTime: new Date("2026-04-28T15:00:00.000Z"),
          endTime: new Date("2026-04-28T16:00:00.000Z"),
        },
      ],
    ]);
    const serverItems: CalendarItem[] = [
      {
        ...baseEvent,
        // Server ended up with a different time
        startTime: new Date("2026-04-28T15:30:00.000Z"),
        endTime: new Date("2026-04-28T16:30:00.000Z"),
      },
    ];
    const out = reconcilePending(serverItems, pending);
    expect(out.size).toBe(1);
    expect(out.has("evt-1")).toBe(true);
  });

  test("empty pending map returns the input reference (cheap no-op)", () => {
    const pending = new Map<string, PendingMove>();
    const out = reconcilePending([baseEvent], pending);
    expect(out).toBe(pending);
  });

  test("pending entry for an event no longer in the items list stays pending", () => {
    // The view's range query may not include the event (e.g. it
    // moved outside the visible week). We don't drop those
    // entries — leaving them keeps the optimistic state visible
    // if the view scrolls back. They get cleared on the next
    // matching reconcile or explicit rollback.
    const pending = new Map<string, PendingMove>([
      [
        "evt-other",
        {
          isAllDay: false,
          startTime: new Date("2026-05-01T10:00:00.000Z"),
          endTime: new Date("2026-05-01T11:00:00.000Z"),
        },
      ],
    ]);
    const out = reconcilePending([baseEvent], pending);
    expect(out.size).toBe(1);
    expect(out).toBe(pending); // unchanged → same reference
  });

  test("multiple pending entries: confirmed ones drop, unconfirmed stay", () => {
    const pending = new Map<string, PendingMove>([
      [
        "evt-1",
        {
          isAllDay: false,
          startTime: new Date("2026-04-28T18:00:00.000Z"),
          endTime: new Date("2026-04-28T19:00:00.000Z"),
        },
      ],
      [
        "evt-2",
        {
          isAllDay: true,
          startTime: new Date("2026-04-30T00:00:00.000Z"),
          endTime: new Date("2026-04-30T00:00:00.000Z"),
        },
      ],
    ]);
    const serverItems: CalendarItem[] = [
      {
        ...baseEvent,
        id: "evt-1",
        startTime: new Date("2026-04-28T18:00:00.000Z"),
        endTime: new Date("2026-04-28T19:00:00.000Z"),
      },
      {
        ...baseEvent,
        id: "evt-2",
        // Server hasn't caught up yet for evt-2.
        startTime: new Date("2026-04-29T15:00:00.000Z"),
        endTime: new Date("2026-04-29T16:00:00.000Z"),
        isAllDay: false,
      },
    ];
    const out = reconcilePending(serverItems, pending);
    expect(out.size).toBe(1);
    expect(out.has("evt-1")).toBe(false);
    expect(out.has("evt-2")).toBe(true);
  });
});
