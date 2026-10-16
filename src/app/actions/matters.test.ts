/**
 * Integration tests for the matter actions.
 *
 * Covers:
 *   - createMatter's multi-step write (inline Contact + Matter + SOL
 *     Deadline) is atomic — a failed matter.create can't strand an
 *     orphaned Contact/ContactPhone.
 *   - Matter.statuteOfLimitationsSatisfied is the source of truth for
 *     the SOL sync: clearing the SOL date resets the flag, so a
 *     re-added date starts back at "open" instead of diverging from a
 *     stale satisfied flag; a plain date edit preserves the flag.
 *   - Deactivated users can't be assigned as lead attorney — create
 *     falls back to the current user, update returns a field error
 *     (never silently swaps the lead), matching addMatterTeamMember's
 *     active-user guard.
 *
 * Auth + permission gates are stubbed; the gate itself is covered in
 * `permission-check.integration.test.ts`.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

// The action resolves the actor's TZ (automation date math);
// current-user-tz is server-only, so stub it (same as other suites).
vi.mock("@/lib/current-user-tz", () => ({
  getCurrentUserTimeZone: vi.fn(async () => "UTC"),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn().mockResolvedValue("test-user"),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  }),
}));

import { getCurrentUserId } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import {
  currentUserHasPermission,
  requirePermission,
} from "@/lib/permission-check";
import {
  createMatter,
  setMatterSolSatisfied,
  updateMatter,
} from "@/app/actions/matters";
import {
  NEW_CLIENT_SENTINEL,
  createMatterInitialState,
  updateMatterInitialState,
} from "@/lib/new-matter-constants";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

const mockedGetUser = vi.mocked(getCurrentUserId);

const SOL_SOURCE_TYPE = "statute_of_limitations";

let firmId: string;
let userId: string;
let areaId: string;
let stageId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const firm = await seedFirm();
  firmId = firm.firmId;
  const u = await seedUser({ firmId });
  userId = u.userId;
  mockedGetUser.mockResolvedValue(userId);
  vi.mocked(currentUserHasPermission).mockResolvedValue(true);
  // requirePermission returns the actor id (used for audit rows).
  vi.mocked(requirePermission).mockResolvedValue(userId);
  // SOL-tracking area so the SOL fields aren't dropped on the floor.
  const area = await seedPracticeArea({ hasStatuteOfLimitations: true });
  areaId = area.areaId;
  stageId = area.stageId;
});

afterEach(() => {
  vi.clearAllMocks();
});

const createForm = (overrides: Record<string, string> = {}) => {
  const fd = new FormData();
  fd.set("name", "Doe v. Acme");
  fd.set("practiceAreaId", areaId);
  fd.set("stageId", stageId);
  fd.set("leadUserId", userId);
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
};

const updateForm = (overrides: Record<string, string> = {}) => {
  const fd = new FormData();
  fd.set("name", "Doe v. Acme");
  fd.set("practiceAreaId", areaId);
  fd.set("stageId", stageId);
  fd.set("feeStructure", "contingent");
  fd.set("leadUserId", userId);
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
};

// ── createMatter atomicity ──────────────────────────────────────────────

describe("createMatter transaction", () => {
  test("happy path: inline client + matter + SOL deadline all land", async () => {
    await expect(
      createMatter(
        createMatterInitialState,
        createForm({
          clientId: NEW_CLIENT_SENTINEL,
          newClientName: "Jane Doe",
          newClientEmail: "jane@example.com",
          newClientPhone: "303-555-0100",
          statuteOfLimitationsDate: "2027-06-01",
        })
      )
    ).rejects.toThrow(/__REDIRECT__:\/matters\//);

    const matter = await prisma.matter.findFirst({
      select: { id: true, clientId: true },
    });
    expect(matter?.clientId).not.toBeNull();
    const phones = await prisma.contactPhone.count({
      where: { contactId: matter!.clientId! },
    });
    expect(phones).toBe(1);
    const deadline = await prisma.deadline.findFirst({
      where: { matterId: matter!.id, sourceType: SOL_SOURCE_TYPE },
      select: { status: true },
    });
    expect(deadline?.status).toBe("open");
  });

  test("failed matter.create rolls back the inline contact", async () => {
    // Force matter.create to fail after contact.create: both the
    // posted lead and the fallback current user point at missing
    // rows, so the nested teamMembers.create hits an FK violation.
    mockedGetUser.mockResolvedValue("missing-user-id");
    await expect(
      createMatter(
        createMatterInitialState,
        createForm({
          leadUserId: "also-missing",
          clientId: NEW_CLIENT_SENTINEL,
          newClientName: "Jane Doe",
          newClientEmail: "jane@example.com",
          newClientPhone: "303-555-0100",
        })
      )
    ).rejects.toThrow();

    // Atomicity: no orphaned Contact / ContactPhone left behind.
    expect(await prisma.matter.count()).toBe(0);
    expect(await prisma.contact.count()).toBe(0);
    expect(await prisma.contactPhone.count()).toBe(0);
  });
});

describe("createMatter — automatic defaults (ADR-019)", () => {
  test("applies matter_created defaults for the area in the same transaction", async () => {
    const rule = await prisma.deadlineRule.create({
      data: { title: "Client intake meeting", anchor: "matter_opened", offsetDays: 7 },
    });
    // Incident-anchored with no incident date → becomes a "Set date" task.
    const needsDate = await prisma.deadlineRule.create({
      data: { title: "CGIA notice", anchor: "incident_date", offsetDays: 182 },
    });
    await prisma.autoApply.createMany({
      data: [
        { practiceAreaId: areaId, deadlineRuleId: rule.id },
        { practiceAreaId: areaId, deadlineRuleId: needsDate.id },
      ],
    });

    await expect(
      createMatter(createMatterInitialState, createForm())
    ).rejects.toThrow(/__REDIRECT__:\/matters\//);

    const matter = await prisma.matter.findFirstOrThrow({ select: { id: true } });
    expect(
      await prisma.deadline.count({ where: { matterId: matter.id, deadlineRuleId: rule.id } })
    ).toBe(1);
    const setDate = await prisma.task.findFirstOrThrow({ where: { matterId: matter.id } });
    expect(setDate.title).toBe("Set date: CGIA notice");
    expect(setDate.ownerId).toBe(userId);
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { matterId: matter.id, type: "automation" },
    });
    expect(log.title).toBe('Automatic defaults applied: 1 deadline, 1 "set date" task');
  });
});

// ── updateMatter: SOL satisfied flag ────────────────────────────────────

describe("updateMatter SOL satisfied sync", () => {
  /** Matter under the SOL area with date set + satisfied flags on +
   *  a completed auto-managed deadline — the state setMatterSolSatisfied
   *  leaves behind. */
  const seedSatisfiedMatter = async () => {
    const { matterId } = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
    });
    const satisfiedAt = new Date("2026-05-01T12:00:00Z");
    await prisma.matter.update({
      where: { id: matterId },
      data: {
        statuteOfLimitationsDate: new Date("2027-06-01"),
        statuteOfLimitationsSatisfied: true,
        statuteOfLimitationsSatisfiedAt: satisfiedAt,
      },
    });
    await prisma.deadline.create({
      data: {
        matterId,
        title: "Statute of limitations",
        dueDate: new Date("2027-06-01"),
        kind: "critical",
        sourceType: SOL_SOURCE_TYPE,
        status: "completed",
        completedAt: satisfiedAt,
      },
    });
    return matterId;
  };

  test("clearing the SOL date resets the matter's satisfied flag", async () => {
    const matterId = await seedSatisfiedMatter();

    // Edit with no SOL/incident date while the area still tracks SOL.
    await expect(
      updateMatter(matterId, updateMatterInitialState, updateForm())
    ).rejects.toThrow(/__REDIRECT__/);

    const matter = await prisma.matter.findUniqueOrThrow({
      where: { id: matterId },
      select: {
        statuteOfLimitationsSatisfied: true,
        statuteOfLimitationsSatisfiedAt: true,
      },
    });
    expect(matter.statuteOfLimitationsSatisfied).toBe(false);
    expect(matter.statuteOfLimitationsSatisfiedAt).toBeNull();
    // Deadline removed alongside the flag.
    expect(
      await prisma.deadline.count({
        where: { matterId, sourceType: SOL_SOURCE_TYPE },
      })
    ).toBe(0);
  });

  test("re-adding a date after a clear starts back at open, not satisfied", async () => {
    const matterId = await seedSatisfiedMatter();

    await expect(
      updateMatter(matterId, updateMatterInitialState, updateForm())
    ).rejects.toThrow(/__REDIRECT__/);
    await expect(
      updateMatter(
        matterId,
        updateMatterInitialState,
        updateForm({ statuteOfLimitationsDate: "2028-01-15" })
      )
    ).rejects.toThrow(/__REDIRECT__/);

    // Overview card and Deadlines tab agree: not satisfied, open.
    const matter = await prisma.matter.findUniqueOrThrow({
      where: { id: matterId },
      select: { statuteOfLimitationsSatisfied: true },
    });
    expect(matter.statuteOfLimitationsSatisfied).toBe(false);
    const deadline = await prisma.deadline.findFirst({
      where: { matterId, sourceType: SOL_SOURCE_TYPE },
      select: { status: true, completedAt: true },
    });
    expect(deadline?.status).toBe("open");
    expect(deadline?.completedAt).toBeNull();
  });

  test("a plain date edit preserves the satisfied flag on both surfaces", async () => {
    const matterId = await seedSatisfiedMatter();

    await expect(
      updateMatter(
        matterId,
        updateMatterInitialState,
        updateForm({ statuteOfLimitationsDate: "2027-09-01" })
      )
    ).rejects.toThrow(/__REDIRECT__/);

    const matter = await prisma.matter.findUniqueOrThrow({
      where: { id: matterId },
      select: {
        statuteOfLimitationsSatisfied: true,
        statuteOfLimitationsSatisfiedAt: true,
      },
    });
    expect(matter.statuteOfLimitationsSatisfied).toBe(true);
    expect(matter.statuteOfLimitationsSatisfiedAt).not.toBeNull();
    const deadline = await prisma.deadline.findFirst({
      where: { matterId, sourceType: SOL_SOURCE_TYPE },
      select: { status: true },
    });
    expect(deadline?.status).toBe("completed");
  });
});

