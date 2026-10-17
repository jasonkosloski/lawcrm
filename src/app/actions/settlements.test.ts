/**
 * Integration tests for the settlement action layer.
 *
 * Covers:
 *   - upsertSettlement seeds the 4 default approval steps on
 *     create; subsequent calls update without re-seeding.
 *   - setApprovalStepStatus auto-promotes the settlement to
 *     "approved" once every step approved; refuses on
 *     disbursed/closed.
 *   - addSettlementLien / updateSettlementLien refuse on
 *     disbursed/closed settlements.
 *   - setApprovalStepStatus notification fan-out: approvals ping
 *     the matter's active team (minus the actor) with the next
 *     pending step; rejections ping the matter lead(s); repeats
 *     and resets stay silent.
 *
 * Auth + permission gates are module-mocked so the tests focus
 * on the action's business logic. Permission semantics are
 * covered separately in `permission-check.test.ts`.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  // Settlement tests assume the user has every permission. The
  // permission gate's own correctness is tested in its own file.
  requirePermission: vi.fn().mockResolvedValue("test-user"),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));

import { getCurrentUserId } from "@/lib/current-user";
import { currentUserHasPermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import {
  addSettlementLien,
  setApprovalStepStatus,
  updateSettlementLien,
  upsertSettlement,
} from "@/app/actions/settlements";
import { settlementInitialState } from "@/lib/settlement-constants";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

const mockedGetUser = vi.mocked(getCurrentUserId);
const mockedHasPermission = vi.mocked(currentUserHasPermission);

/** Give `userIds` a role carrying matters.settlement.view — the
 *  approval notifications only reach members who hold it. */
async function grantSettlementView(userIds: string[]): Promise<void> {
  const role = await prisma.role.create({
    data: { firmId, name: `Settlement viewer ${Math.random()}` },
  });
  await prisma.rolePermission.create({
    data: { roleId: role.id, permission: "matters.settlement.view" },
  });
  await prisma.userRole.createMany({
    data: userIds.map((userId) => ({ userId, roleId: role.id })),
  });
}

let firmId: string;
let userId: string;
let matterId: string;

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const f = await seedFirm();
  firmId = f.firmId;
  const u = await seedUser({ firmId, name: "Test Attorney" });
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

const buildUpsertForm = (opts: {
  gross: string;
  feePct?: string;
  costs?: string;
  status?: string;
}): FormData => {
  const fd = new FormData();
  fd.set("grossAmount", opts.gross);
  fd.set("firmFeePercent", opts.feePct ?? "33.33");
  fd.set("firmFee", "");
  fd.set("advancedCosts", opts.costs ?? "0");
  fd.set("status", opts.status ?? "pending");
  return fd;
};

