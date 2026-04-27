/**
 * Tests for the active-drag registry.
 *
 * The registry exists so `dragover` handlers can inspect the
 * dragged payload — the native API hides dataTransfer JSON until
 * `drop` for security. The registry is module-global state, so
 * each test resets it via `clearActiveDrag` to keep them
 * independent.
 */

import { afterEach, describe, expect, test } from "vitest";
import {
  clearActiveDrag,
  peekActiveDrag,
  setActiveDrag,
} from "./active-drag";

afterEach(() => {
  clearActiveDrag();
});

describe("active-drag registry", () => {
  test("peek returns null when no drag is active", () => {
    expect(peekActiveDrag("calendar-event")).toBeNull();
  });

  test("set + peek round-trips the data", () => {
    setActiveDrag("calendar-event", { id: "abc", isAllDay: false });
    expect(peekActiveDrag("calendar-event")).toEqual({
      id: "abc",
      isAllDay: false,
    });
  });

  test("peek returns null when the kind doesn't match", () => {
    setActiveDrag("calendar-event", { id: "abc" });
    expect(peekActiveDrag("kanban-card")).toBeNull();
  });

  test("clear wipes the active drag", () => {
    setActiveDrag("calendar-event", { id: "abc" });
    clearActiveDrag();
    expect(peekActiveDrag("calendar-event")).toBeNull();
  });

  test("set overwrites a prior active drag", () => {
    setActiveDrag("calendar-event", { id: "first" });
    setActiveDrag("calendar-event", { id: "second" });
    expect(peekActiveDrag<{ id: string }>("calendar-event")?.id).toBe(
      "second"
    );
  });
});