// ── Deactivated lead attorney guard ─────────────────────────────────────

describe("deactivated lead attorney", () => {
  test("createMatter falls back to the current user for an inactive lead", async () => {
    const inactive = await seedUser({ firmId, isActive: false });

    await expect(
      createMatter(
        createMatterInitialState,
        createForm({ leadUserId: inactive.userId })
      )
    ).rejects.toThrow(/__REDIRECT__/);

    const lead = await prisma.matterTeamMember.findFirst({
      where: { role: "lead", removedAt: null },
      select: { userId: true },
    });
    expect(lead?.userId).toBe(userId);
  });

  test("updateMatter refuses to hand the lead seat to an inactive user", async () => {
    const inactive = await seedUser({ firmId, isActive: false });
    const { matterId } = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
    });

    // A deliberate change to an inactive user is a field error — it no
    // longer silently falls back to the current user.
    const result = await updateMatter(
      matterId,
      updateMatterInitialState,
      updateForm({ leadUserId: inactive.userId })
    );
    expect(result.status).toBe("error");
    expect(result.errors?.leadUserId?.[0]).toMatch(/active user/i);

    // The lead is unchanged; the deactivated user never joins the team.
    const lead = await prisma.matterTeamMember.findFirst({
      where: { matterId, role: "lead", removedAt: null },
      select: { userId: true },
    });
    expect(lead?.userId).toBe(userId);
    expect(
      await prisma.matterTeamMember.count({
        where: { matterId, userId: inactive.userId },
      })
    ).toBe(0);
  });

  test("saving with an unchanged, since-deactivated lead keeps them as lead (F082)", async () => {
    const departed = await seedUser({ firmId, isActive: false });
    const { matterId } = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: departed.userId,
    });

    await expect(
      updateMatter(
        matterId,
        updateMatterInitialState,
        updateForm({ leadUserId: departed.userId, court: "D. Colo." })
      )
    ).rejects.toThrow(/__REDIRECT__/);

    const members = await prisma.matterTeamMember.findMany({
      where: { matterId },
      select: { userId: true, role: true },
    });
    expect(members).toEqual([{ userId: departed.userId, role: "lead" }]);
    expect(
      (await prisma.matter.findUniqueOrThrow({ where: { id: matterId } })).court
    ).toBe("D. Colo.");
  });

  test("saving with an unchanged, since-deactivated client keeps the client (F082)", async () => {
    const client = await prisma.contact.create({
      data: { name: "Maria Alvarez", type: "client", isActive: false },
    });
    const { matterId } = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
    });
    await prisma.matter.update({
      where: { id: matterId },
      data: { clientId: client.id },
    });

    await expect(
      updateMatter(
        matterId,
        updateMatterInitialState,
        updateForm({ clientId: client.id })
      )
    ).rejects.toThrow(/__REDIRECT__/);

    expect(
      (await prisma.matter.findUniqueOrThrow({ where: { id: matterId } }))
        .clientId
    ).toBe(client.id);
  });
});

