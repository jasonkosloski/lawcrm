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
 *   - Team changes keep the one-lead invariant (re-adding the active
 *     lead at another role is refused; same-role re-adds are no-ops);
 *     stage changes gate unusual moves behind a confirmation and are
 *     audited; an inline new client is stamped with the firm.
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
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

import { getCurrentUserId } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { dateOnlyKey } from "@/lib/format-date";
import {
  currentUserHasPermission,
  requirePermission,
} from "@/lib/permission-check";
import {
  addMatterTeamMember,
  createMatter,
  removeMatterTeamMember,
  setMatterSolSatisfied,
  updateMatter,
  updateMatterStage,
} from "@/app/actions/matters";
import {
  NEW_CLIENT_SENTINEL,
  createMatterInitialState,
  updateMatterInitialState,
} from "@/lib/new-matter-constants";
import {
  resetDb,
  seedContact,
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
      data: {
        statutePeriodAmount: days,
        statutePeriodUnit: days ? "DAYS" : null,
      },
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

// ── updateMatter: area stopped tracking SOL (F113) ──────────────────────

describe("updateMatter when the area no longer tracks SOL", () => {
  const seedSolMatter = async () => {
    const { matterId } = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
    });
    await prisma.matter.update({
      where: { id: matterId },
      data: {
        incidentDate: new Date("2025-01-10"),
        statuteOfLimitationsDate: new Date("2027-01-10"),
        statuteOfLimitationsNotes: "check tolling",
      },
    });
    await prisma.deadline.create({
      data: {
        matterId,
        title: "Statute of limitations",
        dueDate: new Date("2027-01-10"),
        kind: "critical",
        sourceType: SOL_SOURCE_TYPE,
      },
    });
    return matterId;
  };

  test("an unrelated edit keeps the SOL date, notes and critical deadline", async () => {
    const matterId = await seedSolMatter();
    // Admin untracks SOL on the area afterwards.
    await prisma.practiceArea.update({
      where: { id: areaId },
      data: { hasStatuteOfLimitations: false },
    });

    await expect(
      updateMatter(
        matterId,
        updateMatterInitialState,
        updateForm({ caseNumber: "24-CV-100" })
      )
    ).rejects.toThrow(/__REDIRECT__/);

    const m = await prisma.matter.findUniqueOrThrow({
      where: { id: matterId },
    });
    expect(m.caseNumber).toBe("24-CV-100");
    expect(m.statuteOfLimitationsDate?.toISOString().slice(0, 10)).toBe(
      "2027-01-10"
    );
    expect(m.incidentDate?.toISOString().slice(0, 10)).toBe("2025-01-10");
    expect(m.statuteOfLimitationsNotes).toBe("check tolling");
    expect(
      await prisma.deadline.count({
        where: { matterId, sourceType: SOL_SOURCE_TYPE },
      })
    ).toBe(1);
  });

  test("switching to a non-SOL area keeps the SOL data and deadline (never silently wiped)", async () => {
    // F278/F313: losing a statute date because someone re-categorised a
    // matter is the worse failure — the data stays until a person
    // removes it deliberately.
    const matterId = await seedSolMatter();
    const other = await seedPracticeArea({ hasStatuteOfLimitations: false });

    await expect(
      updateMatter(
        matterId,
        updateMatterInitialState,
        updateForm({ practiceAreaId: other.areaId, stageId: other.stageId })
      )
    ).rejects.toThrow(/__REDIRECT__/);

    const m = await prisma.matter.findUniqueOrThrow({
      where: { id: matterId },
    });
    expect(m.practiceAreaId).toBe(other.areaId);
    expect(m.statuteOfLimitationsDate?.toISOString().slice(0, 10)).toBe(
      "2027-01-10"
    );
    expect(m.statuteOfLimitationsNotes).toBe("check tolling");
    expect(
      await prisma.deadline.count({
        where: { matterId, sourceType: SOL_SOURCE_TYPE },
      })
    ).toBe(1);
  });
});

// ── Inline client firm stamping (F756) ──────────────────────────────────

