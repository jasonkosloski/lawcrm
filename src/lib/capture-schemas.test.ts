/**
 * Tests for the shared capture schemas.
 *
 * These zod schemas back the multi-record composer (notes + sibling
 * tasks/events/deadlines/time entries). They run on the server before
 * the action's transaction loop, so a wrong validation here means a
 * bad row reaches the DB. Worth pinning down explicitly.
 *
 * What we cover:
 *   - per-kind happy path + each required-field failure
 *   - event endTime-after-startTime cross-field check
 *   - the discriminatedUnion routes by `kind`
 *   - defaults populate when omitted
 */

import { describe, expect, test } from "vitest";
import {
  captureSchema,
  deadlineCaptureSchema,
  eventCaptureSchema,
  noteSiblingCaptureSchema,
  taskCaptureSchema,
  timeCaptureSchema,
} from "./capture-schemas";

describe("taskCaptureSchema", () => {
  test("accepts a minimal valid task", () => {
    const r = taskCaptureSchema.safeParse({
      kind: "task",
      tempId: "t1",
      title: "Draft motion",
    });
    expect(r.success).toBe(true);
    // priority defaults to "normal"; dueDate defaults to ""
    expect(r.data?.priority).toBe("normal");
    expect(r.data?.dueDate).toBe("");
  });

  test("rejects empty title", () => {
    const r = taskCaptureSchema.safeParse({
      kind: "task",
      tempId: "t1",
      title: "   ",
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues.some((i) => i.path.includes("title"))).toBe(true);
  });

  test("rejects title over 200 chars", () => {
    const r = taskCaptureSchema.safeParse({
      kind: "task",
      tempId: "t1",
      title: "x".repeat(201),
    });
    expect(r.success).toBe(false);
  });

  test("rejects malformed dueDate but keeps '' (optional)", () => {
    const bad = taskCaptureSchema.safeParse({
      kind: "task",
      tempId: "t1",
      title: "ok",
      dueDate: "next tuesday",
    });
    expect(bad.success).toBe(false);
    const empty = taskCaptureSchema.safeParse({
      kind: "task",
      tempId: "t1",
      title: "ok",
      dueDate: "",
    });
    expect(empty.success).toBe(true);
  });

  test("rejects invalid priority", () => {
    const r = taskCaptureSchema.safeParse({
      kind: "task",
      tempId: "t1",
      title: "ok",
      priority: "ASAP",
    });
    expect(r.success).toBe(false);
  });
});

describe("eventCaptureSchema", () => {
  const base = {
    kind: "event" as const,
    tempId: "e1",
    title: "Hearing",
    startTime: "2026-04-25T10:00",
    endTime: "2026-04-25T11:00",
  };

  test("accepts a minimal valid event", () => {
    const r = eventCaptureSchema.safeParse(base);
    expect(r.success).toBe(true);
    expect(r.data?.type).toBe("meeting"); // default
    expect(r.data?.location).toBe(""); // default
  });

  test("rejects when startTime is missing", () => {
    const r = eventCaptureSchema.safeParse({ ...base, startTime: "" });
    expect(r.success).toBe(false);
  });

  test("rejects when endTime is before startTime", () => {
    const r = eventCaptureSchema.safeParse({
      ...base,
      startTime: "2026-04-25T12:00",
      endTime: "2026-04-25T11:00",
    });
    expect(r.success).toBe(false);
    expect(
      r.error?.issues.some(
        (i) => i.path.includes("endTime") && /after start/i.test(i.message)
      )
    ).toBe(true);
  });

  test("rejects unparseable startTime", () => {
    const r = eventCaptureSchema.safeParse({
      ...base,
      startTime: "not-a-date",
    });
    expect(r.success).toBe(false);
    expect(
      r.error?.issues.some(
        (i) =>
          i.path.includes("startTime") && /invalid start/i.test(i.message)
      )
    ).toBe(true);
  });

  test("rejects unparseable endTime", () => {
    const r = eventCaptureSchema.safeParse({
      ...base,
      endTime: "not-a-date",
    });
    expect(r.success).toBe(false);
    expect(
      r.error?.issues.some(
        (i) => i.path.includes("endTime") && /invalid end/i.test(i.message)
      )
    ).toBe(true);
  });

  test("accepts equal start + end (zero-duration event)", () => {
    const r = eventCaptureSchema.safeParse({
      ...base,
      endTime: base.startTime,
    });
    expect(r.success).toBe(true);
  });
});

describe("deadlineCaptureSchema", () => {
  test("accepts a minimal valid deadline", () => {
    const r = deadlineCaptureSchema.safeParse({
      kind: "deadline",
      tempId: "d1",
      title: "Discovery cutoff",
      dueDate: "2026-05-30",
    });
    expect(r.success).toBe(true);
    expect(r.data?.kind_).toBe("manual"); // default
    expect(r.data?.description).toBe("");
  });

  test("rejects empty dueDate", () => {
    const r = deadlineCaptureSchema.safeParse({
      kind: "deadline",
      tempId: "d1",
      title: "ok",
      dueDate: "",
    });
    expect(r.success).toBe(false);
  });

  test("rejects description over 4000 chars", () => {
    const r = deadlineCaptureSchema.safeParse({
      kind: "deadline",
      tempId: "d1",
      title: "ok",
      dueDate: "2026-05-30",
      description: "x".repeat(4001),
    });
    expect(r.success).toBe(false);
  });

  test("rejects non-YYYY-MM-DD dueDate (actions parseLocalDate rely on it)", () => {
    const r = deadlineCaptureSchema.safeParse({
      kind: "deadline",
      tempId: "d1",
      title: "ok",
      dueDate: "05/30/2026",
    });
    expect(r.success).toBe(false);
  });
});

describe("timeCaptureSchema", () => {
  const base = {
    kind: "time" as const,
    tempId: "ti1",
    date: "2026-04-25",
    hours: "1.5",
    activity: "Drafting",
  };

  test("accepts a minimal valid time entry", () => {
    const r = timeCaptureSchema.safeParse(base);
    expect(r.success).toBe(true);
    expect(r.data?.narrative).toBe(""); // default
  });

  test("rejects 0 hours", () => {
    const r = timeCaptureSchema.safeParse({ ...base, hours: "0" });
    expect(r.success).toBe(false);
  });

  test("rejects negative hours", () => {
    const r = timeCaptureSchema.safeParse({ ...base, hours: "-1" });
    expect(r.success).toBe(false);
  });

  test("rejects > 24 hours", () => {
    const r = timeCaptureSchema.safeParse({ ...base, hours: "25" });
    expect(r.success).toBe(false);
  });

  test("rejects non-numeric hours", () => {
    const r = timeCaptureSchema.safeParse({ ...base, hours: "lots" });
    expect(r.success).toBe(false);
  });

  test("accepts exactly 24 hours (boundary)", () => {
    const r = timeCaptureSchema.safeParse({ ...base, hours: "24" });
    expect(r.success).toBe(true);
  });

  test("rejects non-YYYY-MM-DD date (actions parseLocalDate rely on it)", () => {
    const r = timeCaptureSchema.safeParse({ ...base, date: "Apr 25, 2026" });
    expect(r.success).toBe(false);
  });
});

describe("noteSiblingCaptureSchema", () => {
  test("accepts a minimal valid note sibling", () => {
    const r = noteSiblingCaptureSchema.safeParse({
      kind: "note_sibling",
      tempId: "n1",
      content: "Some thought",
    });
    expect(r.success).toBe(true);
    expect(r.data?.type).toBe("note"); // default
    expect(r.data?.isPinned).toBe(false); // default
  });

  test("rejects empty content", () => {
    const r = noteSiblingCaptureSchema.safeParse({
      kind: "note_sibling",
      tempId: "n1",
      content: "   ",
    });
    expect(r.success).toBe(false);
  });

  test("respects content length cap (200k)", () => {
    const r = noteSiblingCaptureSchema.safeParse({
      kind: "note_sibling",
      tempId: "n1",
      content: "x".repeat(200_001),
    });
    expect(r.success).toBe(false);
  });
});

describe("captureSchema (discriminated union)", () => {
  test("routes by `kind` field", () => {
    const ok = captureSchema.safeParse({
      kind: "task",
      tempId: "t1",
      title: "ok",
    });
    expect(ok.success).toBe(true);
    expect(ok.data?.kind).toBe("task");
  });

  test("rejects unknown kind", () => {
    const r = captureSchema.safeParse({
      kind: "lunch",
      tempId: "x",
      title: "ok",
    });
    expect(r.success).toBe(false);
  });

  test("union routes correctly to event branch (validates endTime)", () => {
    const r = captureSchema.safeParse({
      kind: "event",
      tempId: "e1",
      title: "Mediation",
      startTime: "2026-04-25T10:00",
      endTime: "2026-04-25T09:00",
    });
    // Wrong-order times should still fail through the union.
    expect(r.success).toBe(false);
  });
});
