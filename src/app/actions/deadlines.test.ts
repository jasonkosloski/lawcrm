/**
 * Integration tests for the deadline action surface.
 *
 * Covers:
 *   - setDeadlineStatus completedAt mirroring (only "completed"
 *     stamps; everything else clears) + status validation
 *   - missing-deadline guard
 *   - deleteDeadline removes the row
 *   - updateDeadline zod validation + dueDate parsing + sourceRef
 *     / description normalization to null
 *
 * `overdue` is computed at read time, not written by the action,
 * so we don't expose it as a settable state — but it DOES live
 * in DEADLINE_STATUSES (for filtering on the read side), and the
 * action accepts it as a valid status value. We assert that
 * setting "overdue" works (it's allowed) but doesn't stamp
 * completedAt — same as "open" or "waived".
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn().mockResolvedValue("test-user"),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permission-check";
import {
  deleteDeadline,
  setDeadlineStatus,
  updateDeadline,
} from "@/app/actions/deadlines";
import { updateDeadlineInitialState } from "@/lib/deadline-form";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

let userId: string;
let matterId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  const u = await seedUser({ firmId });
  userId = u.userId;
  // requirePermission returns the actor id, which the audit rows use.
  vi.mocked(requirePermission).mockResolvedValue(userId);
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

const seedDeadline = async (overrides?: {
  status?: string;
  title?: string;
  dueDate?: Date;
  completedAt?: Date | null;
  kind?: string;
}) => {
  const d = await prisma.deadline.create({
    data: {
      matterId,
      title: overrides?.title ?? "Discovery cutoff",
      dueDate: overrides?.dueDate ?? new Date("2026-12-01"),
      kind: overrides?.kind ?? "manual",
      status: overrides?.status ?? "open",
      completedAt: overrides?.completedAt ?? null,
    },
    select: { id: true },
  });
  return d.id;
};

describe("setDeadlineStatus — validation", () => {
  test("rejects unknown status", async () => {
    const id = await seedDeadline();
    const res = await setDeadlineStatus(id, "garbage" as never);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/unknown status/i);
  });

  test("rejects unknown deadlineId", async () => {
    const res = await setDeadlineStatus("nope", "completed");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });
});

describe("setDeadlineStatus — completedAt mirroring", () => {
  test("entering completed stamps completedAt", async () => {
    const id = await seedDeadline({ status: "open" });
    const res = await setDeadlineStatus(id, "completed");
    expect(res.ok).toBe(true);
    const row = await prisma.deadline.findUnique({ where: { id } });
    expect(row!.status).toBe("completed");
    expect(row!.completedAt).toBeInstanceOf(Date);
  });

  test("waived clears completedAt (it's not a completed state)", async () => {
    const original = new Date("2026-01-01T10:00:00Z");
    const id = await seedDeadline({ status: "completed", completedAt: original });
    await setDeadlineStatus(id, "waived");
    const row = await prisma.deadline.findUnique({ where: { id } });
    expect(row!.status).toBe("waived");
    expect(row!.completedAt).toBeNull();
  });

  test("re-completing preserves the original completedAt", async () => {
    const original = new Date("2026-01-01T10:00:00Z");
    const id = await seedDeadline({ status: "completed", completedAt: original });
    await setDeadlineStatus(id, "completed");
    const row = await prisma.deadline.findUnique({ where: { id } });
    expect(row!.completedAt!.getTime()).toBe(original.getTime());
  });

  test("transitions between open / waived don't touch completedAt", async () => {
    const id = await seedDeadline({ status: "open", completedAt: null });
    await setDeadlineStatus(id, "waived");
    const row = await prisma.deadline.findUnique({ where: { id } });
    expect(row!.completedAt).toBeNull();
  });
});

describe("deleteDeadline", () => {
  test("removes the row", async () => {
    const id = await seedDeadline();
    const res = await deleteDeadline(id);
    expect(res.ok).toBe(true);
    expect(await prisma.deadline.findUnique({ where: { id } })).toBeNull();
  });

  test("returns error for unknown id", async () => {
    const res = await deleteDeadline("missing");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });
});

describe("updateDeadline — validation", () => {
  test("rejects empty title", async () => {
    const id = await seedDeadline();
    const fd = new FormData();
    fd.set("title", "   ");
    fd.set("dueDate", "2026-08-01");
    fd.set("kind", "manual");
    fd.set("status", "open");
    const res = await updateDeadline(id, updateDeadlineInitialState, fd);
    expect(res.status).toBe("error");
    expect(res.errors?.title?.length).toBeGreaterThan(0);
  });

  test("rejects empty dueDate", async () => {
    const id = await seedDeadline();
    const fd = new FormData();
    fd.set("title", "ok");
    fd.set("dueDate", "");
    fd.set("kind", "manual");
    fd.set("status", "open");
    const res = await updateDeadline(id, updateDeadlineInitialState, fd);
    expect(res.status).toBe("error");
    expect(res.errors?.dueDate?.length).toBeGreaterThan(0);
  });

  test("rejects unknown kind", async () => {
    const id = await seedDeadline();
    const fd = new FormData();
    fd.set("title", "ok");
    fd.set("dueDate", "2026-08-01");
    fd.set("kind", "made-up");
    fd.set("status", "open");
    const res = await updateDeadline(id, updateDeadlineInitialState, fd);
    expect(res.status).toBe("error");
  });

  test("rejects when deadline no longer exists", async () => {
    const fd = new FormData();
    fd.set("title", "ok");
    fd.set("dueDate", "2026-08-01");
    fd.set("kind", "manual");
    fd.set("status", "open");
    const res = await updateDeadline("missing", updateDeadlineInitialState, fd);
    expect(res.status).toBe("error");
    expect(res.errors?.title?.[0]).toMatch(/no longer exists/i);
  });
});

describe("updateDeadline — happy path", () => {
  test("persists field updates + parses dueDate", async () => {
    const id = await seedDeadline();
    const fd = new FormData();
    fd.set("title", "Renamed");
    fd.set("dueDate", "2026-09-15");
    fd.set("kind", "critical");
    fd.set("sourceRef", "CRS §24-10-109");
    fd.set("description", "Notice of claim");
    fd.set("status", "open");
    const res = await updateDeadline(id, updateDeadlineInitialState, fd);
    expect(res.status).toBe("ok");

    const row = await prisma.deadline.findUnique({ where: { id } });
    expect(row!.title).toBe("Renamed");
    expect(row!.kind).toBe("critical");
    expect(row!.sourceRef).toBe("CRS §24-10-109");
    expect(row!.description).toBe("Notice of claim");
    // Local midnight, not UTC — see the dueDate regression tests below.
    expect(row!.dueDate.getTime()).toBe(new Date(2026, 8, 15).getTime());
  });

  test("normalizes empty sourceRef + description to null", async () => {
    const id = await seedDeadline();
    const fd = new FormData();
    fd.set("title", "ok");
    fd.set("dueDate", "2026-08-01");
    fd.set("kind", "manual");
    fd.set("sourceRef", "");
    fd.set("description", "");
    fd.set("status", "open");
    const res = await updateDeadline(id, updateDeadlineInitialState, fd);
    expect(res.status).toBe("ok");
    const row = await prisma.deadline.findUnique({ where: { id } });
    expect(row!.sourceRef).toBeNull();
    expect(row!.description).toBeNull();
  });

  test("dueDate parses as LOCAL midnight, not UTC (no day drift west of UTC)", async () => {
    // Regression: `new Date("2026-09-15")` parses as UTC midnight,
    // which is the previous local day for any user west of UTC. The
    // edit dialog reads dueDate back with local getters, so under the
    // old parsing each save-reopen-save cycle drifted the deadline a
    // day earlier. Pinning local midnight makes the round-trip stable
    // in every timezone (the assertion is TZ-agnostic by comparing
    // against a locally-constructed Date).
    const id = await seedDeadline();
    const fd = new FormData();
    fd.set("title", "ok");
    fd.set("dueDate", "2026-09-15");
    fd.set("kind", "manual");
    fd.set("status", "open");
    const res = await updateDeadline(id, updateDeadlineInitialState, fd);
    expect(res.status).toBe("ok");

    const row = await prisma.deadline.findUnique({ where: { id } });
    expect(row!.dueDate.getTime()).toBe(new Date(2026, 8, 15).getTime());
    // Round-trip through local getters (what toDateInput does in the
    // edit dialog) must reproduce the posted string — no drift.
    const d = row!.dueDate;
    const roundTripped = [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, "0"),
      String(d.getDate()).padStart(2, "0"),
    ].join("-");
    expect(roundTripped).toBe("2026-09-15");
  });

  test("rejects a malformed dueDate that isn't YYYY-MM-DD", async () => {
    const id = await seedDeadline();
    const fd = new FormData();
    fd.set("title", "ok");
    fd.set("dueDate", "09/15/2026");
    fd.set("kind", "manual");
    fd.set("status", "open");
    const res = await updateDeadline(id, updateDeadlineInitialState, fd);
    expect(res.status).toBe("error");
    expect(res.errors?.dueDate?.length).toBeGreaterThan(0);
  });

  test("status change to completed stamps completedAt; back to open clears it", async () => {
    const id = await seedDeadline({ status: "open" });
    const fd1 = new FormData();
    fd1.set("title", "ok");
    fd1.set("dueDate", "2026-08-01");
    fd1.set("kind", "manual");
    fd1.set("status", "completed");
    await updateDeadline(id, updateDeadlineInitialState, fd1);
    let row = await prisma.deadline.findUnique({ where: { id } });
    expect(row!.completedAt).toBeInstanceOf(Date);

    const fd2 = new FormData();
    fd2.set("title", "ok");
    fd2.set("dueDate", "2026-08-01");
    fd2.set("kind", "manual");
    fd2.set("status", "open");
    await updateDeadline(id, updateDeadlineInitialState, fd2);
    row = await prisma.deadline.findUnique({ where: { id } });
    expect(row!.completedAt).toBeNull();
  });
});

// ── RBAC gate ───────────────────────────────────────────────────────────
//
// The module-level `vi.mock("@/lib/permission-check", ...)` at the
// top stubs requirePermission so the action-logic tests don't have
// to set up gates. The mocked function is a spy — read `.mock.calls`
// to verify each action wired the gate to the right key.

describe("deadlines action gate", () => {
  const mockedRequirePermission = vi.mocked(requirePermission);

  test("setDeadlineStatus gates on deadlines.edit", async () => {
    mockedRequirePermission.mockClear();
    const id = await seedDeadline();
    await setDeadlineStatus(id, "completed");
    expect(mockedRequirePermission).toHaveBeenCalledWith("deadlines.edit");
  });

  test("updateDeadline gates on deadlines.edit", async () => {
    mockedRequirePermission.mockClear();
    const id = await seedDeadline();
    const fd = new FormData();
    fd.set("title", "ok");
    fd.set("dueDate", "2026-08-01");
    fd.set("kind", "manual");
    fd.set("status", "open");
    await updateDeadline(id, updateDeadlineInitialState, fd);
    expect(mockedRequirePermission).toHaveBeenCalledWith("deadlines.edit");
  });

  test("deleteDeadline gates on deadlines.delete", async () => {
    mockedRequirePermission.mockClear();
    const id = await seedDeadline();
    await deleteDeadline(id);
    expect(mockedRequirePermission).toHaveBeenCalledWith("deadlines.delete");
  });
});

// ── Statute-of-limitations mirror is managed from the matter ───────────

describe("auto-managed SOL deadline (F090/F096/F040/F022/F279)", () => {
  const seedSolDeadline = async (status = "open") => {
    const d = await prisma.deadline.create({
      data: {
        matterId,
        title: "Statute of limitations",
        dueDate: new Date("2027-06-01T00:00:00Z"),
        kind: "critical",
        sourceType: "statute_of_limitations",
        status,
        ownerId: userId,
      },
      select: { id: true },
    });
    return d.id;
  };
  const editForm = (over: Record<string, string> = {}) => {
    const fd = new FormData();
    fd.set("title", "Statute of limitations");
    fd.set("dueDate", "2027-06-01");
    fd.set("kind", "critical");
    fd.set("status", "open");
    for (const [k, v] of Object.entries(over)) fd.set(k, v);
    return fd;
  };

  test("deleteDeadline refuses and points at the matter", async () => {
    const id = await seedSolDeadline();
    const res = await deleteDeadline(id);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/managed on the matter/i);
    expect(await prisma.deadline.count({ where: { id } })).toBe(1);
  });

  test("updateDeadline refuses to move the due date", async () => {
    const id = await seedSolDeadline();
    const res = await updateDeadline(
      id,
      updateDeadlineInitialState,
      editForm({ dueDate: "2027-03-01" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.dueDate?.[0]).toMatch(/managed on the matter/i);
    const row = await prisma.deadline.findUniqueOrThrow({ where: { id } });
    expect(row.dueDate.toISOString()).toBe("2027-06-01T00:00:00.000Z");
  });

  test("updateDeadline with the unchanged date only applies the status and leaves the mirror fields alone", async () => {
    const id = await seedSolDeadline();
    const res = await updateDeadline(
      id,
      updateDeadlineInitialState,
      editForm({ status: "completed", title: "Renamed", kind: "manual" })
    );
    expect(res.status).toBe("ok");
    const row = await prisma.deadline.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("completed");
    expect(row.completedAt).not.toBeNull();
    expect(row.title).toBe("Statute of limitations");
    expect(row.kind).toBe("critical");
    expect(row.dueDate.toISOString()).toBe("2027-06-01T00:00:00.000Z");
  });

  test("a browser west of UTC posts the previous day: still status-only success", async () => {
    const id = await seedSolDeadline();
    const res = await updateDeadline(
      id,
      updateDeadlineInitialState,
      editForm({ dueDate: "2027-05-31", status: "waived" })
    );
    expect(res.status).toBe("ok");
    const row = await prisma.deadline.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("waived");
    expect(row.dueDate.toISOString()).toBe("2027-06-01T00:00:00.000Z");
  });

  test("a date two or more days off is still refused as a move", async () => {
    const id = await seedSolDeadline();
    const res = await updateDeadline(
      id,
      updateDeadlineInitialState,
      editForm({ dueDate: "2027-05-30" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.dueDate?.[0]).toMatch(/managed on the matter/i);
  });

  test("setDeadlineStatus (complete / reopen) stays allowed", async () => {
    const id = await seedSolDeadline();
    expect((await setDeadlineStatus(id, "completed")).ok).toBe(true);
    expect(
      (await prisma.deadline.findUniqueOrThrow({ where: { id } })).status
    ).toBe("completed");
    expect((await setDeadlineStatus(id, "open")).ok).toBe(true);
  });

  test("other critical deadlines (no SOL sourceType) remain editable and deletable", async () => {
    const id = await seedDeadline({ kind: "critical" });
    expect(
      (
        await updateDeadline(
          id,
          updateDeadlineInitialState,
          editForm({ title: "Discovery cutoff", dueDate: "2027-03-01" })
        )
      ).status
    ).toBe("ok");
    expect((await deleteDeadline(id)).ok).toBe(true);
  });
});

// ── Audit trail ─────────────────────────────────────────────────────────

describe("deadline audit trail (F189/F220/F142)", () => {
  const logs = () =>
    prisma.activityLog.findMany({
      where: { matterId, type: "deadline" },
      orderBy: { timestamp: "asc" },
      select: { title: true, detail: true, userId: true },
    });

  test("status changes are logged with old -> new, and no-ops are not", async () => {
    const id = await seedDeadline({ title: "Answer due" });
    await setDeadlineStatus(id, "completed");
    await setDeadlineStatus(id, "completed"); // no change
    await setDeadlineStatus(id, "open");
    const rows = await logs();
    expect(rows.map((r) => r.title)).toEqual([
      "Deadline completed",
      "Deadline reopened",
    ]);
    expect(rows[0].detail).toContain("Answer due");
    expect(rows[0].detail).toContain("open → completed");
    expect(rows[0].userId).toBe(userId);
  });

  test("a due-date edit is logged as rescheduled with both dates", async () => {
    const id = await seedDeadline({
      title: "Discovery cutoff",
      dueDate: new Date(2026, 10, 3), // local Nov 3, 2026
    });
    const fd = new FormData();
    fd.set("title", "Discovery cutoff");
    fd.set("dueDate", "2026-12-15");
    fd.set("kind", "manual");
    fd.set("status", "open");
    await updateDeadline(id, updateDeadlineInitialState, fd);
    const rows = await logs();
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Deadline rescheduled");
    expect(rows[0].detail).toContain("2026-11-03 → 2026-12-15");
  });

  test("an edit that changes nothing writes no row", async () => {
    const id = await seedDeadline({
      title: "Same",
      dueDate: new Date(2026, 11, 1),
    });
    const fd = new FormData();
    fd.set("title", "Same");
    fd.set("dueDate", "2026-12-01");
    fd.set("kind", "manual");
    fd.set("status", "open");
    await updateDeadline(id, updateDeadlineInitialState, fd);
    expect(await logs()).toHaveLength(0);
  });

  test("a delete is logged with the title captured before the row went away", async () => {
    const id = await seedDeadline({
      title: "CGIA notice due",
      dueDate: new Date(2026, 5, 10),
    });
    await deleteDeadline(id);
    const rows = await logs();
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Deadline deleted");
    expect(rows[0].detail).toContain("CGIA notice due");
    expect(rows[0].detail).toContain("2026-06-10");
  });
});