describe("createMatter inline client", () => {
  test("the new Contact is stamped with the creator's firmId", async () => {
    await expect(
      createMatter(
        createMatterInitialState,
        createForm({
          clientId: NEW_CLIENT_SENTINEL,
          newClientName: "Jane Doe",
          newClientEmail: "jane@example.com",
        })
      )
    ).rejects.toThrow(/__REDIRECT__/);
    const contact = await prisma.contact.findFirstOrThrow({
      where: { name: "Jane Doe" },
      select: { firmId: true, type: true },
    });
    expect(contact).toEqual({ firmId, type: "client" });
  });
});

// ── Conflict gate on create (ADR-054) ──────────────────────────────────

describe("createMatter — conflict gate", () => {
  /** An active matter whose client is `name` (so naming them as the
   *  adverse party is a hard conflict). */
  const seedClientOnMatter = async (name: string) => {
    const c = await seedContact({ name, type: "client" });
    const m = await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: userId });
    await prisma.matter.update({ where: { id: m.matterId }, data: { clientId: c.contactId } });
    return m.matterId;
  };
  const created = () => prisma.matter.count({ where: { name: "Doe v. Acme" } });

  test("a clear check creates silently (no conflict timeline row)", async () => {
    await expect(
      createMatter(createMatterInitialState, createForm({ opposingParty: "Nobody Known" }))
    ).rejects.toThrow(/__REDIRECT__/);
    const rows = await prisma.activityLog.count({
      where: { title: { startsWith: "Created with conflict check" } },
    });
    expect(rows).toBe(0);
  });

  test("possible conflicts block until acknowledged, then log 'warn (reviewed)'", async () => {
    await seedContact({ name: "Jane Doe", type: "witness" });
    const first = await createMatter(
      createMatterInitialState,
      createForm({
        clientId: NEW_CLIENT_SENTINEL,
        newClientName: "Jane Doe",
        newClientEmail: "jane@example.com",
      })
    );
    expect(first.conflict?.severity).toBe("warn");
    expect(first.values?.newClientName).toBe("Jane Doe");
    expect(await created()).toBe(0);

    await expect(
      createMatter(
        first,
        createForm({
          clientId: NEW_CLIENT_SENTINEL,
          newClientName: "Jane Doe",
          newClientEmail: "jane@example.com",
          conflictAck: first.conflict!.fingerprint,
        })
      )
    ).rejects.toThrow(/__REDIRECT__/);
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { title: "Created with conflict check: warn (reviewed)" },
      select: { detail: true },
    });
    expect(log.detail).toBe("1 possible conflict acknowledged");
  });

  test("a stale acknowledgement says the results changed", async () => {
    await seedContact({ name: "Jane Doe", type: "witness" });
    const res = await createMatter(
      createMatterInitialState,
      createForm({
        clientId: NEW_CLIENT_SENTINEL,
        newClientName: "Jane Doe",
        newClientEmail: "jane@example.com",
        conflictAck: "earlier-fingerprint",
      })
    );
    expect(res.errors?.conflictAck?.[0]).toMatch(/changed/);
  });

  test("a client merged away since the form loaded resolves to the survivor", async () => {
    const survivor = await seedContact({ name: "Survivor Client" });
    const gone = await seedContact({ name: "Gone Client" });
    await prisma.contact.update({
      where: { id: gone.contactId },
      data: { mergedIntoId: survivor.contactId },
    });
    await expect(
      createMatter(createMatterInitialState, createForm({ clientId: gone.contactId }))
    ).rejects.toThrow(/__REDIRECT__/);
    const m = await prisma.matter.findFirstOrThrow({ select: { clientId: true } });
    expect(m.clientId).toBe(survivor.contactId);
  });

  test("an acknowledgement of a different result does not pass", async () => {
    await seedContact({ name: "Jane Doe", type: "witness" });
    const res = await createMatter(
      createMatterInitialState,
      createForm({
        clientId: NEW_CLIENT_SENTINEL,
        newClientName: "Jane Doe",
        newClientEmail: "jane@example.com",
        conflictAck: "stale-fingerprint",
      })
    );
    expect(res.conflict?.severity).toBe("warn");
    expect(await created()).toBe(0);
  });

  test("an adverse party who is a current client is a conflict; no override key → blocked", async () => {
    await seedClientOnMatter("Acme Holdings");
    vi.mocked(currentUserHasPermission).mockImplementation(
      async (key) => key !== "intake.conflict_check.override"
    );
    const first = await createMatter(
      createMatterInitialState,
      createForm({ opposingParty: "Acme Holdings" })
    );
    expect(first.conflict).toMatchObject({ severity: "conflict", canOverride: false });
    expect(first.conflict!.matches[0].description).toMatch(/current client/);

    // Even with the fingerprint and a reason, no key means no matter.
    const again = await createMatter(
      first,
      createForm({
        opposingParty: "Acme Holdings",
        conflictAck: first.conflict!.fingerprint,
        conflictOverrideReason: "Waiver signed by both clients",
      })
    );
    expect(again.conflict?.canOverride).toBe(false);
    expect(await created()).toBe(0);
  });

  test("override needs a 5+ character justification, then logs it on the matter", async () => {
    await seedClientOnMatter("Acme Holdings");
    const first = await createMatter(
      createMatterInitialState,
      createForm({ opposingParty: "Acme Holdings" })
    );
    expect(first.conflict).toMatchObject({ severity: "conflict", canOverride: true });

    const short = await createMatter(
      first,
      createForm({
        opposingParty: "Acme Holdings",
        conflictAck: first.conflict!.fingerprint,
        conflictOverrideReason: "ok",
      })
    );
    expect(short.errors?.conflictOverrideReason?.[0]).toMatch(/5\+ characters/);
    expect(await created()).toBe(0);

    await expect(
      createMatter(
        short,
        createForm({
          opposingParty: "Acme Holdings",
          conflictAck: first.conflict!.fingerprint,
          conflictOverrideReason: "Informed-consent waiver signed",
        })
      )
    ).rejects.toThrow(/__REDIRECT__/);
    const matter = await prisma.matter.findFirstOrThrow({
      where: { name: "Doe v. Acme" },
      select: { id: true },
    });
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { matterId: matter.id, title: "Created with conflict check: override" },
      select: { detail: true },
    });
    expect(log.detail).toBe("1 match overridden: Informed-consent waiver signed");
  });

  test("an existing client picked on the form does not match itself", async () => {
    const c = await seedContact({ name: "Repeat Client", email: "r@example.com" });
    await expect(
      createMatter(createMatterInitialState, createForm({ clientId: c.contactId }))
    ).rejects.toThrow(/__REDIRECT__/);
  });
});

