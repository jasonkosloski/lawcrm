/**
 * Tests for the DnD payload encode/decode helpers.
 *
 * Native HTML5 DragEvents aren't directly constructible in
 * happy-dom, but the helpers only need a `dataTransfer`-shaped
 * object — a minimal stand-in works fine and keeps the contract
 * focused on the read/write semantics.
 */

import { describe, expect, test } from "vitest";
import { hasKind, readPayload, setDragPayload } from "./payload";

/** Minimal DataTransfer-like shape that mirrors what setDragPayload
 *  / readPayload actually call. We only model `setData`,
 *  `getData`, `types`, and `effectAllowed` because those are the
 *  members under test. */
function makeFakeEvent() {
  const store = new Map<string, string>();
  const dt = {
    setData: (mime: string, value: string) => {
      store.set(mime.toLowerCase(), value);
    },
    getData: (mime: string) => store.get(mime.toLowerCase()) ?? "",
    get types() {
      return Array.from(store.keys());
    },
    effectAllowed: "" as string,
    dropEffect: "" as string,
  };
  // Cast through unknown — the helpers only call the members
  // above, never the rest of DataTransfer's surface.
  return { dataTransfer: dt } as unknown as React.DragEvent;
}

describe("setDragPayload", () => {
  test("writes the kind + JSON-encoded data + effectAllowed=move", () => {
    const e = makeFakeEvent();
    setDragPayload(e, {
      kind: "calendar-event",
      data: { id: "abc", isAllDay: false },
    });
    expect(e.dataTransfer.getData("application/x-lawcrm-dnd-kind")).toBe(
      "calendar-event"
    );
    expect(JSON.parse(e.dataTransfer.getData("application/json"))).toEqual({
      id: "abc",
      isAllDay: false,
    });
    expect(e.dataTransfer.effectAllowed).toBe("move");
  });
});

describe("readPayload", () => {
  test("returns the typed payload when the kind matches", () => {
    const e = makeFakeEvent();
    setDragPayload(e, {
      kind: "calendar-event",
      data: { id: "x" },
    });
    const out = readPayload<{ id: string }>(e, "calendar-event");
    expect(out).toEqual({ id: "x" });
  });

  test("returns null for the wrong kind", () => {
    const e = makeFakeEvent();
    setDragPayload(e, {
      kind: "calendar-event",
      data: { id: "x" },
    });
    const out = readPayload(e, "kanban-card");
    expect(out).toBeNull();
  });

  test("returns null for an event with no payload", () => {
    const e = makeFakeEvent();
    expect(readPayload(e, "calendar-event")).toBeNull();
  });

  test("returns null when the JSON is malformed", () => {
    const e = makeFakeEvent();
    e.dataTransfer.setData("application/x-lawcrm-dnd-kind", "calendar-event");
    e.dataTransfer.setData("application/json", "not-json");
    expect(readPayload(e, "calendar-event")).toBeNull();
  });
});

describe("hasKind", () => {
  test("matches when our kind MIME is present + value matches", () => {
    const e = makeFakeEvent();
    setDragPayload(e, {
      kind: "calendar-event",
      data: { id: "x" },
    });
    expect(hasKind(e, "calendar-event")).toBe(true);
  });

  test("rejects an unrelated drag (no kind MIME at all)", () => {
    const e = makeFakeEvent();
    e.dataTransfer.setData("text/plain", "hello");
    expect(hasKind(e, "calendar-event")).toBe(false);
  });

  test("rejects a different kind", () => {
    const e = makeFakeEvent();
    setDragPayload(e, {
      kind: "kanban-card",
      data: { id: "x" },
    });
    expect(hasKind(e, "calendar-event")).toBe(false);
  });
});
