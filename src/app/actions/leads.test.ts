/**
 * Integration tests for the lead convert / decline actions.
 *
 * Pins the three behaviors that used to be wrong:
 *
 *   - declineLead is gated by intake.decline and writes an
 *     ActivityLog entry (who declined + reason) — it used to be
 *     an ungated mutation with no audit trail.
 *   - convertLeadToMatter rejects inactive practice areas and
 *     inactive stages, mirroring the direct create path.
 *   - conversion carries the lead's dateOfIncident onto the matter,
 *     auto-computes the SOL date from the area's statutePeriodDays,
 *     and creates the auto-managed critical SOL Deadline — and does
 *     none of that for areas that don't track SOL.
 *
 * The permission gate itself is stubbed (its resolution logic is
 * covered elsewhere); we assert the actions *invoke* it with the
 * right key.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// convertLeadToMatter ends in redirect(); surface it as a sentinel
// throw so tests can assert "reached the redirect" = success.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn(),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));

import { getCurrentUserId } from "@/lib/current-user";
import { requirePermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import { convertLeadToMatter, declineLead } from "@/app/actions/leads";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";

const mockedGetUser = vi.mocked(getCurrentUserId);
const mockedRequirePermission = vi.mocked(requirePermission);

let userId: string;

/** Area + one stage, with full control over the flags the conversion
 *  path must respect (isActive, SOL tracking, statute period). */
async function seedArea(opts: {
  areaActive?: boolean;
  stageActive?: boolean;
  hasSol?: boolean;
  periodDays?: number | null;
}): Promise<{ areaId: string; stageId: string }> {
  const area = await prisma.practiceArea.create({
    data: {
      name: `Area ${Math.random().toString(36).slice(2, 8)}`,
      isActive: opts.areaActive ?? true,
      hasStatuteOfLimitations: opts.hasSol ?? false,
      statutePeriodDays: opts.periodDays ?? null,
    },
    select: { id: true },
  });
  const stage = await prisma.matterStage.create({
    data: {
      practiceAreaId: area.id,
      name: "Intake",
      order: 0,
      isActive: opts.stageActive ?? true,
    },
    select: { id: true },
  });
  return { areaId: area.id, stageId: stage.id };
}

async function seedIntakeLead(opts?: {
  dateOfIncident?: Date | null;
  stage?: string;
}): Promise<{ leadId: string }> {
  const lead = await prisma.lead.create({
    data: {
      name: "Priya Patel",
      email: "priya@example.com",
      dateOfIncident: opts?.dateOfIncident ?? null,
      stage: opts?.stage ?? "new",
    },
    select: { id: true },
  });
  return { leadId: lead.id };
}

function convertForm(opts: { areaId: string; stageId: string }): FormData {
  const fd = new FormData();
  fd.set("practiceAreaId", opts.areaId);
  fd.set("stageId", opts.stageId);
  fd.set("name", "Patel v. Doe");
  fd.set("feeStructure", "contingent");
  return fd;
}

function declineForm(reason = ""): FormData {
  const fd = new FormData();
  fd.set("reason", reason);
  return fd;
}

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  vi.clearAllMocks();
  await resetDb();
  const { firmId } = await seedFirm();
  const u = await seedUser({ firmId, email: "attorney@example.com" });
  userId = u.userId;
  mockedGetUser.mockResolvedValue(userId);
  // Gate passes by default; it returns the actor id like the real
  // implementation so declineLead can chain it into the audit log.
  mockedRequirePermission.mockResolvedValue(userId);
});

// ── declineLead ─────────────────────────────────────────────────────────

describe("declineLead", () => {
  test("is gated by intake.decline", async () => {
    const { leadId } = await seedIntakeLead();
    await declineLead(leadId, { status: "idle" }, declineForm());
    expect(mockedRequirePermission).toHaveBeenCalledWith("intake.decline");
  });

  test("marks the lead declined and stores the reason", async () => {
    const { leadId } = await seedIntakeLead();
    const res = await declineLead(
      leadId,
      { status: "idle" },
      declineForm("Statute already ran")
    );
    expect(res.status).toBe("ok");

    const lead = await prisma.lead.findUniqueOrThrow({
      where: { id: leadId },
      select: { stage: true, declineReason: true },
    });
    expect(lead.stage).toBe("declined");
    expect(lead.declineReason).toBe("Statute already ran");
  });

  test("writes an audit-trail ActivityLog entry with actor + reason", async () => {
    const { leadId } = await seedIntakeLead();
    await declineLead(
      leadId,
      { status: "idle" },
      declineForm("Conflict of interest")
    );

    const entry = await prisma.activityLog.findFirst({
      where: { title: "Lead declined" },
      select: { userId: true, detail: true, matterId: true },
    });
    expect(entry).not.toBeNull();
    expect(entry!.userId).toBe(userId);
    expect(entry!.detail).toBe("Conflict of interest");
    // Declined leads never got a matter — firm-scope entry.
    expect(entry!.matterId).toBeNull();
  });

  test("refuses to decline an already-converted lead", async () => {
    const { leadId } = await seedIntakeLead({ stage: "converted" });
    const res = await declineLead(leadId, { status: "idle" }, declineForm());
    expect(res.status).toBe("error");

    const lead = await prisma.lead.findUniqueOrThrow({
      where: { id: leadId },
      select: { stage: true },
    });
    expect(lead.stage).toBe("converted");
  });
});