// ── Extra team seats on create ─────────────────────────────────────────

describe("createMatter — extra team members", () => {
  let paraId: string;
  beforeEach(async () => {
    paraId = (await seedUser({ firmId, email: "para@example.com", name: "Pat Para" })).userId;
  });
  const teamOf = async () => {
    const m = await prisma.matter.findFirstOrThrow({
      select: { teamMembers: { select: { userId: true, role: true } } },
    });
    return m.teamMembers;
  };

  test("seats land with the lead; the member is notified and it's logged", async () => {
    await expect(
      createMatter(
        createMatterInitialState,
        createForm({
          extraTeam: JSON.stringify([
            { userId: paraId, role: "paralegal" },
            { userId: userId, role: "co_counsel" }, // the lead: dropped
            { userId: paraId, role: "investigator" }, // duplicate: dropped
          ]),
        })
      )
    ).rejects.toThrow(/__REDIRECT__/);
    expect(await teamOf()).toEqual(
      expect.arrayContaining([
        { userId, role: "lead" },
        { userId: paraId, role: "paralegal" },
      ])
    );
    expect(await teamOf()).toHaveLength(2);
    expect(
      await prisma.notification.count({ where: { userId: paraId, type: "matter_assigned" } })
    ).toBe(1);
    expect(
      await prisma.activityLog.count({ where: { title: "Pat Para added to team as Paralegal" } })
    ).toBe(1);
  });

  test("without matters.manage_team, extra seats are refused and nothing is written", async () => {
    vi.mocked(currentUserHasPermission).mockImplementation(
      async (key) => key !== "matters.manage_team"
    );
    const res = await createMatter(
      createMatterInitialState,
      createForm({ extraTeam: JSON.stringify([{ userId: paraId, role: "paralegal" }]) })
    );
    expect(res.errors?.extraTeam?.[0]).toMatch(/permission/);
    expect(await prisma.matter.count()).toBe(0);
  });

  test("an inactive user or a lead role is refused", async () => {
    await prisma.user.update({ where: { id: paraId }, data: { isActive: false } });
    const inactive = await createMatter(
      createMatterInitialState,
      createForm({ extraTeam: JSON.stringify([{ userId: paraId, role: "paralegal" }]) })
    );
    expect(inactive.errors?.extraTeam?.[0]).toMatch(/no longer active/);

    const asLead = await createMatter(
      createMatterInitialState,
      createForm({ extraTeam: JSON.stringify([{ userId: paraId, role: "lead" }]) })
    );
    expect(asLead.errors?.extraTeam).toBeDefined();
    expect(await prisma.matter.count()).toBe(0);
  });
});

