/**
 * Integration tests for the timer action surface.
 *
 * Covers:
 *   - startTimer: creates the per-user session, honors optional
 *     matter/activity, replaces an existing session (userId unique),
 *     rejects a bogus matter id
 *   - updateTimer: re-points matter/activity WITHOUT resetting the
 *     clock; partial updates don't wipe the other field; errors when
 *     no session exists
 *   - discardTimer: deletes; idempotent when nothing is running
 *   - stopTimer: creates the TimeEntry (source "timer") + deletes
 *     the session atomically; matter REQUIRED; stale-dialog guard
 *     when the session is gone; UTBMS validation
 *   - Permission posture: start/update/discard hit NO permission key
 *     (a timer is a pre-entry, not a billing record); stopTimer —
 *     the one path that writes a TimeEntry — gates on
 *     `time_entries.create`.
 */

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn().mockResolvedValue("test-user"),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));

import { getCurrentUserId } from "@/lib/current-user";
import { requirePermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import {
  discardTimer,
  startTimer,
  stopTimer,
  updateTimer,
} from "@/app/actions/timer";
import { timeEntryInitialState } from "@/lib/time-entry-constants";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

const mockedGetUser = vi.mocked(getCurrentUserId);
const mockedRequirePermission = vi.mocked(requirePermission);

let userId: string;
let matterId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  const u = await seedUser({ firmId, email: "timer@example.com" });
  userId = u.userId;
  mockedGetUser.mockResolvedValue(userId);
  const area = await seedPracticeArea();
  const m = await seedMatter({
    practiceAreaId: area.areaId,
    stageId: area.stageId,
    leadUserId: userId,
  });
  matterId = m.matterId;
});

afterEach(() => {
  vi.clearAllMocks();
});

const getSession = () =>
  prisma.timerSession.findUnique({ where: { userId } });

const buildStopForm = (overrides: Partial<Record<string, string>> = {}) => {
  const fd = new FormData();
  fd.set("matterId", overrides.matterId ?? matterId);
  fd.set("date", overrides.date ?? "2026-07-06");
  fd.set("hours", overrides.hours ?? "0.5");
  fd.set("activity", overrides.activity ?? "Timer work");
  if (overrides.narrative) fd.set("narrative", overrides.narrative);
  if (overrides.utbmsCode !== undefined) {
    fd.set("utbmsCode", overrides.utbmsCode);
  }
  if (overrides.billable === "on") fd.set("billable", "on");
  if (overrides.privileged === "on") fd.set("privileged", "on");
  return fd;
};

// ── startTimer ──────────────────────────────────────────────────────────

describe("startTimer", () => {
  test("creates a bare session (no matter, no activity)", async () => {
    const res = await startTimer();
    expect(res.ok).toBe(true);
    const session = await getSession();
    expect(session).not.toBeNull();
    expect(session?.matterId).toBeNull();
    expect(session?.activity).toBeNull();
  });

  test("stores optional matter + activity", async () => {
    const res = await startTimer({ matterId, activity: "Doc review" });
    expect(res.ok).toBe(true);
    const session = await getSession();
    expect(session?.matterId).toBe(matterId);
    expect(session?.activity).toBe("Doc review");
  });

  test("replaces an existing session instead of erroring", async () => {
    await startTimer({ matterId, activity: "First" });
    const first = await getSession();

    // Restart on a clean slate — new clock, no carried-over matter.
    const res = await startTimer({ activity: "Second" });
    expect(res.ok).toBe(true);

    const sessions = await prisma.timerSession.findMany({
      where: { userId },
    });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].activity).toBe("Second");
    expect(sessions[0].matterId).toBeNull();
    expect(sessions[0].startedAt.getTime()).toBeGreaterThanOrEqual(
      first!.startedAt.getTime()
    );
  });

  test("rejects a matter id that doesn't exist", async () => {
    const res = await startTimer({ matterId: "nope" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/matter not found/i);
    expect(await getSession()).toBeNull();
  });

  test("does NOT hit any permission gate (pre-entry, no billing record)", async () => {
    await startTimer();
    expect(mockedRequirePermission).not.toHaveBeenCalled();
  });
});

// ── updateTimer ─────────────────────────────────────────────────────────

