/**
 * Integration tests for the lead conflict-check actions.
 *
 * Ethics-audit relevant rules pinned here:
 *   - a re-run NEVER clobbers a manual override (status stays
 *     "override" while conflictCheckedAt advances)
 *   - the linked Contact's identity is preferred over the legacy
 *     Lead columns, and the lead's own Contact is not a self-match
 *   - override needs a 5+ character justification, only applies to
 *     warn / conflict leads (a second override, or one on a
 *     clear / pending lead, is refused), stores the notes and logs
 *     them as the audit detail
 *   - both actions are gated on their own permission keys, and the
 *     audit rows name which lead they are about
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn().mockResolvedValue("test-user"),
}));

import { getCurrentUserId } from "@/lib/current-user";
import { requirePermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import {
  overrideLeadConflictCheck,
  runLeadConflictCheck,
} from "@/app/actions/conflict-check";
import {
  resetDb,
  seedContact,
  seedFirm,
  seedLead,
  seedMatter,
  seedMatterContact,
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
  ({ userId } = await seedUser({ firmId }));
  vi.mocked(getCurrentUserId).mockResolvedValue(userId);
  const area = await seedPracticeArea();
  ({ matterId } = await seedMatter({
    practiceAreaId: area.areaId,
    stageId: area.stageId,
    leadUserId: userId,
  }));
});

afterEach(() => {
  vi.clearAllMocks();
});

const overrideForm = (notes: string) => {
  const fd = new FormData();
  fd.set("notes", notes);
  return fd;
};

/** An opposing party "Roe" on the active matter, plus a lead of that name. */
async function seedConflictedLead(
  opts: { conflictCheck?: string } = {}
): Promise<string> {
  const roe = await seedContact({
    name: "John Roe",
    email: "roe@example.com",
    type: "opposing",
  });
  await seedMatterContact({
    matterId,
    contactId: roe.contactId,
    category: "opposing",
  });
  const { leadId } = await seedLead({ name: "John Roe", email: null });
  if (opts.conflictCheck) {
    await prisma.lead.update({
      where: { id: leadId },
      data: { conflictCheck: opts.conflictCheck },
    });
  }
  return leadId;
}

describe("runLeadConflictCheck", () => {
  test("persists severity + conflictCheckedAt and logs which lead it ran on", async () => {
    const leadId = await seedConflictedLead();

    const res = await runLeadConflictCheck(leadId);
    expect(res).toEqual({ ok: true, severity: "conflict" });

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.conflictCheck).toBe("conflict");
    expect(lead.conflictCheckedAt).not.toBeNull();

    const log = await prisma.activityLog.findFirstOrThrow({
      where: { title: { contains: "Conflict check run" } },
    });
    expect(log.matterId).toBeNull();
    expect(log.userId).toBe(userId);
    expect(log.title).toContain("John Roe");
    expect(log.title).toContain("conflict");
    expect(log.detail).toContain(`lead ${leadId}`);
  });

  test("a lead with no matches comes back clear", async () => {
    const { leadId } = await seedLead({ name: "Nobody Special" });
    expect(await runLeadConflictCheck(leadId)).toEqual({
      ok: true,
      severity: "clear",
    });
  });

  test("unknown lead → not found, nothing written", async () => {
    const res = await runLeadConflictCheck("nope");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
    expect(await prisma.activityLog.count()).toBe(0);
  });

  test("re-running keeps a manual override but still refreshes conflictCheckedAt", async () => {
    const leadId = await seedConflictedLead({ conflictCheck: "override" });
    const old = new Date("2020-01-01T00:00:00Z");
    await prisma.lead.update({
      where: { id: leadId },
      data: { conflictCheckedAt: old },
    });

    // The matcher still finds the conflict; the override must survive.
    const res = await runLeadConflictCheck(leadId);
    expect(res.ok).toBe(true);
    expect(res.severity).toBe("conflict");

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.conflictCheck).toBe("override");
    expect(lead.conflictCheckedAt!.getTime()).toBeGreaterThan(old.getTime());
  });

  test("prefers the linked Contact's identity over the legacy Lead columns", async () => {
    const roe = await seedContact({
      name: "John Roe",
      type: "opposing",
    });
    await seedMatterContact({
      matterId,
      contactId: roe.contactId,
      category: "opposing",
    });
    // The lead's own Contact carries the real name; the legacy column is stale.
    const own = await seedContact({ name: "John Roe" });
    const { leadId } = await seedLead({
      name: "Someone Else Entirely",
      contactId: own.contactId,
    });

    const res = await runLeadConflictCheck(leadId);
    expect(res.severity).toBe("conflict");
  });

  test("the lead's own Contact does not make it a self-match", async () => {
    const own = await seedContact({
      name: "Fresh Lead",
      email: "fresh@example.com",
    });
    const { leadId } = await seedLead({
      name: "Fresh Lead",
      contactId: own.contactId,
    });
    expect(await runLeadConflictCheck(leadId)).toEqual({
      ok: true,
      severity: "clear",
    });
  });

  test("another contact with the same email still flags the lead", async () => {
    const own = await seedContact({
      name: "Jessica Hale",
      email: "jhale@example.com",
    });
    await seedContact({ name: "J. Hale", email: "jhale@example.com" });
    const { leadId } = await seedLead({
      name: "Jessica Hale",
      email: "jhale@example.com",
      contactId: own.contactId,
    });

    const res = await runLeadConflictCheck(leadId);
    expect(res.severity).toBe("warn");
  });

  test("is gated on intake.conflict_check.run", async () => {
    const { leadId } = await seedLead();
    await runLeadConflictCheck(leadId);
    expect(requirePermission).toHaveBeenCalledWith("intake.conflict_check.run");
  });

  test("a denied gate stops before any read or write", async () => {
    const leadId = await seedConflictedLead();
    vi.mocked(requirePermission).mockRejectedValueOnce(new Error("forbidden"));
    await expect(runLeadConflictCheck(leadId)).rejects.toThrow("forbidden");
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.conflictCheckedAt).toBeNull();
  });
});