// ── Team membership (F758) ──────────────────────────────────────────────

describe("addMatterTeamMember / removeMatterTeamMember", () => {
  let matterId: string;
  let other: string;

  const teamForm = (userIdValue: string, role: string) => {
    const fd = new FormData();
    fd.set("userId", userIdValue);
    fd.set("role", role);
    return fd;
  };

  const activeLeads = () =>
    prisma.matterTeamMember.findMany({
      where: { matterId, role: "lead", removedAt: null },
      select: { userId: true },
    });

  beforeEach(async () => {
    ({ matterId } = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
    }));
    ({ userId: other } = await seedUser({ firmId, name: "Dana Other" }));
  });

  test("re-adding the ACTIVE lead at another role is refused: the matter keeps its lead", async () => {
    const res = await addMatterTeamMember(
      matterId,
      teamForm(userId, "paralegal")
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/lead attorney/i);
    expect(await activeLeads()).toEqual([{ userId }]);
    expect(
      await prisma.activityLog.count({ where: { title: { contains: "added to team" } } })
    ).toBe(0);
  });

  test("adding someone already on the team at the same role is a no-op (no log, no notification)", async () => {
    const first = await addMatterTeamMember(matterId, teamForm(other, "paralegal"));
    expect(first.ok).toBe(true);
    const logs = () =>
      prisma.activityLog.count({ where: { title: { contains: "added to team" } } });
    const notes = () => prisma.notification.count({ where: { userId: other } });
    expect(await logs()).toBe(1);
    expect(await notes()).toBe(1);

    const again = await addMatterTeamMember(matterId, teamForm(other, "paralegal"));
    expect(again.ok).toBe(true);
    expect(await logs()).toBe(1);
    expect(await notes()).toBe(1);
  });

  test("an active non-lead can be moved to another role, and promoted to lead (old lead -> co_counsel)", async () => {
    await addMatterTeamMember(matterId, teamForm(other, "paralegal"));
    const moved = await addMatterTeamMember(matterId, teamForm(other, "co_counsel"));
    expect(moved.ok).toBe(true);

    const promoted = await addMatterTeamMember(matterId, teamForm(other, "lead"));
    expect(promoted.ok).toBe(true);
    expect(await activeLeads()).toEqual([{ userId: other }]);
    const old = await prisma.matterTeamMember.findUniqueOrThrow({
      where: { matterId_userId: { matterId, userId } },
    });
    expect(old.role).toBe("co_counsel");
  });

  test("a removed member can be restored at a new role", async () => {
    await addMatterTeamMember(matterId, teamForm(other, "paralegal"));
    const row = await prisma.matterTeamMember.findUniqueOrThrow({
      where: { matterId_userId: { matterId, userId: other } },
    });
    expect((await removeMatterTeamMember(matterId, row.id)).ok).toBe(true);

    const back = await addMatterTeamMember(matterId, teamForm(other, "co_counsel"));
    expect(back.ok).toBe(true);
    const restored = await prisma.matterTeamMember.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(restored.removedAt).toBeNull();
    expect(restored.role).toBe("co_counsel");
  });

  test("removing a member detaches them from upcoming auto-added events only (F746)", async () => {
    await addMatterTeamMember(matterId, teamForm(other, "paralegal"));
    const row = await prisma.matterTeamMember.findUniqueOrThrow({
      where: { matterId_userId: { matterId, userId: other } },
    });
    const day = 24 * 60 * 60 * 1000;
    const mk = (title: string, offset: number, extra: object = {}) =>
      prisma.calendarEvent.create({
        data: {
          matterId,
          title,
          startTime: new Date(Date.now() + offset),
          endTime: new Date(Date.now() + offset + 3600_000),
          ...extra,
        },
      });
    const future = await mk("Future", 5 * day);
    const past = await mk("Past", -5 * day);
    const theirs = await mk("Theirs", 6 * day, { createdById: other });
    const otherMatter = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
    });
    const elsewhere = await prisma.calendarEvent.create({
      data: {
        matterId: otherMatter.matterId,
        title: "Elsewhere",
        startTime: new Date(Date.now() + 7 * day),
        endTime: new Date(Date.now() + 7 * day + 3600_000),
      },
    });
    for (const e of [future, past, theirs, elsewhere]) {
      await prisma.calendarAttendee.create({
        data: {
          eventId: e.id,
          userId: other,
          name: "Dana Other",
          status: "accepted",
        },
      });
    }

    expect((await removeMatterTeamMember(matterId, row.id)).ok).toBe(true);

    const left = await prisma.calendarAttendee.findMany({
      where: { userId: other },
      select: { eventId: true },
    });
    expect(left.map((a) => a.eventId).sort()).toEqual(
      [past.id, theirs.id, elsewhere.id].sort()
    );
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { title: { contains: "removed from team" } },
    });
    expect(log.detail).toBe("Removed from 1 upcoming event");
  });

  test("removeMatterTeamMember refuses to remove the lead", async () => {
    const lead = await prisma.matterTeamMember.findFirstOrThrow({
      where: { matterId, role: "lead" },
    });
    const res = await removeMatterTeamMember(matterId, lead.id);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/lead attorney/i);
    expect(await activeLeads()).toEqual([{ userId }]);
  });

  test("a deactivated user can't be added", async () => {
    const { userId: gone } = await seedUser({ firmId, isActive: false });
    const res = await addMatterTeamMember(matterId, teamForm(gone, "paralegal"));
    expect(res.ok).toBe(false);
  });

  test("both are gated on matters.manage_team", async () => {
    await addMatterTeamMember(matterId, teamForm(other, "paralegal"));
    expect(requirePermission).toHaveBeenCalledWith("matters.manage_team");
  });
});

