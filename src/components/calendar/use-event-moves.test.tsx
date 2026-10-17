/**
 * useEventMoves — the optimistic drag/resize pipeline.
 *
 * Pins the failure handling: a rejected result AND a thrown action
 * both roll the chip back and alert instead of escaping to the error
 * boundary; a failed EARLIER move must not yank a newer pending move
 * for the same event; a move the viewer can't edit never reaches the
 * server; and a success needs no manual router.refresh() (the action
 * revalidates /calendar itself).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { CalendarEventRow, CalendarItem } from "@/lib/queries/calendar";

const { moveCalendarEvent, unstable_rethrow } = vi.hoisted(() => ({
  moveCalendarEvent: vi.fn(),
  unstable_rethrow: vi.fn(),
}));

vi.mock("@/app/actions/calendar-events", () => ({ moveCalendarEvent }));
// No useRouter: the hook must not need the router any more.
vi.mock("next/navigation", () => ({ unstable_rethrow }));

import { useEventMoves } from "./use-event-moves";

const SERVER_START = new Date("2026-04-28T15:00:00.000Z");
const SERVER_END = new Date("2026-04-28T16:00:00.000Z");

const event = (over: Partial<CalendarEventRow> = {}): CalendarEventRow => ({
  id: "evt-1",
  kind: "event",
  title: "Strategy session",
  type: "meeting",
  startTime: SERVER_START,
  endTime: SERVER_END,
  isAllDay: false,
  location: null,
  color: "var(--color-ink-3)",
  matterId: null,
  matterName: null,
  attendeeCount: 0,
  attendeeNames: [],
  viewerCanSeeDetails: true,
  ...over,
});

const startOf = (items: CalendarItem[], id = "evt-1") => {
  const found = items.find((i) => i.id === id);
  if (!found || found.kind !== "event") throw new Error("no event");
  return found.startTime.toISOString();
};

const move = (hour: number) => ({
  isAllDay: false,
  start: new Date(`2026-04-29T${String(hour).padStart(2, "0")}:00:00.000Z`),
  end: new Date(`2026-04-29T${String(hour + 1).padStart(2, "0")}:00:00.000Z`),
});

/** Let the transition's async callback settle. */
const flush = () => act(async () => {});

let alertSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  alertSpy = vi.fn();
  vi.stubGlobal("alert", alertSpy);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  moveCalendarEvent.mockReset();
  unstable_rethrow.mockReset();
});

describe("useEventMoves", () => {
  test("a move shows optimistically and survives until the server catches up", async () => {
    moveCalendarEvent.mockResolvedValue({ ok: true });
    const items = [event()];
    const { result, rerender } = renderHook(
      ({ items }) => useEventMoves(items),
      { initialProps: { items } }
    );

    act(() => result.current.moveEvent("evt-1", move(10)));
    await flush();

    expect(moveCalendarEvent).toHaveBeenCalledWith("evt-1", {
      isAllDay: false,
      startTime: "2026-04-29T10:00:00.000Z",
      endTime: "2026-04-29T11:00:00.000Z",
    });
    expect(startOf(result.current.renderItems)).toBe("2026-04-29T10:00:00.000Z");

    // The action's revalidation delivers fresh items that agree: the
    // overlay is dropped and the chip stays put.
    const fresh = [
      event({
        startTime: new Date("2026-04-29T10:00:00.000Z"),
        endTime: new Date("2026-04-29T11:00:00.000Z"),
      }),
    ];
    rerender({ items: fresh });
    expect(result.current.renderItems).toBe(fresh);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  test("a rejected result rolls the chip back and alerts the server's message", async () => {
    moveCalendarEvent.mockResolvedValue({ ok: false, error: "Nope." });
    const items = [event()];
    const { result } = renderHook(() => useEventMoves(items));

    act(() => result.current.moveEvent("evt-1", move(10)));
    await flush();

    expect(startOf(result.current.renderItems)).toBe(SERVER_START.toISOString());
    expect(alertSpy).toHaveBeenCalledWith("Nope.");
  });

  test("a THROWN action rolls back and alerts instead of escaping", async () => {
    const boom = new Error("network down");
    moveCalendarEvent.mockRejectedValue(boom);
    const items = [event()];
    const { result } = renderHook(() => useEventMoves(items));

    act(() => result.current.moveEvent("evt-1", move(10)));
    await flush();

    expect(unstable_rethrow).toHaveBeenCalledWith(boom);
    expect(startOf(result.current.renderItems)).toBe(SERVER_START.toISOString());
    expect(alertSpy).toHaveBeenCalledWith(
      "Couldn't move event. Please try again."
    );
  });

  test("a failed EARLIER move does not remove a newer pending move", async () => {
    let failFirst!: (v: { ok: boolean; error?: string }) => void;
    moveCalendarEvent
      .mockImplementationOnce(
        () => new Promise((resolve) => (failFirst = resolve))
      )
      .mockImplementationOnce(() => new Promise(() => {})); // never settles
    const items = [event()];
    const { result } = renderHook(() => useEventMoves(items));

    act(() => result.current.moveEvent("evt-1", move(10)));
    act(() => result.current.moveEvent("evt-1", move(12)));
    expect(startOf(result.current.renderItems)).toBe("2026-04-29T12:00:00.000Z");

    // The first drag is rejected after the second was dispatched.
    await act(async () => failFirst({ ok: false, error: "First failed." }));

    // The chip must stay where the SECOND drag put it.
    expect(startOf(result.current.renderItems)).toBe("2026-04-29T12:00:00.000Z");
    expect(alertSpy).toHaveBeenCalledWith("First failed.");
  });

  test("a move the viewer can't edit never reaches the server", async () => {
    const items = [event()];
    const { result } = renderHook(() =>
      useEventMoves(items, (id) => id !== "evt-1")
    );

    act(() => result.current.moveEvent("evt-1", move(10)));
    await flush();

    expect(moveCalendarEvent).not.toHaveBeenCalled();
    expect(startOf(result.current.renderItems)).toBe(SERVER_START.toISOString());
    expect(alertSpy).toHaveBeenCalledWith(
      "You don't have permission to move this event."
    );
  });

  test("an editable event is allowed through when canMove says yes", async () => {
    moveCalendarEvent.mockResolvedValue({ ok: true });
    const items = [event()];
    const { result } = renderHook(() =>
      useEventMoves(items, (id) => id === "evt-1")
    );

    act(() => result.current.moveEvent("evt-1", move(10)));
    await flush();

    expect(moveCalendarEvent).toHaveBeenCalledTimes(1);
  });
});
