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
 *   - Deactivated users can't be assigned as lead attorney — both
 *     create and update fall back to the current user, matching
 *     addMatterTeamMember's active-user guard.
 *
 * Auth + permission gates are stubbed; the gate itself is covered in
 * `permission-check.integration.test.ts`.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

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
import { createMatter, updateMatter } from "@/app/actions/matters";
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

    await expect(
      updateMatter(
        matterId,
        updateMatterInitialState,
        updateForm({ leadUserId: inactive.userId })
      )
    ).rejects.toThrow(/__REDIRECT__/);

    // Fallback keeps the current user as lead; the deactivated user
    // never joins the team.
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
});