// ── convertLeadToMatter ─────────────────────────────────────────────────

describe("convertLeadToMatter — active-target validation", () => {
  test("rejects an inactive practice area", async () => {
    const { areaId, stageId } = await seedArea({ areaActive: false });
    const { leadId } = await seedIntakeLead();

    const res = await convertLeadToMatter(
      leadId,
      { status: "idle" },
      convertForm({ areaId, stageId })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.practiceAreaId).toBeDefined();
    expect(await prisma.matter.count()).toBe(0);
  });

  test("rejects an inactive stage", async () => {
    const { areaId, stageId } = await seedArea({ stageActive: false });
    const { leadId } = await seedIntakeLead();

    const res = await convertLeadToMatter(
      leadId,
      { status: "idle" },
      convertForm({ areaId, stageId })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.stageId).toBeDefined();
    expect(await prisma.matter.count()).toBe(0);
  });
});

describe("convertLeadToMatter — SOL carry-over", () => {
  const incident = new Date("2024-01-15T00:00:00.000Z");

  test("SOL-tracking area: sets incidentDate, auto-computes SOL date, creates the critical SOL deadline", async () => {
    const { areaId, stageId } = await seedArea({
      hasSol: true,
      periodDays: 730,
    });
    const { leadId } = await seedIntakeLead({ dateOfIncident: incident });

    // Success path ends in redirect(`/matters/…`) — sentinel throw.
    await expect(
      convertLeadToMatter(
        leadId,
        { status: "idle" },
        convertForm({ areaId, stageId })
      )
    ).rejects.toThrow(/^REDIRECT:\/matters\//);

    const matter = await prisma.matter.findFirstOrThrow({
      select: {
        id: true,
        incidentDate: true,
        statuteOfLimitationsDate: true,
      },
    });
    expect(matter.incidentDate).toEqual(incident);
    // 2024-01-15 + 730 days (365-day-year convention) = 2026-01-14.
    expect(matter.statuteOfLimitationsDate).toEqual(
      new Date("2026-01-14T00:00:00.000Z")
    );

    const deadline = await prisma.deadline.findFirstOrThrow({
      where: { matterId: matter.id, sourceType: "statute_of_limitations" },
      select: {
        title: true,
        kind: true,
        status: true,
        dueDate: true,
        ownerId: true,
      },
    });
    expect(deadline.title).toBe("Statute of limitations");
    expect(deadline.kind).toBe("critical");
    expect(deadline.status).toBe("open");
    expect(deadline.dueDate).toEqual(matter.statuteOfLimitationsDate);
    // Converting user owns the deadline (they're the lead attorney).
    expect(deadline.ownerId).toBe(userId);
  });

  test("non-SOL area: incident date stays in the description only, no SOL fields, no deadline", async () => {
    const { areaId, stageId } = await seedArea({
      hasSol: false,
      periodDays: 730, // stale config must be ignored when tracking is off
    });
    const { leadId } = await seedIntakeLead({ dateOfIncident: incident });

    await expect(
      convertLeadToMatter(
        leadId,
        { status: "idle" },
        convertForm({ areaId, stageId })
      )
    ).rejects.toThrow(/^REDIRECT:/);

    const matter = await prisma.matter.findFirstOrThrow({
      select: {
        incidentDate: true,
        statuteOfLimitationsDate: true,
        description: true,
      },
    });
    expect(matter.incidentDate).toBeNull();
    expect(matter.statuteOfLimitationsDate).toBeNull();
    expect(matter.description).toContain("Date of incident: 2024-01-15");
    expect(await prisma.deadline.count()).toBe(0);
  });

  test("SOL area but lead has no incident date: converts cleanly with no deadline", async () => {
    const { areaId, stageId } = await seedArea({
      hasSol: true,
      periodDays: 730,
    });
    const { leadId } = await seedIntakeLead({ dateOfIncident: null });

    await expect(
      convertLeadToMatter(
        leadId,
        { status: "idle" },
        convertForm({ areaId, stageId })
      )
    ).rejects.toThrow(/^REDIRECT:/);

    const matter = await prisma.matter.findFirstOrThrow({
      select: { incidentDate: true, statuteOfLimitationsDate: true },
    });
    expect(matter.incidentDate).toBeNull();
    expect(matter.statuteOfLimitationsDate).toBeNull();
    expect(await prisma.deadline.count()).toBe(0);
  });
});
