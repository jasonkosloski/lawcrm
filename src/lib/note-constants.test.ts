/**
 * Tests for note-constants — shape invariants on the note enums
 * + behavior tests for the capture-factory helpers.
 */

import { describe, expect, test, vi } from "vitest";
import {
  allowedCaptureKinds,
  CAPTURE_KIND_LABEL,
  DEADLINE_KINDS,
  DEADLINE_STATUSES,
  EVENT_TYPES,
  NOTE_TYPES,
  NOTE_TYPE_LABEL,
  newCapture,
  NO_NOTE_ACCESS,
  noteInitialState,
  REACTION_EMOJIS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TIME_ENTRY_STATUSES,
  type CaptureKind,
} from "./note-constants";

describe("note constant catalogs", () => {
  test("NOTE_TYPES + label coverage", () => {
    for (const t of NOTE_TYPES) {
      expect(NOTE_TYPE_LABEL[t]).toBeTruthy();
    }
    expect(NOTE_TYPES).toContain("note");
    expect(NOTE_TYPES).toContain("strategy");
  });

  test("REACTION_EMOJIS is a small curated set", () => {
    // Keep the picker focused — assert the size stays reasonable.
    expect(REACTION_EMOJIS.length).toBeGreaterThan(0);
    expect(REACTION_EMOJIS.length).toBeLessThan(15);
    // Sanity — every entry is at least one printable code point.
    for (const e of REACTION_EMOJIS) {
      expect(e.length).toBeGreaterThan(0);
    }
  });

  test("status / kind enums include the canonical values", () => {
    expect(TASK_STATUSES).toContain("open");
    expect(TASK_STATUSES).toContain("done");
    expect(TASK_PRIORITIES).toContain("urgent");
    expect(DEADLINE_STATUSES).toContain("open");
    expect(DEADLINE_STATUSES).toContain("completed");
    expect(DEADLINE_KINDS).toContain("critical");
    expect(TIME_ENTRY_STATUSES).toContain("billable");
    expect(EVENT_TYPES).toContain("hearing");
  });

  test("CAPTURE_KIND_LABEL covers every capture kind", () => {
    const kinds: CaptureKind[] = ["task", "event", "deadline", "time", "note_sibling"];
    for (const k of kinds) {
      expect(CAPTURE_KIND_LABEL[k]).toBeTruthy();
    }
  });

  test("noteInitialState starts idle with no errors", () => {
    expect(noteInitialState).toEqual({ status: "idle" });
  });
});

describe("allowedCaptureKinds", () => {
  test("narrows to the kinds the viewer may create", () => {
    expect(
      allowedCaptureKinds({ ...NO_NOTE_ACCESS, canCreateTask: true, canCreateTime: true }, [
        "task",
        "event",
        "deadline",
        "time",
      ]),
    ).toEqual(["task", "time"]);
  });

  test("fail-closed default offers nothing", () => {
    expect(allowedCaptureKinds(NO_NOTE_ACCESS, ["task", "event", "deadline", "time"])).toEqual([]);
  });
});

describe("newCapture factory", () => {
  test("task capture has the canonical defaults", () => {
    const out = newCapture("task", "tmp1");
    expect(out.kind).toBe("task");
    expect(out.tempId).toBe("tmp1");
    if (out.kind === "task") {
      expect(out.title).toBe("");
      expect(out.priority).toBe("normal");
      expect(out.dueDate).toBe("");
    }
  });

  test("event capture seeds startTime + endTime an hour apart, in the viewer's zone", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T20:23:17Z"));
    try {
      const out = newCapture("event", "tmp2", "America/Denver");
      if (out.kind !== "event") throw new Error("wrong shape");
      expect(out.startTime).toBe("2026-04-15T15:00");
      expect(out.endTime).toBe("2026-04-15T16:00");
      expect(out.type).toBe("meeting");
    } finally {
      vi.useRealTimers();
    }
    const out = newCapture("event", "tmp2");
    if (out.kind !== "event") throw new Error("wrong shape");
    expect(out.location).toBe("");
    expect(out.title).toBe("");
  });

  test("deadline capture defaults kind_ to manual", () => {
    const out = newCapture("deadline", "tmp3");
    if (out.kind !== "deadline") throw new Error("wrong shape");
    expect(out.kind_).toBe("manual");
    expect(out.title).toBe("");
    expect(out.description).toBe("");
  });

  test("time capture seeds today's date (viewer's zone) + empty hours/activity", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-28T02:00:00Z"));
    try {
      const denver = newCapture("time", "tmp4", "America/Denver");
      if (denver.kind !== "time") throw new Error("wrong shape");
      expect(denver.date).toBe("2026-04-27");
    } finally {
      vi.useRealTimers();
    }
    const out = newCapture("time", "tmp4");
    if (out.kind !== "time") throw new Error("wrong shape");
    expect(out.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(out.hours).toBe("");
    expect(out.activity).toBe("");
    expect(out.narrative).toBe("");
  });

  test("note_sibling capture defaults to type=note + unpinned", () => {
    const out = newCapture("note_sibling", "tmp5");
    if (out.kind !== "note_sibling") throw new Error("wrong shape");
    expect(out.type).toBe("note");
    expect(out.isPinned).toBe(false);
    expect(out.content).toBe("");
  });
});
