/**
 * Pure tests for the shared capture pipeline (parse + date resolution
 * + permission messaging). Row creation is covered end to end by
 * notes.test.ts and note-attachments.test.ts against a real DB.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/permission-check", () => ({
  currentUserHasPermission: vi.fn(),
}));

import { currentUserHasPermission } from "@/lib/permission-check";
import { missingPermissions, parseCaptures, permissionDeniedMessage } from "./note-captures";

const DENVER = "America/Denver";

const json = (items: unknown[]) => JSON.stringify(items);

describe("parseCaptures", () => {
  test("malformed JSON is reported as malformed", () => {
    expect(parseCaptures("{not json", DENVER)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  test("a non-array payload is an empty capture list", () => {
    expect(parseCaptures('{"a":1}', DENVER)).toEqual({
      ok: true,
      captures: [],
    });
  });

  test("schema errors come back keyed by the capture's tempId", () => {
    const res = parseCaptures(json([{ kind: "task", tempId: "t9", title: "" }]), DENVER);
    expect(res.ok).toBe(false);
    if (res.ok || res.reason !== "invalid") throw new Error("expected invalid");
    expect(res.attachmentErrors.t9.title?.[0]).toMatch(/required/i);
  });

  test("event wall-clock times are read in the VIEWER's zone, not the server's", () => {
    // 09:00 on Aug 1 in Denver (MDT, UTC-6) is 15:00Z. Parsing with
    // `new Date("2026-08-01T09:00")` on the UTC host gave 09:00Z -
    // six hours early, shown as 3 AM to the user.
    const res = parseCaptures(
      json([
        {
          kind: "event",
          tempId: "e1",
          title: "Status conference",
          startTime: "2026-08-01T09:00",
          endTime: "2026-08-01T10:30",
        },
      ]),
      DENVER,
    );
    if (!res.ok) throw new Error("expected ok");
    expect(res.captures[0].start?.toISOString()).toBe("2026-08-01T15:00:00.000Z");
    expect(res.captures[0].end?.toISOString()).toBe("2026-08-01T16:30:00.000Z");
  });

  test("the same wall-clock value in another zone is a different instant", () => {
    const res = parseCaptures(
      json([
        {
          kind: "event",
          tempId: "e1",
          title: "Hearing",
          startTime: "2026-01-15T09:00",
          endTime: "2026-01-15T10:00",
        },
      ]),
      "America/New_York",
    );
    if (!res.ok) throw new Error("expected ok");
    // January: EST, UTC-5.
    expect(res.captures[0].start?.toISOString()).toBe("2026-01-15T14:00:00.000Z");
  });

  test("an unparseable event time is a field error, not a throw", () => {
    const res = parseCaptures(
      json([
        {
          kind: "event",
          tempId: "e1",
          title: "Bad",
          // `new Date` accepts this, parseWallClock does not.
          startTime: "Aug 1 2026 9:00",
          endTime: "2026-08-01T10:00",
        },
      ]),
      DENVER,
    );
    expect(res.ok).toBe(false);
  });

  test("date-only fields are UTC midnight regardless of the viewer's zone", () => {
    const res = parseCaptures(
      json([
        { kind: "task", tempId: "t", title: "T", dueDate: "2026-04-15" },
        {
          kind: "deadline",
          tempId: "d",
          title: "D",
          dueDate: "2026-04-16",
        },
        {
          kind: "time",
          tempId: "m",
          date: "2026-04-17",
          hours: "1",
          activity: "A",
        },
      ]),
      "Pacific/Honolulu",
    );
    if (!res.ok) throw new Error("expected ok");
    const [task, deadline, time] = res.captures;
    expect(task.dueDate?.toISOString()).toBe("2026-04-15T00:00:00.000Z");
    expect(deadline.dueDate?.toISOString()).toBe("2026-04-16T00:00:00.000Z");
    expect(time.date?.toISOString()).toBe("2026-04-17T00:00:00.000Z");
  });

  test("an impossible calendar date is a field error", () => {
    const res = parseCaptures(
      json([{ kind: "deadline", tempId: "d", title: "D", dueDate: "2026-02-31" }]),
      DENVER,
    );
    if (res.ok || res.reason !== "invalid") throw new Error("expected invalid");
    expect(res.attachmentErrors.d.dueDate?.[0]).toMatch(/valid date/i);
  });

  test("an end before the start is rejected", () => {
    const res = parseCaptures(
      json([
        {
          kind: "event",
          tempId: "e",
          title: "Backwards",
          startTime: "2026-08-01T10:00",
          endTime: "2026-08-01T09:00",
        },
      ]),
      DENVER,
    );
    expect(res.ok).toBe(false);
  });
});

describe("permission messaging", () => {
  beforeEach(() => {
    vi.mocked(currentUserHasPermission).mockReset();
  });

  test("missingPermissions returns exactly the keys the viewer lacks", async () => {
    vi.mocked(currentUserHasPermission).mockImplementation(async (key) => key === "tasks.create");
    expect(await missingPermissions(["tasks.create", "time_entries.create"])).toEqual([
      "time_entries.create",
    ]);
  });

  test("permissionDeniedMessage names what is missing in plain words", () => {
    expect(permissionDeniedMessage(["time_entries.create"])).toMatch(/permission to log time/i);
    expect(permissionDeniedMessage(["tasks.create", "events.create"])).toMatch(
      /create tasks and create events/i,
    );
  });
});