describe("updateTimer", () => {
  test("re-points the matter without resetting the clock", async () => {
    await startTimer({ activity: "Research" });
    const before = await getSession();

    const res = await updateTimer({ matterId });
    expect(res.ok).toBe(true);

    const after = await getSession();
    expect(after?.matterId).toBe(matterId);
    // Clock preserved — that's the whole point of update vs restart.
    expect(after?.startedAt.getTime()).toBe(before!.startedAt.getTime());
    // Untouched field survives a partial update.
    expect(after?.activity).toBe("Research");
  });

  test("explicit null clears a field", async () => {
    await startTimer({ matterId, activity: "Research" });
    const res = await updateTimer({ matterId: null });
    expect(res.ok).toBe(true);
    const after = await getSession();
    expect(after?.matterId).toBeNull();
    expect(after?.activity).toBe("Research");
  });

  test("errors when no timer is running", async () => {
    const res = await updateTimer({ activity: "Anything" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no running timer/i);
  });

  test("rejects a matter id that doesn't exist", async () => {
    await startTimer();
    const res = await updateTimer({ matterId: "nope" });
    expect(res.ok).toBe(false);
    expect((await getSession())?.matterId).toBeNull();
  });
});

// ── discardTimer ────────────────────────────────────────────────────────

describe("discardTimer", () => {
  test("deletes the running session and logs nothing", async () => {
    await startTimer({ matterId, activity: "Abandoned work" });
    const res = await discardTimer();
    expect(res.ok).toBe(true);
    expect(await getSession()).toBeNull();
    expect(await prisma.timeEntry.count()).toBe(0);
  });

  test("idempotent — ok when nothing is running", async () => {
    const res = await discardTimer();
    expect(res.ok).toBe(true);
  });
});

// ── stopTimer ───────────────────────────────────────────────────────────

describe("stopTimer", () => {
  test("creates a TimeEntry with source 'timer' and deletes the session", async () => {
    await startTimer({ matterId, activity: "Deposition prep" });

    const res = await stopTimer(
      timeEntryInitialState,
      buildStopForm({
        hours: "1.25",
        activity: "Deposition prep",
        narrative: "Prepared outline for Smith deposition",
        utbmsCode: "A101",
        billable: "on",
        privileged: "on",
      })
    );
    expect(res.status).toBe("ok");

    const entry = await prisma.timeEntry.findFirstOrThrow();
    expect(entry.matterId).toBe(matterId);
    expect(entry.userId).toBe(userId);
    expect(entry.hours).toBe(1.25);
    expect(entry.source).toBe("timer");
    expect(entry.narrative).toBe("Prepared outline for Smith deposition");
    expect(entry.utbmsCode).toBe("A101");
    expect(entry.billable).toBe(true);
    expect(entry.privileged).toBe(true);

    // Timer is a pre-entry: stop consumes it.
    expect(await getSession()).toBeNull();
  });

  test("gates on time_entries.create", async () => {
    await startTimer({ matterId });
    await stopTimer(timeEntryInitialState, buildStopForm());
    expect(mockedRequirePermission).toHaveBeenCalledWith(
      "time_entries.create"
    );
  });

  test("matter is REQUIRED — empty matterId is a field error", async () => {
    await startTimer();
    const res = await stopTimer(
      timeEntryInitialState,
      buildStopForm({ matterId: "" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.matterId?.length).toBeGreaterThan(0);
    expect(await prisma.timeEntry.count()).toBe(0);
    // Failed stop leaves the clock running — nothing is lost.
    expect(await getSession()).not.toBeNull();
  });

  test("rejects a matter that doesn't exist", async () => {
    await startTimer();
    const res = await stopTimer(
      timeEntryInitialState,
      buildStopForm({ matterId: "nope" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.matterId?.[0]).toMatch(/not found/i);
  });

  test("rejects an unknown UTBMS code", async () => {
    await startTimer({ matterId });
    const res = await stopTimer(
      timeEntryInitialState,
      buildStopForm({ utbmsCode: "X999" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.utbmsCode?.length).toBeGreaterThan(0);
    expect(await prisma.timeEntry.count()).toBe(0);
  });

  test("stale-dialog guard: no session → error, no entry (prevents double-log)", async () => {
    // Timer discarded in "another tab" — the still-open stop dialog
    // must not create a second entry.
    const res = await stopTimer(timeEntryInitialState, buildStopForm());
    expect(res.status).toBe("error");
    expect(res.errors?.activity?.[0]).toMatch(/no running timer/i);
    expect(await prisma.timeEntry.count()).toBe(0);
  });
});
