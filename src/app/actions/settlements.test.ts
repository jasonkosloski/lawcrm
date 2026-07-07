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

    // Update gross + status.
    const res = await upsertSettlement(
      matterId,
      settlementInitialState,
      buildUpsertForm({ gross: "150000", status: "approved" })
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
    expect(settlementAfter!.status).toBe("approved");
  });

  test("computes firm fee from percent on read (33.33% of 100k = 33330)", async () => {
    await upsertSettlement(
      matterId,
      settlementInitialState,
      buildUpsertForm({ gross: "100000", feePct: "33.33" })
    );
    const s = await prisma.settlement.findFirst({ where: { matterId } });
    // Action stores the precomputed fee as a sanity-double-write;
    // 100000 * 33.33 / 100 = 33330 exactly.
    expect(s!.firmFee.toNumber()).toBe(33330);
  });
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