// ── Lead attorney change needs matters.manage_team ──────────────────────

describe("updateMatter lead change authorization (F138/F300/F767)", () => {
  test("an editor without manage_team cannot swap the lead", async () => {
    const other = await seedUser({ firmId, name: "Other Attorney" });
    const { matterId } = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
    });
    vi.mocked(currentUserHasPermission).mockImplementation(
      async (key) => key !== "matters.manage_team"
    );

    const result = await updateMatter(
      matterId,
      updateMatterInitialState,
      updateForm({ leadUserId: other.userId })
    );
    expect(result.status).toBe("error");
    expect(result.errors?.leadUserId?.[0]).toMatch(/manage the case team/i);
    const lead = await prisma.matterTeamMember.findFirst({
      where: { matterId, role: "lead", removedAt: null },
    });
    expect(lead?.userId).toBe(userId);
  });

  test("an editor without manage_team can still save with the lead unchanged (or omitted)", async () => {
    const { matterId } = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
    });
    vi.mocked(currentUserHasPermission).mockImplementation(
      async (key) => key !== "matters.manage_team"
    );

    await expect(
      updateMatter(matterId, updateMatterInitialState, updateForm())
    ).rejects.toThrow(/__REDIRECT__/);
    const noLeadField = updateForm({ court: "Omitted lead" });
    noLeadField.delete("leadUserId");
    await expect(
      updateMatter(matterId, updateMatterInitialState, noLeadField)
    ).rejects.toThrow(/__REDIRECT__/);
    const lead = await prisma.matterTeamMember.findFirst({
      where: { matterId, role: "lead", removedAt: null },
    });
    expect(lead?.userId).toBe(userId);
  });

  test("with manage_team the lead swaps, demotes the old lead and is audited", async () => {
    const other = await seedUser({ firmId, name: "Other Attorney" });
    const { matterId } = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
    });

    await expect(
      updateMatter(
        matterId,
        updateMatterInitialState,
        updateForm({ leadUserId: other.userId })
      )
    ).rejects.toThrow(/__REDIRECT__/);

    const members = await prisma.matterTeamMember.findMany({
      where: { matterId },
      select: { userId: true, role: true },
    });
    expect(members).toContainEqual({ userId: other.userId, role: "lead" });
    expect(members).toContainEqual({ userId, role: "co_counsel" });
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { matterId, title: "Lead attorney changed" },
    });
    expect(log.detail).toContain("Other Attorney");
  });
});

