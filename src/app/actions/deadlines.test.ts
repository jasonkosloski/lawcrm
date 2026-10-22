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
 * "overdue" is not a stored status (DEADLINE_STATUSES is
 * open / completed / waived); it is computed at read time from the
 * due date, so the actions reject it as an unknown status.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// Matter-wall asserts are covered in matter-access-writes.test.ts; this
// file exercises other behaviour with no authenticated session user.
vi.mock("@/lib/matter-access", () => ({
  assertMatterAccess: vi.fn(async () => "test-user"),
  assertOptionalMatterAccess: vi.fn(async () => "test-user"),
  assertChildMatterAccess: vi.fn(async () => null),
  canAccessMatter: vi.fn(async () => true),
}));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn().mockResolvedValue("test-user"),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permission-check";
import { deleteDeadline, setDeadlineStatus, updateDeadline } from "@/app/actions/deadlines";
import { updateDeadlineInitialState } from "@/lib/deadline-form";
import { dateOnlyKey } from "@/lib/format-date";
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
    // Date-only (ADR-012): UTC midnight — see the regression tests below.
    expect(row!.dueDate.toISOString()).toBe("2026-09-15T00:00:00.000Z");
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

  test("dueDate is stored as UTC midnight and round-trips through dateOnlyKey in any zone", async () => {
    // ADR-012: a date-only value is a calendar date at UTC midnight and
    // is read back in UTC (dateOnlyKey / formatDateOnly) everywhere -
    // server and browser alike. Local-midnight storage lands on
    // 06:00/07:00Z on a Denver machine and fails the exact-instant check.
    const id = await seedDeadline();
    const fd = new FormData();
    fd.set("title", "ok");
    fd.set("dueDate", "2026-09-15");
    fd.set("kind", "manual");
    fd.set("status", "open");
    const res = await updateDeadline(id, updateDeadlineInitialState, fd);
    expect(res.status).toBe("ok");

    const row = await prisma.deadline.findUnique({ where: { id } });
    expect(row!.dueDate.getTime()).toBe(Date.UTC(2026, 8, 15));
    expect(dateOnlyKey(row!.dueDate)).toBe("2026-09-15");
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
      editForm({ dueDate: "2027-03-01" }),
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
      editForm({ status: "completed", title: "Renamed", kind: "manual" }),
    );
    expect(res.status).toBe("ok");
    const row = await prisma.deadline.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("completed");
    expect(row.completedAt).not.toBeNull();
    expect(row.title).toBe("Statute of limitations");
    expect(row.kind).toBe("critical");
    expect(row.dueDate.toISOString()).toBe("2027-06-01T00:00:00.000Z");
  });

  test("the previous day (what the old browser-local read-back posted) is now refused as a move", async () => {
    // The edit dialog now prefills the stored UTC day exactly, so any
    // other day is a real attempt to move the mirror row.
    const id = await seedSolDeadline();
    const res = await updateDeadline(
      id,
      updateDeadlineInitialState,
      editForm({ dueDate: "2027-05-31", status: "waived" }),
    );
    expect(res.status).toBe("error");
    expect(res.errors?.dueDate?.[0]).toMatch(/managed on the matter/i);
    const row = await prisma.deadline.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("open");
    expect(row.dueDate.toISOString()).toBe("2027-06-01T00:00:00.000Z");
  });

  test("a date further off is refused as a move", async () => {
    const id = await seedSolDeadline();
    const res = await updateDeadline(
      id,
      updateDeadlineInitialState,
      editForm({ dueDate: "2027-05-30" }),
    );
    expect(res.status).toBe("error");
    expect(res.errors?.dueDate?.[0]).toMatch(/managed on the matter/i);
  });

  test("setDeadlineStatus (complete / reopen) stays allowed", async () => {
    const id = await seedSolDeadline();
    expect((await setDeadlineStatus(id, "completed")).ok).toBe(true);
    expect((await prisma.deadline.findUniqueOrThrow({ where: { id } })).status).toBe("completed");
    expect((await setDeadlineStatus(id, "open")).ok).toBe(true);
  });

  test("other critical deadlines (no SOL sourceType) remain editable and deletable", async () => {
    const id = await seedDeadline({ kind: "critical" });
    expect(
      (
        await updateDeadline(
          id,
          updateDeadlineInitialState,
          editForm({ title: "Discovery cutoff", dueDate: "2027-03-01" }),
        )
      ).status,
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
    expect(rows.map((r) => r.title)).toEqual(["Deadline completed", "Deadline reopened"]);
    expect(rows[0].detail).toContain("Answer due");
    expect(rows[0].detail).toContain("open → completed");
    expect(rows[0].userId).toBe(userId);
  });

  test("a due-date edit is logged as rescheduled with both dates", async () => {
    const id = await seedDeadline({
      title: "Discovery cutoff",
      dueDate: new Date(Date.UTC(2026, 10, 3)), // Nov 3, 2026
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
      dueDate: new Date(Date.UTC(2026, 11, 1)),
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
      dueDate: new Date(Date.UTC(2026, 5, 10)),
    });
    await deleteDeadline(id);
    const rows = await logs();
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Deadline deleted");
    expect(rows[0].detail).toContain("CGIA notice due");
    expect(rows[0].detail).toContain("2026-06-10");
  });
});