// ── Stage changes ───────────────────────────────────────────────────────

describe("updateMatterStage", () => {
  let matterId: string;
  let s1: string;
  let s2: string;
  let closed: string;

  beforeEach(async () => {
    ({ matterId } = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
    }));
    s1 = stageId;
    s2 = (
      await prisma.matterStage.create({
        data: { practiceAreaId: areaId, name: "Discovery", order: 1 },
      })
    ).id;
    closed = (
      await prisma.matterStage.create({
        data: {
          practiceAreaId: areaId,
          name: "Closed",
          order: 9,
          isTerminal: true,
        },
      })
    ).id;
  });

  const stageOf = async () =>
    (await prisma.matter.findUniqueOrThrow({ where: { id: matterId } })).stageId;

  test("moves forward and writes a 'Stage moved' audit row", async () => {
    expect(await updateMatterStage(matterId, s2)).toEqual({ ok: true });
    expect(await stageOf()).toBe(s2);
    const log = await prisma.activityLog.findFirstOrThrow({ where: { matterId } });
    expect(log.title).toBe("Stage moved: Intake → Discovery");
  });

  test("same-stage is a quiet no-op", async () => {
    expect(await updateMatterStage(matterId, s1)).toEqual({ ok: true });
    expect(await prisma.activityLog.count()).toBe(0);
  });

  test("reopening a closed matter needs confirmation; force reopens and logs it", async () => {
    await updateMatterStage(matterId, closed);
    const asked = await updateMatterStage(matterId, s1);
    expect(asked.ok).toBe(false);
    expect(asked.requiresConfirmation).toBe(true);
    expect(await stageOf()).toBe(closed);

    expect(await updateMatterStage(matterId, s1, { force: true })).toEqual({
      ok: true,
    });
    expect(await stageOf()).toBe(s1);
    const titles = (
      await prisma.activityLog.findMany({ where: { matterId } })
    ).map((l) => l.title);
    expect(titles).toContain("Reopened from Closed → Intake");
  });

  test("a stage from another practice area is refused", async () => {
    const other = await seedPracticeArea({ name: "Other area" });
    const res = await updateMatterStage(matterId, other.stageId);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/practice area/);
    expect(await stageOf()).toBe(s1);
  });

  test("unknown matter / inactive stage are refused; gated on matters.edit", async () => {
    await expect(updateMatterStage("nope", s2)).rejects.toThrow(
      /NEXT_HTTP_ERROR_FALLBACK|NEXT_NOT_FOUND/
    );
    await prisma.matterStage.update({ where: { id: s2 }, data: { isActive: false } });
    expect((await updateMatterStage(matterId, s2)).ok).toBe(false);
    expect(requirePermission).toHaveBeenCalledWith("matters.edit");
  });
});