// ── SOL: auto-derived vs manual override on edit (F013/F014) ────────────

describe("updateMatter SOL recompute", () => {
  /** Matter in a SOL area with the given incident + SOL dates and the
   *  mirrored deadline. */
  const seedSolMatter = async (opts: {
    incident: string | null;
    sol: string | null;
    notes?: string;
    deadlineOwner?: string | null;
    deadlineStatus?: string;
    satisfied?: boolean;
  }) => {
    const { matterId } = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
    });
    await prisma.matter.update({
      where: { id: matterId },
      data: {
        incidentDate: opts.incident ? new Date(opts.incident) : null,
        statuteOfLimitationsDate: opts.sol ? new Date(opts.sol) : null,
        statuteOfLimitationsNotes: opts.notes ?? null,
        statuteOfLimitationsSatisfied: opts.satisfied ?? false,
      },
    });
    if (opts.sol) {
      await prisma.deadline.create({
        data: {
          matterId,
          title: "Statute of limitations",
          dueDate: new Date(opts.sol),
          kind: "critical",
          sourceType: SOL_SOURCE_TYPE,
          status: opts.deadlineStatus ?? "open",
          ownerId: opts.deadlineOwner === undefined ? userId : opts.deadlineOwner,
        },
      });
    }
    return matterId;
  };
  const setPeriod = (days: number | null, id = areaId) =>
    prisma.practiceArea.update({
      where: { id },
      data: { statutePeriodDays: days },
    });
  const readSol = async (matterId: string) => {
    const m = await prisma.matter.findUniqueOrThrow({
      where: { id: matterId },
      select: {
        incidentDate: true,
        statuteOfLimitationsDate: true,
        statuteOfLimitationsNotes: true,
      },
    });
    const d = await prisma.deadline.findFirst({
      where: { matterId, sourceType: SOL_SOURCE_TYPE },
    });
    return {
      incident: m.incidentDate?.toISOString().slice(0, 10) ?? null,
      sol: m.statuteOfLimitationsDate?.toISOString().slice(0, 10) ?? null,
      notes: m.statuteOfLimitationsNotes,
      deadline: d?.dueDate.toISOString().slice(0, 10) ?? null,
      deadlineRow: d,
    };
  };
  const save = (matterId: string, over: Record<string, string>) =>
    expect(
      updateMatter(matterId, updateMatterInitialState, updateForm(over))
    ).rejects.toThrow(/__REDIRECT__/);

  test("an auto-derived SOL follows a corrected incident date even when the stored date is posted back", async () => {
    await setPeriod(730);
    // 2024-06-01 + 730 days = 2026-06-01 (auto-derived).
    const matterId = await seedSolMatter({
      incident: "2024-06-01",
      sol: "2026-06-01",
    });

    // Old form behaviour: the stored date comes back as a "override".
    await save(matterId, {
      incidentDate: "2024-03-01",
      statuteOfLimitationsDate: "2026-06-01",
    });

    const r = await readSol(matterId);
    expect(r.sol).toBe("2026-03-01");
    expect(r.deadline).toBe("2026-03-01");
  });

  test("an auto-derived SOL also recomputes when the override input is left empty", async () => {
    await setPeriod(730);
    const matterId = await seedSolMatter({
      incident: "2024-06-01",
      sol: "2026-06-01",
    });
    await save(matterId, { incidentDate: "2024-03-01" });
    const r = await readSol(matterId);
    expect(r.sol).toBe("2026-03-01");
    expect(r.deadline).toBe("2026-03-01");
  });

  test("a manual override that never matched the computed value is kept", async () => {
    await setPeriod(730);
    // Tolling agreement pushed the SOL out; incident + period = 2026-06-01.
    const matterId = await seedSolMatter({
      incident: "2024-06-01",
      sol: "2027-01-15",
    });

    await save(matterId, {
      incidentDate: "2024-03-01",
      statuteOfLimitationsDate: "2027-01-15",
    });

    const r = await readSol(matterId);
    expect(r.sol).toBe("2027-01-15");
    expect(r.deadline).toBe("2027-01-15");
  });

  test("a typed date different from the stored one is a manual override", async () => {
    await setPeriod(730);
    const matterId = await seedSolMatter({
      incident: "2024-06-01",
      sol: "2026-06-01",
    });
    await save(matterId, {
      incidentDate: "2024-06-01",
      statuteOfLimitationsDate: "2026-09-09",
    });
    const r = await readSol(matterId);
    expect(r.sol).toBe("2026-09-09");
    expect(r.deadline).toBe("2026-09-09");
  });

  test("switching to another SOL area recomputes from that area's period", async () => {
    await setPeriod(730);
    const other = await seedPracticeArea({ hasStatuteOfLimitations: true });
    await setPeriod(365, other.areaId);
    const matterId = await seedSolMatter({
      incident: "2024-06-01",
      sol: "2026-06-01",
    });

    await save(matterId, {
      practiceAreaId: other.areaId,
      stageId: other.stageId,
      incidentDate: "2024-06-01",
      statuteOfLimitationsDate: "2026-06-01",
    });

    const r = await readSol(matterId);
    expect(r.sol).toBe("2025-06-01");
    expect(r.deadline).toBe("2025-06-01");
  });

  test("a matter with no SOL yet gets one computed on save", async () => {
    await setPeriod(730);
    const matterId = await seedSolMatter({ incident: null, sol: null });
    await save(matterId, { incidentDate: "2024-06-01" });
    const r = await readSol(matterId);
    expect(r.sol).toBe("2026-06-01");
    expect(r.deadline).toBe("2026-06-01");
  });

  test("switching to an area without SOL tracking keeps incident date, SOL date/notes and the deadline", async () => {
    await setPeriod(730);
    const noSol = await seedPracticeArea({ hasStatuteOfLimitations: false });
    const matterId = await seedSolMatter({
      incident: "2024-11-15",
      sol: "2026-11-15",
      notes: "tolled by agreement",
    });

    await save(matterId, {
      practiceAreaId: noSol.areaId,
      stageId: noSol.stageId,
    });

    const r = await readSol(matterId);
    expect(r.incident).toBe("2024-11-15");
    expect(r.sol).toBe("2026-11-15");
    expect(r.notes).toBe("tolled by agreement");
    expect(r.deadline).toBe("2026-11-15");
  });

  test("an area that stopped tracking SOL does not wipe its matters on an unrelated edit", async () => {
    const matterId = await seedSolMatter({
      incident: "2024-11-15",
      sol: "2026-11-15",
      notes: "keep me",
    });
    await prisma.practiceArea.update({
      where: { id: areaId },
      data: { hasStatuteOfLimitations: false },
    });

    await save(matterId, { name: "Typo fixed" });

    const r = await readSol(matterId);
    expect(r.sol).toBe("2026-11-15");
    expect(r.incident).toBe("2024-11-15");
    expect(r.notes).toBe("keep me");
    expect(r.deadline).toBe("2026-11-15");
  });

  test("a malformed date is a field error, not a Prisma failure", async () => {
    const matterId = await seedSolMatter({ incident: null, sol: null });
    const bad = await updateMatter(
      matterId,
      updateMatterInitialState,
      updateForm({
        incidentDate: "not-a-date",
        statuteOfLimitationsDate: "2026-02-31",
      })
    );
    expect(bad.status).toBe("error");
    expect(bad.errors?.incidentDate).toBeDefined();
    expect(bad.errors?.statuteOfLimitationsDate).toBeDefined();

    const badCreate = await createMatter(
      createMatterInitialState,
      createForm({ incidentDate: "garbage" })
    );
    expect(badCreate.status).toBe("error");
    expect(badCreate.errors?.incidentDate).toBeDefined();
  });

  test("a matter save keeps the SOL deadline's status and owner (F315)", async () => {
    const other = await seedUser({ firmId, name: "Deadline Owner" });
    const matterId = await seedSolMatter({
      incident: null,
      sol: "2027-06-01",
      deadlineOwner: other.userId,
      deadlineStatus: "waived",
    });

    await save(matterId, {
      statuteOfLimitationsDate: "2027-06-01",
      court: "D. Colo.",
    });

    const r = await readSol(matterId);
    expect(r.deadlineRow?.ownerId).toBe(other.userId);
    expect(r.deadlineRow?.status).toBe("waived");
  });

  test("the SOL deadline owner follows a lead swap when the old lead owned it", async () => {
    const other = await seedUser({ firmId, name: "New Lead" });
    const matterId = await seedSolMatter({ incident: null, sol: "2027-06-01" });
    await save(matterId, {
      statuteOfLimitationsDate: "2027-06-01",
      leadUserId: other.userId,
    });
    const r = await readSol(matterId);
    expect(r.deadlineRow?.ownerId).toBe(other.userId);
  });

  test("setMatterSolSatisfied keeps the deadline owner and writes an audit row (F315/F301)", async () => {
    const matterId = await seedSolMatter({ incident: null, sol: "2027-06-01" });

    await expect(setMatterSolSatisfied(matterId, true)).resolves.toEqual({
      ok: true,
    });
    let r = await readSol(matterId);
    expect(r.deadlineRow?.ownerId).toBe(userId);
    expect(r.deadlineRow?.status).toBe("completed");

    await setMatterSolSatisfied(matterId, false);
    r = await readSol(matterId);
    expect(r.deadlineRow?.ownerId).toBe(userId);
    expect(r.deadlineRow?.status).toBe("open");

    const logs = await prisma.activityLog.findMany({
      where: { matterId, type: "deadline" },
      orderBy: { timestamp: "asc" },
      select: { title: true, userId: true, detail: true },
    });
    expect(logs.map((l) => l.title)).toEqual([
      "Statute of limitations marked satisfied",
      "Statute of limitations reopened",
    ]);
    expect(logs[0].userId).toBe(userId);
    expect(logs[0].detail).toContain("2027-06-01");
  });
});