describe("upsertSettlement — seeding", () => {
  test("create seeds 4 approval steps with the canonical labels", async () => {
    const fd = buildUpsertForm({ gross: "100000" });
    const res = await upsertSettlement(matterId, settlementInitialState, fd);
    expect(res.status).toBe("ok");

    const settlement = await prisma.settlement.findFirst({
      where: { matterId },
      include: { approvals: { orderBy: { step: "asc" } } },
    });
    expect(settlement).not.toBeNull();
    expect(settlement!.approvals).toHaveLength(4);
    expect(settlement!.approvals.map((a) => a.step)).toEqual([1, 2, 3, 4]);
    expect(settlement!.approvals[0]!.label).toBe("Client release signed");
    expect(settlement!.approvals[1]!.label).toBe(
      "Lien negotiations finalized"
    );
    expect(settlement!.approvals[2]!.label).toBe("Partner sign-off");
    expect(settlement!.approvals[3]!.label).toBe(
      "Trust ledger reconciliation"
    );
    // Every step starts pending.
    expect(
      settlement!.approvals.every((a) => a.status === "pending")
    ).toBe(true);
  });

  test("update doesn't re-seed approvals (preserves existing chain)", async () => {
    // First create.
    await upsertSettlement(
      matterId,
      settlementInitialState,
      buildUpsertForm({ gross: "100000" })
    );
    const settlementBefore = await prisma.settlement.findFirst({
      where: { matterId },
      include: { approvals: true },
    });
    const approvalIds = settlementBefore!.approvals.map((a) => a.id).sort();
    expect(approvalIds).toHaveLength(4);

    // Update gross (pending settlement, status unchanged).
    const res = await upsertSettlement(
      matterId,
      settlementInitialState,
      buildUpsertForm({ gross: "150000" })
    );
    expect(res.status).toBe("ok");

    const settlementAfter = await prisma.settlement.findFirst({
      where: { matterId },
      include: { approvals: true },
    });
    // Same row, same approval ids — no duplicates.
    expect(settlementAfter!.id).toBe(settlementBefore!.id);
    expect(settlementAfter!.approvals.map((a) => a.id).sort()).toEqual(
      approvalIds
    );
    expect(settlementAfter!.grossAmount.toNumber()).toBe(150000);
    expect(settlementAfter!.status).toBe("pending");
  });

  test("stores the percent-derived firm fee (33.33% of 100k = 33330)", async () => {
    await upsertSettlement(
      matterId,
      settlementInitialState,
      buildUpsertForm({ gross: "100000", feePct: "33.33" })
    );
    const s = await prisma.settlement.findFirst({ where: { matterId } });
    expect(s!.firmFee.toNumber()).toBe(33330);
  });

  // Half-cent rounding, 0% and the percent message: see
  // settlements-integrity.test.ts.
});

describe("setApprovalStepStatus — chain transitions", () => {
  beforeEach(async () => {
    await upsertSettlement(
      matterId,
      settlementInitialState,
      buildUpsertForm({ gross: "100000" })
    );
  });

  test("approving 3 of 4 doesn't auto-promote the settlement", async () => {
    const approvals = await prisma.settlementApproval.findMany({
      where: { settlement: { matterId } },
      orderBy: { step: "asc" },
    });
    for (let i = 0; i < 3; i++) {
      await setApprovalStepStatus(approvals[i]!.id, "approved");
    }
    const s = await prisma.settlement.findFirst({ where: { matterId } });
    expect(s!.status).toBe("pending");
  });

  test("approving the final step auto-promotes the settlement to 'approved'", async () => {
    const approvals = await prisma.settlementApproval.findMany({
      where: { settlement: { matterId } },
      orderBy: { step: "asc" },
    });
    for (const a of approvals) {
      const res = await setApprovalStepStatus(a.id, "approved");
      expect(res.ok).toBe(true);
    }
    const s = await prisma.settlement.findFirst({ where: { matterId } });
    expect(s!.status).toBe("approved");
  });

  test("approve snapshots approverId + approvedAt; reject clears them", async () => {
    const approvals = await prisma.settlementApproval.findMany({
      where: { settlement: { matterId } },
      orderBy: { step: "asc" },
    });
    const target = approvals[0]!;
    await setApprovalStepStatus(target.id, "approved", "Verified by phone");
    let row = await prisma.settlementApproval.findUnique({
      where: { id: target.id },
    });
    expect(row!.status).toBe("approved");
    expect(row!.approverId).toBe(userId);
    expect(row!.approvedAt).not.toBeNull();
    expect(row!.notes).toBe("Verified by phone");

    await setApprovalStepStatus(target.id, "rejected", "Need more info");
    row = await prisma.settlementApproval.findUnique({
      where: { id: target.id },
    });
    expect(row!.status).toBe("rejected");
    expect(row!.approverId).toBeNull();
    expect(row!.approvedAt).toBeNull();
    expect(row!.notes).toBe("Need more info");
  });

  test("refuses when the settlement is already disbursed or closed", async () => {
    // Force the settlement into a disbursed state.
    await prisma.settlement.updateMany({
      where: { matterId },
      data: { status: "disbursed" },
    });
    const approval = await prisma.settlementApproval.findFirst({
      where: { settlement: { matterId } },
    });
    const res = await setApprovalStepStatus(approval!.id, "approved");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/disbursed|closed/i);
  });

  test("'reset' (pending) clears approverId on a previously-approved step", async () => {
    const approval = await prisma.settlementApproval.findFirst({
      where: { settlement: { matterId } },
    });
    await setApprovalStepStatus(approval!.id, "approved", "ok");
    await setApprovalStepStatus(approval!.id, "pending");
    const row = await prisma.settlementApproval.findUnique({
      where: { id: approval!.id },
    });
    expect(row!.status).toBe("pending");
    expect(row!.approverId).toBeNull();
    expect(row!.approvedAt).toBeNull();
  });
});