describe("updateDeadline - stale form guard (F521)", () => {
  const form = (over: Record<string, string> = {}) => {
    const fd = new FormData();
    fd.set("title", "Edited by A");
    fd.set("dueDate", "2026-12-01");
    fd.set("kind", "manual");
    fd.set("status", "open");
    for (const [k, v] of Object.entries(over)) fd.set(k, v);
    return fd;
  };

  test("a form seeded before someone else rescheduled it is refused and writes nothing", async () => {
    const id = await seedDeadline({ title: "Original" });
    const seeded = await prisma.deadline.findUniqueOrThrow({ where: { id } });
    // Paralegal B moves the due date after a scheduling order.
    await prisma.deadline.update({
      where: { id },
      // Explicit bump: seed and update can land in the same ms.
      data: {
        dueDate: new Date(Date.UTC(2026, 10, 3)),
        updatedAt: new Date(seeded.updatedAt.getTime() + 1000),
      },
    });

    const res = await updateDeadline(
      id,
      updateDeadlineInitialState,
      form({ expectedUpdatedAt: seeded.updatedAt.toISOString() }),
    );
    expect(res.status).toBe("error");
    expect(res.errors?._form?.[0]).toMatch(/changed by someone else/i);
    const row = await prisma.deadline.findUniqueOrThrow({ where: { id } });
    expect(row.title).toBe("Original");
    expect(dateOnlyKey(row.dueDate)).toBe("2026-11-03");
  });

  test("a stale refusal revalidates the matter's deadline surfaces so the reopened dialog gets fresh props", async () => {
    const id = await seedDeadline({ title: "Original" });
    const seeded = await prisma.deadline.findUniqueOrThrow({ where: { id } });
    await prisma.deadline.update({
      where: { id },
      // Explicit bump: seed and update can land in the same ms.
      data: { title: "Edited by B", updatedAt: new Date(seeded.updatedAt.getTime() + 1000) },
    });
    vi.mocked(revalidatePath).mockClear();

    const res = await updateDeadline(
      id,
      updateDeadlineInitialState,
      form({ expectedUpdatedAt: seeded.updatedAt.toISOString() }),
    );
    expect(res.status).toBe("error");
    expect(revalidatePath).toHaveBeenCalledWith(`/matters/${matterId}/deadlines`);
    expect(revalidatePath).toHaveBeenCalledWith("/calendar");
  });

  test("a form seeded from the current row saves", async () => {
    const id = await seedDeadline({ title: "Original" });
    const seeded = await prisma.deadline.findUniqueOrThrow({ where: { id } });
    const res = await updateDeadline(
      id,
      updateDeadlineInitialState,
      form({ expectedUpdatedAt: seeded.updatedAt.toISOString() }),
    );
    expect(res.status).toBe("ok");
  });

  test("no expectedUpdatedAt field = no check", async () => {
    const id = await seedDeadline({ title: "Original" });
    expect((await updateDeadline(id, updateDeadlineInitialState, form())).status).toBe("ok");
  });

  test("source and description edits are in the audit row", async () => {
    const id = await seedDeadline({ title: "Original" });
    await updateDeadline(
      id,
      updateDeadlineInitialState,
      form({ title: "Original", sourceRef: "CRS 13-80-101", description: "why" }),
    );
    const rows = await prisma.activityLog.findMany({
      where: { matterId, type: "deadline" },
      select: { detail: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].detail).toContain('source "" → "CRS 13-80-101"');
    expect(rows[0].detail).toContain("description edited");
  });
});

// ── Dependent deadlines (ADR-040) ───────────────────────────────────────

describe("updateDeadline — dependent deadlines need explicit confirmation", () => {
  // Trial (entered) → Motions in limine 30 days before → Witness list 7 days before motions.
  async function seedChain() {
    const trialRule = await prisma.deadlineRule.create({
      data: { title: "Trial", anchor: "prompt", offsetDays: 0 },
    });
    const motionsRule = await prisma.deadlineRule.create({
      data: {
        title: "Motions in limine",
        anchor: "rule",
        anchorRuleId: trialRule.id,
        offsetDays: -30,
      },
    });
    const witnessRule = await prisma.deadlineRule.create({
      data: { title: "Witness list", anchor: "rule", anchorRuleId: motionsRule.id, offsetDays: -7 },
    });
    const mk = (title: string, ruleId: string, key: string) =>
      prisma.deadline.create({
        data: {
          matterId,
          title,
          dueDate: new Date(`${key}T00:00:00Z`),
          kind: "auto_rule",
          status: "open",
          deadlineRuleId: ruleId,
        },
        select: { id: true, updatedAt: true },
      });
    const trial = await mk("Trial", trialRule.id, "2027-06-01");
    const motions = await mk("Motions in limine", motionsRule.id, "2027-05-02");
    const witness = await mk("Witness list", witnessRule.id, "2027-04-25");
    return { trial, motions, witness };
  }
  const due = async (id: string) =>
    dateOnlyKey((await prisma.deadline.findUniqueOrThrow({ where: { id } })).dueDate);
  const moveForm = (newKey: string, extra: Record<string, string | string[]> = {}) => {
    const fd = new FormData();
    fd.set("title", "Trial");
    fd.set("dueDate", newKey);
    fd.set("kind", "auto_rule");
    fd.set("status", "open");
    for (const [k, v] of Object.entries(extra)) {
      for (const one of Array.isArray(v) ? v : [v]) fd.append(k, one);
    }
    return fd;
  };

  test("first save writes NOTHING and lists every deadline that would move", async () => {
    const { trial, motions, witness } = await seedChain();
    const res = await updateDeadline(trial.id, updateDeadlineInitialState, moveForm("2027-07-01"));
    expect(res.status).toBe("confirm");
    expect(res.cascade?.map((c) => [c.title, c.fromKey, c.toKey])).toEqual([
      ["Motions in limine", "2027-05-02", "2027-06-01"],
      ["Witness list", "2027-04-25", "2027-05-25"],
    ]);
    expect(await due(trial.id)).toBe("2027-06-01");
    expect(await due(motions.id)).toBe("2027-05-02");
    expect(await due(witness.id)).toBe("2027-04-25");
  });

  test("apply moves exactly the ticked deadlines, clears their hand-set marker, and logs each", async () => {
    const { trial, motions, witness } = await seedChain();
    const res = await updateDeadline(
      trial.id,
      updateDeadlineInitialState,
      moveForm("2027-07-01", { cascadeDecision: "apply", cascadeId: [motions.id, witness.id] }),
    );
    expect(res.status).toBe("ok");
    expect(await due(trial.id)).toBe("2027-07-01");
    expect(await due(motions.id)).toBe("2027-06-01");
    expect(await due(witness.id)).toBe("2027-05-25");
    // The edited deadline was set by hand; the recalculated ones are back on their rule.
    expect(
      (await prisma.deadline.findUniqueOrThrow({ where: { id: trial.id } })).dueDateSetManually,
    ).toBe(true);
    expect(
      (await prisma.deadline.findUniqueOrThrow({ where: { id: motions.id } })).dueDateSetManually,
    ).toBe(false);
    const logs = await prisma.activityLog.findMany({
      where: { matterId, title: "Deadline recalculated" },
    });
    expect(logs.map((l) => l.detail).sort()).toEqual([
      'Motions in limine: due 2027-05-02 → 2027-06-01 (counts from Trial) — after "Trial" moved',
      'Witness list: due 2027-04-25 → 2027-05-25 (counts from Motions in limine) — after "Trial" moved',
    ]);
  });

  test("unticking a deadline keeps it and what counts from it, even if its id is posted for a child", async () => {
    const { trial, motions, witness } = await seedChain();
    await updateDeadline(
      trial.id,
      updateDeadlineInitialState,
      moveForm("2027-07-01", { cascadeDecision: "apply", cascadeId: [witness.id] }),
    );
    expect(await due(trial.id)).toBe("2027-07-01");
    expect(await due(motions.id)).toBe("2027-05-02");
    expect(await due(witness.id)).toBe("2027-04-25");
  });

  test("skip saves only the edited deadline", async () => {
    const { trial, motions } = await seedChain();
    const res = await updateDeadline(
      trial.id,
      updateDeadlineInitialState,
      moveForm("2027-07-01", { cascadeDecision: "skip", cascadeId: [motions.id] }),
    );
    expect(res.status).toBe("ok");
    expect(await due(trial.id)).toBe("2027-07-01");
    expect(await due(motions.id)).toBe("2027-05-02");
    expect(await prisma.activityLog.count({ where: { title: "Deadline recalculated" } })).toBe(0);
  });

  test("an id that wasn't part of the plan is never touched", async () => {
    const { trial } = await seedChain();
    const unrelated = await seedDeadline({
      title: "Unrelated",
      dueDate: new Date("2027-01-15T00:00:00Z"),
    });
    await updateDeadline(
      trial.id,
      updateDeadlineInitialState,
      moveForm("2027-07-01", { cascadeDecision: "apply", cascadeId: [unrelated] }),
    );
    expect(await due(unrelated)).toBe("2027-01-15");
  });

  test("deadlines nothing counts from save directly — no confirmation", async () => {
    const id = await seedDeadline({
      title: "Hand-entered",
      dueDate: new Date("2027-01-15T00:00:00Z"),
    });
    const fd = new FormData();
    fd.set("title", "Hand-entered");
    fd.set("dueDate", "2027-02-15");
    fd.set("kind", "manual");
    fd.set("status", "open");
    expect((await updateDeadline(id, updateDeadlineInitialState, fd)).status).toBe("ok");
    expect(await due(id)).toBe("2027-02-15");
    // Not rule-generated → never marked as hand-set.
    expect((await prisma.deadline.findUniqueOrThrow({ where: { id } })).dueDateSetManually).toBe(
      false,
    );
  });

  test("a hand-set dependent is listed and flagged", async () => {
    const { trial, motions } = await seedChain();
    await prisma.deadline.update({ where: { id: motions.id }, data: { dueDateSetManually: true } });
    const res = await updateDeadline(trial.id, updateDeadlineInitialState, moveForm("2027-07-01"));
    expect(res.cascade?.find((c) => c.deadlineId === motions.id)?.manual).toBe(true);
  });

  test("the stale-form guard still applies on the confirmed resubmit", async () => {
    const { trial, motions } = await seedChain();
    const stale = new Date(trial.updatedAt.getTime() - 60_000).toISOString();
    const res = await updateDeadline(
      trial.id,
      updateDeadlineInitialState,
      moveForm("2027-07-01", {
        cascadeDecision: "apply",
        cascadeId: [motions.id],
        expectedUpdatedAt: stale,
      }),
    );
    expect(res.status).toBe("error");
    expect(await due(trial.id)).toBe("2027-06-01");
    expect(await due(motions.id)).toBe("2027-05-02");
  });
});