describe("overrideLeadConflictCheck", () => {
  test("flagged lead + justification → override, notes stored and logged as detail", async () => {
    const leadId = await seedConflictedLead({ conflictCheck: "conflict" });

    const res = await overrideLeadConflictCheck(
      leadId,
      overrideForm("Informed-consent waiver signed 2026-10-01")
    );
    expect(res).toEqual({ ok: true });

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.conflictCheck).toBe("override");
    expect(lead.conflictResolutionNotes).toBe(
      "Informed-consent waiver signed 2026-10-01"
    );

    const log = await prisma.activityLog.findFirstOrThrow({
      where: { title: { contains: "overridden" } },
    });
    expect(log.matterId).toBeNull();
    expect(log.userId).toBe(userId);
    expect(log.title).toContain("John Roe");
    expect(log.detail).toBe(
      `lead ${leadId}: Informed-consent waiver signed 2026-10-01`
    );
  });

  test("a warn lead can be overridden too", async () => {
    const leadId = await seedConflictedLead({ conflictCheck: "warn" });
    const res = await overrideLeadConflictCheck(leadId, overrideForm("Different person"));
    expect(res.ok).toBe(true);
  });

  test("justification under 5 characters is refused, lead untouched", async () => {
    const leadId = await seedConflictedLead({ conflictCheck: "conflict" });
    const res = await overrideLeadConflictCheck(leadId, overrideForm("  ok  "));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/5\+ characters/);

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.conflictCheck).toBe("conflict");
    expect(lead.conflictResolutionNotes).toBeNull();
    expect(await prisma.activityLog.count()).toBe(0);
  });

  test.each(["clear", "pending", "override"])(
    "a %s lead cannot be overridden",
    async (status) => {
      const leadId = await seedConflictedLead({ conflictCheck: status });
      const res = await overrideLeadConflictCheck(
        leadId,
        overrideForm("A perfectly good reason")
      );
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/flagged or conflicted/);

      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
      expect(lead.conflictCheck).toBe(status);
      expect(lead.conflictResolutionNotes).toBeNull();
    }
  );

  test("unknown lead → not found", async () => {
    const res = await overrideLeadConflictCheck(
      "nope",
      overrideForm("A perfectly good reason")
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });

  test("is gated on intake.conflict_check.override", async () => {
    const leadId = await seedConflictedLead({ conflictCheck: "warn" });
    await overrideLeadConflictCheck(leadId, overrideForm("A perfectly good reason"));
    expect(requirePermission).toHaveBeenCalledWith(
      "intake.conflict_check.override"
    );
  });
});