describe("setApprovalStepStatus — notification fan-out", () => {
  let coCounselId: string;
  let otherLeadId: string;

  beforeEach(async () => {
    // Roster: actor (lead, seeded by seedMatter), a co-counsel, a
    // second lead, and a removed member who must never be pinged.
    const cc = await seedUser({ firmId, email: "cc@example.com" });
    coCounselId = cc.userId;
    const lead2 = await seedUser({ firmId, email: "lead2@example.com" });
    otherLeadId = lead2.userId;
    const gone = await seedUser({ firmId, email: "gone@example.com" });
    await prisma.matterTeamMember.createMany({
      data: [
        { matterId, userId: coCounselId, role: "co_counsel" },
        { matterId, userId: otherLeadId, role: "lead" },
        {
          matterId,
          userId: gone.userId,
          role: "paralegal",
          removedAt: new Date(),
        },
      ],
    });
    // Only members who hold matters.settlement.view are pinged —
    // grant it to the co-counsel and the second lead (the removed
    // member is excluded by removedAt regardless).
    await grantSettlementView([coCounselId, otherLeadId, gone.userId]);
    await upsertSettlement(
      matterId,
      settlementInitialState,
      buildUpsertForm({ gross: "100000" })
    );
  });

  const approvalsInOrder = () =>
    prisma.settlementApproval.findMany({
      where: { settlement: { matterId } },
      orderBy: { step: "asc" },
    });

  test("approving a step notifies the active team (minus actor) with the next step", async () => {
    const approvals = await approvalsInOrder();
    await setApprovalStepStatus(approvals[0]!.id, "approved");

    const rows = await prisma.notification.findMany({
      where: { type: "settlement_step_approved" },
    });
    // Co-counsel + the other lead — not the actor, not the removed member.
    expect(new Set(rows.map((r) => r.userId))).toEqual(
      new Set([coCounselId, otherLeadId])
    );
    expect(rows[0]!.title).toContain(approvals[0]!.label);
    // Whose turn it is next: step 2's label.
    expect(rows[0]!.body).toContain(approvals[1]!.label);
    expect(rows[0]!.link).toBe(`/matters/${matterId}/billing`);
    expect(rows[0]!.matterId).toBe(matterId);
  });

  test("approving the FINAL step says the chain is complete", async () => {
    const approvals = await approvalsInOrder();
    for (const a of approvals) {
      await setApprovalStepStatus(a.id, "approved");
    }
    const rows = await prisma.notification.findMany({
      where: {
        type: "settlement_step_approved",
        title: { contains: approvals[3]!.label },
      },
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.body).toMatch(/all steps approved/i);
  });

  test("rejection notifies the OTHER matter lead(s), not the whole team", async () => {
    const approvals = await approvalsInOrder();
    await setApprovalStepStatus(approvals[2]!.id, "rejected", "Numbers off");

    const rows = await prisma.notification.findMany({
      where: { type: "settlement_step_rejected" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(otherLeadId); // actor-lead excluded
    expect(rows[0]!.title).toContain(approvals[2]!.label);
    expect(rows[0]!.body).toContain("Numbers off");
  });

  test("rejection by the only lead notifies nobody (actor exclusion)", async () => {
    // Drop the second lead so the actor is the only one.
    await prisma.matterTeamMember.updateMany({
      where: { matterId, userId: otherLeadId },
      data: { removedAt: new Date() },
    });
    const approvals = await approvalsInOrder();
    await setApprovalStepStatus(approvals[0]!.id, "rejected");
    expect(
      await prisma.notification.count({
        where: { type: "settlement_step_rejected" },
      })
    ).toBe(0);
  });

  test("re-applying the same status doesn't re-notify; reset to pending is silent", async () => {
    const approvals = await approvalsInOrder();
    await setApprovalStepStatus(approvals[0]!.id, "approved");
    const afterFirst = await prisma.notification.count();

    // Same status again — no transition, no new pings.
    await setApprovalStepStatus(approvals[0]!.id, "approved");
    expect(await prisma.notification.count()).toBe(afterFirst);

    // Reset to pending — housekeeping, still silent.
    await setApprovalStepStatus(approvals[0]!.id, "pending");
    expect(await prisma.notification.count()).toBe(afterFirst);
  });
});

describe("setApprovalStepStatus — only settlement viewers are notified (F888)", () => {
  test("a team member without matters.settlement.view gets no ping", async () => {
    const viewer = await seedUser({ firmId, email: "viewer@example.com" });
    const noView = await seedUser({ firmId, email: "noview@example.com" });
    await prisma.matterTeamMember.createMany({
      data: [
        { matterId, userId: viewer.userId, role: "co_counsel" },
        { matterId, userId: noView.userId, role: "paralegal" },
      ],
    });
    await grantSettlementView([viewer.userId]);
    await upsertSettlement(
      matterId,
      settlementInitialState,
      buildUpsertForm({ gross: "100000" })
    );
    const approval = await prisma.settlementApproval.findFirstOrThrow({
      where: { settlement: { matterId }, step: 1 },
    });
    await setApprovalStepStatus(approval.id, "approved");

    const rows = await prisma.notification.findMany({
      where: { type: "settlement_step_approved" },
    });
    expect(rows.map((r) => r.userId)).toEqual([viewer.userId]);
  });

  test("admins count as holders (wildcard role)", async () => {
    const admin = await seedUser({ firmId, email: "admin@example.com" });
    const role = await prisma.role.upsert({
      where: { firmId_name: { firmId, name: "Admin" } },
      update: {},
      create: { firmId, name: "Admin", isSystem: true },
    });
    await prisma.userRole.create({
      data: { userId: admin.userId, roleId: role.id },
    });
    await prisma.matterTeamMember.create({
      data: { matterId, userId: admin.userId, role: "co_counsel" },
    });
    await upsertSettlement(
      matterId,
      settlementInitialState,
      buildUpsertForm({ gross: "100000" })
    );
    const approval = await prisma.settlementApproval.findFirstOrThrow({
      where: { settlement: { matterId }, step: 1 },
    });
    await setApprovalStepStatus(approval.id, "approved");
    const rows = await prisma.notification.findMany({
      where: { type: "settlement_step_approved" },
    });
    expect(rows.map((r) => r.userId)).toEqual([admin.userId]);
  });
});

describe("setApprovalStepStatus — argument validation (F886)", () => {
  let approvalId: string;
  beforeEach(async () => {
    await upsertSettlement(
      matterId,
      settlementInitialState,
      buildUpsertForm({ gross: "100000" })
    );
    approvalId = (
      await prisma.settlementApproval.findFirstOrThrow({
        where: { settlement: { matterId }, step: 1 },
      })
    ).id;
  });

  test("rejects an unknown status without writing or notifying", async () => {
    const res = await setApprovalStepStatus(approvalId, "done" as never);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/invalid/i);
    const row = await prisma.settlementApproval.findUniqueOrThrow({
      where: { id: approvalId },
    });
    expect(row.status).toBe("pending");
    expect(await prisma.notification.count()).toBe(0);
  });

  test("rejects non-string / oversized notes instead of throwing", async () => {
    const bad = await setApprovalStepStatus(
      approvalId,
      "approved",
      42 as never
    );
    expect(bad.ok).toBe(false);
    const long = await setApprovalStepStatus(
      approvalId,
      "approved",
      "x".repeat(401)
    );
    expect(long.ok).toBe(false);
    const row = await prisma.settlementApproval.findUniqueOrThrow({
      where: { id: approvalId },
    });
    expect(row.status).toBe("pending");
  });

  test("rejects an empty approval id", async () => {
    const res = await setApprovalStepStatus("", "approved");
    expect(res.ok).toBe(false);
  });
});

// ── Status + amount rules (F115 / F141 / F394 / F365) ───────────────────

describe("upsertSettlement — status transitions", () => {
  const deny = () => mockedHasPermission.mockResolvedValueOnce(false);
  const openSettlement = async (gross = "100000") => {
    await upsertSettlement(
      matterId,
      settlementInitialState,
      buildUpsertForm({ gross })
    );
    return prisma.settlement.findFirstOrThrow({
      where: { matterId },
      include: { approvals: true },
    });
  };
  const approveAll = async (settlementId: string) => {
    await prisma.settlementApproval.updateMany({
      where: { settlementId },
      data: { status: "approved", approverId: userId, approvedAt: new Date() },
    });
  };
  const edit = (opts: Parameters<typeof buildUpsertForm>[0]) =>
    upsertSettlement(matterId, settlementInitialState, buildUpsertForm(opts));
  const statusOf = async () =>
    (await prisma.settlement.findFirstOrThrow({ where: { matterId } })).status;

  test("create is always pending — a non-pending status is refused, nothing is created", async () => {
    const res = await edit({ gross: "100000", status: "disbursed" });
    expect(res.status).toBe("error");
    expect(res.error).toMatch(/pending/i);
    expect(await prisma.settlement.count({ where: { matterId } })).toBe(0);
  });

  test("an edit-holder WITHOUT approve cannot move status to approved/disbursed/closed", async () => {
    const s = await openSettlement();
    await approveAll(s.id);
    for (const target of ["approved", "disbursed", "closed"]) {
      deny();
      const res = await edit({ gross: "100000", status: target });
      expect(res.status).toBe("error");
      expect(res.error).toMatch(/approval permission/i);
    }
    expect(await statusOf()).toBe("pending");
  });

  test("approved requires every step approved, even with the approve permission", async () => {
    const s = await openSettlement();
    await prisma.settlementApproval.update({
      where: { id: s.approvals[0]!.id },
      data: { status: "approved" },
    });
    const res = await edit({ gross: "100000", status: "approved" });
    expect(res.status).toBe("error");
    expect(res.error).toMatch(/every approval step/i);
    expect(await statusOf()).toBe("pending");
  });

  test("walks pending -> approved -> disbursed -> closed with the approve permission; no skipping", async () => {
    const s = await openSettlement();
    // Can't jump straight to disbursed/closed.
    expect((await edit({ gross: "100000", status: "disbursed" })).status).toBe(
      "error"
    );
    expect((await edit({ gross: "100000", status: "closed" })).status).toBe(
      "error"
    );
    await approveAll(s.id);
    expect((await edit({ gross: "100000", status: "approved" })).status).toBe(
      "ok"
    );
    expect((await edit({ gross: "100000", status: "closed" })).status).toBe(
      "error"
    );
    expect((await edit({ gross: "100000", status: "disbursed" })).status).toBe(
      "ok"
    );
    expect((await edit({ gross: "100000", status: "closed" })).status).toBe(
      "ok"
    );
    expect(await statusOf()).toBe("closed");
  });

  test("an unchanged status never needs the approve permission", async () => {
    await openSettlement();
    deny();
    const res = await edit({ gross: "120000" }); // pending -> pending
    expect(res.status).toBe("ok");
  });

  test("reopening (any state -> pending) needs the approve permission", async () => {
    const s = await openSettlement();
    await prisma.settlement.update({
      where: { id: s.id },
      data: { status: "disbursed" },
    });
    deny();
    const denied = await edit({ gross: "100000", status: "pending" });
    expect(denied.status).toBe("error");
    expect(await statusOf()).toBe("disbursed");

    const ok = await edit({ gross: "100000", status: "pending" });
    expect(ok.status).toBe("ok");
    expect(await statusOf()).toBe("pending");
  });
});

describe("upsertSettlement — amount locks", () => {
  const edit = (opts: Parameters<typeof buildUpsertForm>[0]) =>
    upsertSettlement(matterId, settlementInitialState, buildUpsertForm(opts));
  const row = () => prisma.settlement.findFirstOrThrow({ where: { matterId } });

  const seedAt = async (status: string, allApproved = false) => {
    await edit({ gross: "100000", feePct: "33.33", costs: "500" });
    const s = await row();
    await prisma.settlement.update({ where: { id: s.id }, data: { status } });
    if (allApproved) {
      await prisma.settlementApproval.updateMany({
        where: { settlementId: s.id },
        data: {
          status: "approved",
          approverId: userId,
          approvedAt: new Date(),
        },
      });
    }
    return s.id;
  };

  test.each(["disbursed", "closed"])(
    "%s: changing gross / fee % / costs is refused and the row is untouched",
    async (status) => {
      await seedAt(status);
      for (const attempt of [
        { gross: "90000", feePct: "33.33", costs: "500", status },
        { gross: "100000", feePct: "40", costs: "500", status },
        { gross: "100000", feePct: "33.33", costs: "900", status },
        // Reopening AND editing in one submit is still a change on a
        // locked settlement: reopen first, then edit.
        { gross: "90000", feePct: "33.33", costs: "500", status: "pending" },
      ]) {
        const res = await edit(attempt);
        expect(res.status).toBe("error");
        expect(res.error).toMatch(/locked|reopen/i);
      }
      const after = await row();
      expect(after.grossAmount.toNumber()).toBe(100000);
      expect(after.firmFeePercent!.toNumber()).toBe(33.33);
      expect(after.advancedCosts.toNumber()).toBe(500);
      expect(after.status).toBe(status);
    }
  );

  test("disbursed: an unchanged resave (same numbers) is not a change", async () => {
    await seedAt("disbursed");
    const res = await edit({
      gross: "100000.00",
      feePct: "33.33",
      costs: "500.00",
      status: "disbursed",
    });
    expect(res.status).toBe("ok");
  });

  test("reopen, then edit works as a two-step flow", async () => {
    await seedAt("disbursed");
    expect(
      (
        await edit({
          gross: "100000",
          feePct: "33.33",
          costs: "500",
          status: "pending",
        })
      ).status
    ).toBe("ok");
    expect(
      (await edit({ gross: "95000", feePct: "33.33", costs: "500" })).status
    ).toBe("ok");
    expect((await row()).grossAmount.toNumber()).toBe(95000);
  });

  test("approved: changing the numbers resets every approval and drops to pending", async () => {
    const id = await seedAt("approved", true);
    const res = await edit({
      gross: "80000",
      feePct: "33.33",
      costs: "500",
      status: "approved",
    });
    expect(res.status).toBe("ok");
    const after = await row();
    expect(after.status).toBe("pending");
    expect(after.grossAmount.toNumber()).toBe(80000);
    const approvals = await prisma.settlementApproval.findMany({
      where: { settlementId: id },
    });
    expect(approvals).toHaveLength(4);
    expect(
      approvals.every(
        (a) => a.status === "pending" && !a.approverId && !a.approvedAt
      )
    ).toBe(true);
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { matterId, type: "settlement", title: { contains: "updated" } },
      orderBy: { timestamp: "desc" },
    });
    expect(log.detail).toMatch(/approvals reset/i);
  });

  test("approved: an edit-only user cannot change amounts (would wipe approvals)", async () => {
    const id = await seedAt("approved", true);
    mockedHasPermission.mockResolvedValueOnce(false);
    const res = await edit({
      gross: "80000",
      feePct: "33.33",
      costs: "500",
      status: "approved",
    });
    expect(res.status).toBe("error");
    expect(res.error).toMatch(/approval permission/i);
    expect((await row()).grossAmount.toNumber()).toBe(100000);
    expect((await row()).status).toBe("approved");
    expect(
      await prisma.settlementApproval.count({
        where: { settlementId: id, status: "approved" },
      })
    ).toBe(4);
  });

  test("approved: an unchanged resave keeps the approvals and the status", async () => {
    const id = await seedAt("approved", true);
    const res = await edit({
      gross: "100000",
      feePct: "33.33",
      costs: "500",
      status: "approved",
    });
    expect(res.status).toBe("ok");
    expect((await row()).status).toBe("approved");
    expect(
      await prisma.settlementApproval.count({
        where: { settlementId: id, status: "approved" },
      })
    ).toBe(4);
  });

  test("a numbers change combined with a forward status change is refused", async () => {
    await seedAt("approved", true);
    const res = await edit({
      gross: "80000",
      feePct: "33.33",
      costs: "500",
      status: "disbursed",
    });
    expect(res.status).toBe("error");
    expect(res.error).toMatch(/separately/i);
    expect((await row()).status).toBe("approved");
  });

  test("pending with partial approvals: numbers change leaves approvals alone", async () => {
    const id = await seedAt("pending");
    const first = await prisma.settlementApproval.findFirstOrThrow({
      where: { settlementId: id, step: 1 },
    });
    await prisma.settlementApproval.update({
      where: { id: first.id },
      data: { status: "approved" },
    });
    await edit({ gross: "99000", feePct: "33.33", costs: "500" });
    const after = await prisma.settlementApproval.findUniqueOrThrow({
      where: { id: first.id },
    });
    expect(after.status).toBe("approved");
  });
});

describe("upsertSettlement — concurrent create + deterministic lookup (F364)", () => {
  test("two simultaneous 'Open settlement' submits create exactly one settlement", async () => {
    const results = await Promise.all([
      upsertSettlement(
        matterId,
        settlementInitialState,
        buildUpsertForm({ gross: "100000" })
      ),
      upsertSettlement(
        matterId,
        settlementInitialState,
        buildUpsertForm({ gross: "110000" })
      ),
    ]);
    expect(results.map((r) => r.status)).toEqual(["ok", "ok"]);
    const rows = await prisma.settlement.findMany({
      where: { matterId },
      include: { approvals: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.approvals).toHaveLength(4);
  });

  test("with pre-existing duplicates, edits always target the OLDEST row", async () => {
    const mk = (createdAt: Date, gross: number) =>
      prisma.settlement.create({
        data: { matterId, grossAmount: gross, createdAt },
        select: { id: true },
      });
    const older = await mk(new Date("2026-01-01T00:00:00Z"), 1000);
    const newer = await mk(new Date("2026-02-01T00:00:00Z"), 2000);
    const res = await upsertSettlement(
      matterId,
      settlementInitialState,
      buildUpsertForm({ gross: "5000", feePct: "" })
    );
    expect(res.status).toBe("ok");
    const [o, n] = await Promise.all([
      prisma.settlement.findUniqueOrThrow({ where: { id: older.id } }),
      prisma.settlement.findUniqueOrThrow({ where: { id: newer.id } }),
    ]);
    expect(o.grossAmount.toNumber()).toBe(5000);
    expect(n.grossAmount.toNumber()).toBe(2000);
  });
});

describe("addSettlementLien — disbursed/closed gating", () => {
  test("refuses when the settlement is disbursed", async () => {
    await upsertSettlement(
      matterId,
      settlementInitialState,
      buildUpsertForm({ gross: "100000" })
    );
    const s = await prisma.settlement.findFirstOrThrow({ where: { matterId } });
    await prisma.settlement.update({
      where: { id: s.id },
      data: { status: "disbursed" },
    });

    const fd = new FormData();
    fd.set("lienholder", "Denver Health");
    fd.set("lienholderType", "hospital");
    fd.set("originalAmount", "5000");

    const res = await addSettlementLien(s.id, settlementInitialState, fd);
    expect(res.status).toBe("error");
    expect(res.error).toMatch(/disbursed|closed/i);

    const lienCount = await prisma.settlementLien.count({
      where: { settlementId: s.id },
    });
    expect(lienCount).toBe(0);
  });

  test("succeeds on a pending settlement + creates the lien row", async () => {
    await upsertSettlement(
      matterId,
      settlementInitialState,
      buildUpsertForm({ gross: "100000" })
    );
    const s = await prisma.settlement.findFirstOrThrow({ where: { matterId } });

    const fd = new FormData();
    fd.set("lienholder", "Denver Health");
    fd.set("lienholderType", "hospital");
    fd.set("originalAmount", "12345.67");

    const res = await addSettlementLien(s.id, settlementInitialState, fd);
    expect(res.status).toBe("ok");

    const liens = await prisma.settlementLien.findMany({
      where: { settlementId: s.id },
    });
    expect(liens).toHaveLength(1);
    expect(liens[0]!.lienholder).toBe("Denver Health");
    expect(liens[0]!.originalAmount.toNumber()).toBe(12345.67);
  });
});

describe("updateSettlementLien — disbursed/closed gating", () => {
  /** Seed a pending settlement with one lien; return both ids. */
  const seedSettlementWithLien = async () => {
    await upsertSettlement(
      matterId,
      settlementInitialState,
      buildUpsertForm({ gross: "100000" })
    );
    const s = await prisma.settlement.findFirstOrThrow({ where: { matterId } });
    const lien = await prisma.settlementLien.create({
      data: {
        settlementId: s.id,
        lienholder: "Denver Health",
        lienholderType: "hospital",
        originalAmount: "5000",
      },
    });
    return { settlementId: s.id, lienId: lien.id };
  };

  const buildLienUpdateForm = (negotiated: string, status = "signed") => {
    const fd = new FormData();
    fd.set("negotiatedAmount", negotiated);
    fd.set("status", status);
    return fd;
  };

  test("refuses when the settlement is disbursed — waterfall inputs stay frozen", async () => {
    const { settlementId, lienId } = await seedSettlementWithLien();
    await prisma.settlement.update({
      where: { id: settlementId },
      data: { status: "disbursed" },
    });

    const res = await updateSettlementLien(
      lienId,
      settlementInitialState,
      buildLienUpdateForm("2500")
    );
    expect(res.status).toBe("error");
    expect(res.error).toMatch(/disbursed|closed/i);

    // The row must be untouched — no negotiated amount, no status flip.
    const row = await prisma.settlementLien.findUniqueOrThrow({
      where: { id: lienId },
    });
    expect(row.negotiatedAmount).toBeNull();
    expect(row.status).toBe("pending");
  });

  test("succeeds on a pending settlement + persists negotiated amount", async () => {
    const { lienId } = await seedSettlementWithLien();

    const res = await updateSettlementLien(
      lienId,
      settlementInitialState,
      buildLienUpdateForm("2500")
    );
    expect(res.status).toBe("ok");

    const row = await prisma.settlementLien.findUniqueOrThrow({
      where: { id: lienId },
    });
    expect(row.negotiatedAmount!.toNumber()).toBe(2500);
    expect(row.status).toBe("signed");
  });
});

