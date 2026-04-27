/**
 * Tests for note-constants — shape invariants on the note enums
 * + behavior tests for the capture-factory helpers.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  CAPTURE_KIND_LABEL,
  DEADLINE_KINDS,
  DEADLINE_STATUSES,
  EVENT_TYPES,
  NOTE_TYPES,
  NOTE_TYPE_LABEL,
  newCapture,
  nextHourDateTimeString,
  noteInitialState,
  REACTION_EMOJIS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TIME_ENTRY_STATUSES,
  todayDateString,
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
    const kinds: CaptureKind[] = [
      "task",
      "event",
      "deadline",
      "time",
      "note_sibling",
    ];
    for (const k of kinds) {
      expect(CAPTURE_KIND_LABEL[k]).toBeTruthy();
    }
  });

  test("noteInitialState starts idle with no errors", () => {
    expect(noteInitialState).toEqual({ status: "idle" });
  });
});

describe("todayDateString", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("returns YYYY-MM-DD in local time", () => {
    // Pin to noon UTC on a non-DST date to avoid TZ flakiness.
    vi.setSystemTime(new Date("2026-04-15T12:00:00Z"));
    const out = todayDateString();
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The exact day depends on the local TZ — the test's
    // assertion is just "shape + parses cleanly."
    expect(new Date(out).toISOString().slice(0, 10)).toBe(out);
  });
});

describe("nextHourDateTimeString", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("rounds up to the next hour boundary, format YYYY-MM-DDTHH:mm", () => {
    // Pin to 14:23 local. Should round to 15:00.
    const fixed = new Date();
    fixed.setHours(14, 23, 17, 0);
    vi.setSystemTime(fixed);
    const out = nextHourDateTimeString();
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00$/);
    // Hour part is 15 (or 16 if local TZ shifted).
    const hour = parseInt(out.slice(11, 13), 10);
    expect([15, 16]).toContain(hour);
  });

  test("addHours offsets from the next hour boundary", () => {
    const fixed = new Date();
    fixed.setHours(10, 0, 0, 0);
    vi.setSystemTime(fixed);
    const base = nextHourDateTimeString(0);
    const plusOne = nextHourDateTimeString(1);
    const baseHr = parseInt(base.slice(11, 13), 10);
    const plusHr = parseInt(plusOne.slice(11, 13), 10);
    expect(plusHr).toBe(baseHr + 1);
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

  test("event capture seeds startTime + endTime an hour apart", () => {
    const out = newCapture("event", "tmp2");
    if (out.kind !== "event") throw new Error("wrong shape");
    // Start hour < end hour by 1 (or wraps midnight — accept that).
    const startHr = parseInt(out.startTime.slice(11, 13), 10);
    const endHr = parseInt(out.endTime.slice(11, 13), 10);
    const diff = endHr - startHr;
    expect([1, -23]).toContain(diff); // -23 covers a midnight wrap
    expect(out.type).toBe("meeting");
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

  test("time capture seeds today's date + empty hours/activity", () => {
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
