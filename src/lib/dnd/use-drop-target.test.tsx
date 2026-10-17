/**
 * useDropTarget: disabled gating, kind filtering, nested
 * enter/leave counting, and reset on drop. Events are plain objects
 * shaped like the bits of DragEvent/DataTransfer the hook touches.
 *
 * `protectedMode` models what real browsers do mid-drag: `types`
 * lists the MIMEs but getData returns "" until the drop.
 */

import { describe, expect, test, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { DragEvent } from "react";
import { useDropTarget } from "./use-drop-target";

const KIND_MIME = "application/x-lawcrm-dnd-kind";

function makeEvent(opts: { kind?: string; data?: unknown; protectedMode?: boolean }) {
  const store = new Map<string, string>();
  if (opts.kind) store.set(KIND_MIME, opts.kind);
  if (opts.data !== undefined) store.set("application/json", JSON.stringify(opts.data));
  const e = {
    preventDefault: vi.fn(),
    dataTransfer: {
      get types() {
        return Array.from(store.keys());
      },
      getData: (m: string) => (opts.protectedMode ? "" : store.get(m) ?? ""),
      dropEffect: "",
    },
  };
  return e as unknown as DragEvent & { preventDefault: ReturnType<typeof vi.fn> };
}

describe("useDropTarget", () => {
  test("a matching drag in protected mode (Chromium dragover) is accepted: preventDefault + move", () => {
    const { result } = renderHook(() =>
      useDropTarget({ kind: "calendar-event", onDrop: vi.fn() })
    );
    const e = makeEvent({ kind: "calendar-event", protectedMode: true });
    act(() => result.current.handlers.onDragOver(e));
    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.dataTransfer.dropEffect).toBe("move");
  });

  test("a different kind or no kind is not accepted", () => {
    const { result } = renderHook(() =>
      useDropTarget({ kind: "calendar-event", onDrop: vi.fn() })
    );
    const wrong = makeEvent({ kind: "kanban-card" });
    const none = makeEvent({});
    act(() => {
      result.current.handlers.onDragOver(wrong);
      result.current.handlers.onDragEnter(wrong);
      result.current.handlers.onDragOver(none);
      result.current.handlers.onDragEnter(none);
    });
    expect(wrong.preventDefault).not.toHaveBeenCalled();
    expect(none.preventDefault).not.toHaveBeenCalled();
    expect(result.current.isOver).toBe(false);
  });

  test("disabled targets never accept, highlight, or fire onDrop", () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() =>
      useDropTarget({ kind: "calendar-event", onDrop, disabled: true })
    );
    const over = makeEvent({ kind: "calendar-event", protectedMode: true });
    act(() => {
      result.current.handlers.onDragOver(over);
      result.current.handlers.onDragEnter(over);
    });
    expect(over.preventDefault).not.toHaveBeenCalled();
    expect(result.current.isOver).toBe(false);
    const drop = makeEvent({ kind: "calendar-event", data: { id: "x" } });
    act(() => result.current.handlers.onDrop(drop));
    expect(onDrop).not.toHaveBeenCalled();
    expect(drop.preventDefault).not.toHaveBeenCalled();
  });

  test("nested enter/leave is counted: highlight stays until the last leave", () => {
    const { result } = renderHook(() =>
      useDropTarget({ kind: "calendar-event", onDrop: vi.fn() })
    );
    const e = makeEvent({ kind: "calendar-event", protectedMode: true });
    act(() => result.current.handlers.onDragEnter(e)); // target
    act(() => result.current.handlers.onDragEnter(e)); // child
    expect(result.current.isOver).toBe(true);
    act(() => result.current.handlers.onDragLeave(e)); // leave target for child
    expect(result.current.isOver).toBe(true);
    act(() => result.current.handlers.onDragLeave(e));
    expect(result.current.isOver).toBe(false);
    // Extra leave never goes negative.
    act(() => result.current.handlers.onDragLeave(e));
    act(() => result.current.handlers.onDragEnter(e));
    expect(result.current.isOver).toBe(true);
  });

  test("drop fires onDrop with the parsed payload and clears the highlight", () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() =>
      useDropTarget<{ id: string }>({ kind: "calendar-event", onDrop })
    );
    const enter = makeEvent({ kind: "calendar-event", protectedMode: true });
    act(() => {
      result.current.handlers.onDragEnter(enter);
      result.current.handlers.onDragEnter(enter);
    });
    expect(result.current.isOver).toBe(true);
    const drop = makeEvent({ kind: "calendar-event", data: { id: "evt1" } });
    act(() => result.current.handlers.onDrop(drop));
    expect(onDrop).toHaveBeenCalledWith({ id: "evt1" }, drop);
    expect(drop.preventDefault).toHaveBeenCalled();
    expect(result.current.isOver).toBe(false);
  });

  test("a drop of the wrong kind resets the highlight but does not fire onDrop", () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() =>
      useDropTarget({ kind: "calendar-event", onDrop })
    );
    act(() =>
      result.current.handlers.onDragEnter(
        makeEvent({ kind: "calendar-event", protectedMode: true })
      )
    );
    act(() =>
      result.current.handlers.onDrop(
        makeEvent({ kind: "kanban-card", data: { id: "x" } })
      )
    );
    expect(onDrop).not.toHaveBeenCalled();
    expect(result.current.isOver).toBe(false);
  });
});