// ── Audit trail ─────────────────────────────────────────────────────────

describe("matter audit trail", () => {
  test("createMatter writes a 'Matter created' row", async () => {
    await expect(
      createMatter(createMatterInitialState, createForm())
    ).rejects.toThrow(/__REDIRECT__/);
    const matter = await prisma.matter.findFirstOrThrow();
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { matterId: matter.id, title: "Matter created" },
    });
    expect(log.userId).toBe(userId);
    expect(log.detail).toContain("Doe v. Acme");
  });

  test("updateMatter logs the old -> new SOL date, field changes and stage moves", async () => {
    const { matterId } = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
    });
    await prisma.matter.update({
      where: { id: matterId },
      data: { statuteOfLimitationsDate: new Date("2026-06-01") },
    });
    const stage2 = await prisma.matterStage.create({
      data: { practiceAreaId: areaId, name: "Discovery", order: 1 },
    });

    await expect(
      updateMatter(
        matterId,
        updateMatterInitialState,
        updateForm({
          statuteOfLimitationsDate: "2027-01-01",
          court: "D. Colo.",
          stageId: stage2.id,
        })
      )
    ).rejects.toThrow(/__REDIRECT__/);

    const sol = await prisma.activityLog.findFirstOrThrow({
      where: { matterId, title: "Statute of limitations changed" },
    });
    expect(sol.detail).toBe("2026-06-01 → 2027-01-01");
    expect(sol.type).toBe("deadline");
    const updated = await prisma.activityLog.findFirstOrThrow({
      where: { matterId, title: "Matter updated" },
    });
    expect(updated.detail).toContain("court");
    expect(
      await prisma.activityLog.count({
        where: { matterId, title: "Stage moved: Intake → Discovery" },
      })
    ).toBe(1);
  });

  test("an unchanged save writes no audit noise", async () => {
    const { matterId } = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
    });
    await expect(
      updateMatter(
        matterId,
        updateMatterInitialState,
        updateForm({ name: "Test Matter", feeStructure: "hourly" })
      )
    ).rejects.toThrow(/__REDIRECT__/);
    expect(await prisma.activityLog.count({ where: { matterId } })).toBe(0);
  });
});