// ── Incident date → dependent deadlines (ADR-040) ───────────────────────

describe("updateMatter — incident date change needs confirmation for dependent deadlines", () => {
  async function seedIncidentMatter() {
    const { matterId } = await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: userId });
    await prisma.matter.update({
      where: { id: matterId },
      data: { incidentDate: new Date("2026-03-10T00:00:00Z") },
    });
    const rule = await prisma.deadlineRule.create({
      data: { title: "CGIA notice", anchor: "incident_date", offsetDays: 182 },
    });
    const notice = await prisma.deadline.create({
      data: {
        matterId,
        title: "CGIA notice",
        dueDate: new Date("2026-09-08T00:00:00Z"),
        kind: "critical",
        status: "open",
        deadlineRuleId: rule.id,
      },
    });
    return { matterId, noticeId: notice.id };
  }
  const due = async (id: string) =>
    dateOnlyKey((await prisma.deadline.findUniqueOrThrow({ where: { id } })).dueDate);

  test("first save writes nothing and returns the deadlines that would move", async () => {
    const { matterId, noticeId } = await seedIncidentMatter();
    const res = await updateMatter(matterId, updateMatterInitialState, updateForm({ incidentDate: "2026-03-20" }));
    expect(res.status).toBe("confirm");
    expect(res.cascade?.map((c) => [c.title, c.fromKey, c.toKey, c.anchorText])).toEqual([
      ["CGIA notice", "2026-09-08", "2026-09-18", "Incident date"],
    ]);
    // Nothing saved — not even the incident date.
    const m = await prisma.matter.findUniqueOrThrow({ where: { id: matterId } });
    expect(dateOnlyKey(m.incidentDate!)).toBe("2026-03-10");
    expect(await due(noticeId)).toBe("2026-09-08");
  });

  test("apply saves the matter and moves the ticked deadline", async () => {
    const { matterId, noticeId } = await seedIncidentMatter();
    const fd = updateForm({ incidentDate: "2026-03-20", cascadeDecision: "apply" });
    fd.append("cascadeId", noticeId);
    await expect(updateMatter(matterId, updateMatterInitialState, fd)).rejects.toThrow(/__REDIRECT__/);
    expect(await due(noticeId)).toBe("2026-09-18");
    const log = await prisma.activityLog.findFirstOrThrow({ where: { matterId, title: "Deadline recalculated" } });
    expect(log.detail).toMatch(/after the incident date changed/);
  });

  test("skip saves the matter and leaves the deadline", async () => {
    const { matterId, noticeId } = await seedIncidentMatter();
    await expect(
      updateMatter(matterId, updateMatterInitialState, updateForm({ incidentDate: "2026-03-20", cascadeDecision: "skip" }))
    ).rejects.toThrow(/__REDIRECT__/);
    const m = await prisma.matter.findUniqueOrThrow({ where: { id: matterId } });
    expect(dateOnlyKey(m.incidentDate!)).toBe("2026-03-20");
    expect(await due(noticeId)).toBe("2026-09-08");
  });

  test("an unchanged incident date never asks", async () => {
    const { matterId } = await seedIncidentMatter();
    await expect(
      updateMatter(matterId, updateMatterInitialState, updateForm({ incidentDate: "2026-03-10" }))
    ).rejects.toThrow(/__REDIRECT__/);
  });
});
