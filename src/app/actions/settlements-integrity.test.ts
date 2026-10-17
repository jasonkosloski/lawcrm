/**
 * Integration tests for settlement workflow integrity (B2 sweep):
 * the settlement status following the approval chain (demotion),
 * note preservation, lien deletion / audit, fee rounding parity with
 * the read side, and the read path resolving to the row edits target.
 *
 * Complements settlements.test.ts (seeding, chain promotion,
 * notifications, status transitions, amount locks). Auth + permission
 * gates are module-mocked the same way.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn().mockResolvedValue("test-user"),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));

import { getCurrentUserId } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { getMatterSettlement } from "@/lib/queries/settlements";
import {
  addSettlementLien,
  deleteSettlementLien,
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

let userId: string;
let matterId: string;

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  const u = await seedUser({ firmId, name: "Test Attorney" });
  userId = u.userId;
  vi.mocked(getCurrentUserId).mockResolvedValue(userId);
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

const open = (opts: Parameters<typeof buildUpsertForm>[0] = { gross: "100000" }) =>
  upsertSettlement(matterId, settlementInitialState, buildUpsertForm(opts));

describe("fee rounding (F367)", () => {
  test("stores a half-cent fee rounded half-up, matching the read side", async () => {
    // 10001.05 x 50% = 5000.525 exactly -> 5000.53 (float math gave 5000.52).
    await open({ gross: "10001.05", feePct: "50" });
    const s = await prisma.settlement.findFirstOrThrow({ where: { matterId } });
    expect(s.firmFee.toString()).toBe("5000.53");
    const dto = await getMatterSettlement(matterId);
    expect(dto!.firmFee).toBe(5000.53);
  });

  test("0% fee is a real zero fee, not 'unset'", async () => {
    await open({ gross: "1000", feePct: "0" });
    const s = await prisma.settlement.findFirstOrThrow({ where: { matterId } });
    expect(s.firmFeePercent!.toNumber()).toBe(0);
    expect(s.firmFee.toNumber()).toBe(0);
  });

  test("a 3-decimal percent gets a message that names the real problem (F891)", async () => {
    const res = await open({ gross: "1000", feePct: "33.333" });
    expect(res.status).toBe("error");
    expect(res.errors?.firmFeePercent?.[0]).toMatch(/2 decimals/i);
  });

  test("an unchanged resave of a legacy row with a half-cent stored fee is not an amount change", async () => {
    await open({ gross: "10001.05", feePct: "50" });
    const s = await prisma.settlement.findFirstOrThrow({ where: { matterId } });
    // Simulate a row written before fees were rounded on write.
    await prisma.settlement.update({
      where: { id: s.id },
      data: { firmFee: "5000.525", status: "approved" },
    });
    await prisma.settlementApproval.updateMany({
      where: { settlementId: s.id },
      data: { status: "approved", approverId: userId, approvedAt: new Date() },
    });

    const res = await open({ gross: "10001.05", feePct: "50", status: "approved" });
    expect(res.status).toBe("ok");
    const after = await prisma.settlement.findFirstOrThrow({ where: { matterId } });
    expect(after.status).toBe("approved");
    expect(
      await prisma.settlementApproval.count({
        where: { settlementId: s.id, status: "approved" },
      })
    ).toBe(4);
  });
});

describe("setApprovalStepStatus — settlement follows the chain (F366 / F425)", () => {
  const steps = () =>
    prisma.settlementApproval.findMany({
      where: { settlement: { matterId } },
      orderBy: { step: "asc" },
    });
  const statusOf = async () =>
    (await prisma.settlement.findFirstOrThrow({ where: { matterId } })).status;

  beforeEach(async () => {
    await open();
  });

  const approveAllViaAction = async () => {
    for (const a of await steps()) {
      expect((await setApprovalStepStatus(a.id, "approved")).ok).toBe(true);
    }
    expect(await statusOf()).toBe("approved");
  };

  test("rejecting a step after promotion demotes the settlement to pending", async () => {
    await approveAllViaAction();
    const all = await steps();
    const res = await setApprovalStepStatus(all[2]!.id, "rejected", "numbers off");
    expect(res.ok).toBe(true);
    expect(await statusOf()).toBe("pending");

    const log = await prisma.activityLog.findFirstOrThrow({
      where: { matterId, title: { contains: "step 3", endsWith: "rejected" } },
    });
    expect(log.detail).toMatch(/numbers off/);
    expect(log.detail).toMatch(/back to pending/i);
  });

  test("resetting a step after promotion demotes the settlement to pending", async () => {
    await approveAllViaAction();
    const all = await steps();
    await setApprovalStepStatus(all[0]!.id, "pending");
    expect(await statusOf()).toBe("pending");
  });

  test("re-approving the step re-promotes", async () => {
    await approveAllViaAction();
    const all = await steps();
    await setApprovalStepStatus(all[0]!.id, "pending");
    expect(await statusOf()).toBe("pending");
    await setApprovalStepStatus(all[0]!.id, "approved");
    expect(await statusOf()).toBe("approved");
  });

  test("a step change on a pending settlement never touches the status", async () => {
    const all = await steps();
    await setApprovalStepStatus(all[0]!.id, "rejected");
    expect(await statusOf()).toBe("pending");
  });

  test("the last two steps approved concurrently still promote", async () => {
    const all = await steps();
    await setApprovalStepStatus(all[0]!.id, "approved");
    await setApprovalStepStatus(all[1]!.id, "approved");
    const results = await Promise.all([
      setApprovalStepStatus(all[2]!.id, "approved"),
      setApprovalStepStatus(all[3]!.id, "approved"),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await statusOf()).toBe("approved");
  });
});

describe("setApprovalStepStatus — notes survive other transitions (F887)", () => {
  const first = () =>
    prisma.settlementApproval.findFirstOrThrow({
      where: { settlement: { matterId } },
      orderBy: { step: "asc" },
    });

  beforeEach(async () => {
    await open();
  });

  test("a rejection reason survives Reset", async () => {
    const a = await first();
    await setApprovalStepStatus(a.id, "rejected", "Need updated medical bills");
    await setApprovalStepStatus(a.id, "pending");
    expect((await first()).notes).toBe("Need updated medical bills");
  });

  test("a bare Approve clears a stale rejection note; a new note replaces it", async () => {
    const a = await first();
    await setApprovalStepStatus(a.id, "rejected", "Need updated medical bills");
    await setApprovalStepStatus(a.id, "approved");
    expect((await first()).notes).toBeNull();
    await setApprovalStepStatus(a.id, "approved", "Bills received");
    expect((await first()).notes).toBe("Bills received");
  });

  test("a bare Reject or Reset keeps the stored note", async () => {
    const a = await first();
    await setApprovalStepStatus(a.id, "rejected", "Reason");
    await setApprovalStepStatus(a.id, "rejected");
    expect((await first()).notes).toBe("Reason");
    await setApprovalStepStatus(a.id, "pending");
    expect((await first()).notes).toBe("Reason");
  });

  test("a whitespace-only note is not a note", async () => {
    const a = await first();
    await setApprovalStepStatus(a.id, "rejected", "Reason");
    await setApprovalStepStatus(a.id, "pending", "   ");
    expect((await first()).notes).toBe("Reason");
  });
});

describe("deleteSettlementLien", () => {
  const seed = async (status = "pending") => {
    await open();
    const s = await prisma.settlement.findFirstOrThrow({ where: { matterId } });
    if (status !== "pending") {
      await prisma.settlement.update({ where: { id: s.id }, data: { status } });
    }
    const lien = await prisma.settlementLien.create({
      data: {
        settlementId: s.id,
        lienholder: "Denver Health",
        lienholderType: "hospital",
        originalAmount: "5000",
      },
    });
    return lien.id;
  };

  test("removes the lien and writes an audit row", async () => {
    const lienId = await seed();
    const res = await deleteSettlementLien(lienId);
    expect(res.ok).toBe(true);
    expect(await prisma.settlementLien.count({ where: { id: lienId } })).toBe(0);
    const log = await prisma.activityLog.findFirst({
      where: { matterId, title: { contains: "Lien removed" } },
    });
    expect(log?.title).toMatch(/Denver Health/);
  });

  test.each(["disbursed", "closed"])(
    "refuses when the settlement is %s and keeps the lien",
    async (status) => {
      const lienId = await seed(status);
      const res = await deleteSettlementLien(lienId);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/disbursement|closed/i);
      expect(await prisma.settlementLien.count({ where: { id: lienId } })).toBe(1);
    }
  );

  test("an unknown lien id is a clean error", async () => {
    await open();
    expect(await deleteSettlementLien("nope")).toEqual({
      ok: false,
      error: "Lien not found.",
    });
  });
});

describe("lien changes are locked once the settlement is approved", () => {
  const seed = async (status: string) => {
    await open();
    const s = await prisma.settlement.findFirstOrThrow({ where: { matterId } });
    await prisma.settlement.update({ where: { id: s.id }, data: { status } });
    const lien = await prisma.settlementLien.create({
      data: { settlementId: s.id, lienholder: "Aetna", originalAmount: "50000" },
    });
    return { settlementId: s.id, lienId: lien.id };
  };
  const updateForm = () => {
    const fd = new FormData();
    fd.set("negotiatedAmount", "0");
    fd.set("status", "signed");
    return fd;
  };
  const addForm = () => {
    const fd = new FormData();
    fd.set("lienholder", "New Lienholder");
    fd.set("originalAmount", "100");
    return fd;
  };

  test("approved: update, delete and add are refused and change nothing", async () => {
    const { settlementId, lienId } = await seed("approved");
    const upd = await updateSettlementLien(lienId, settlementInitialState, updateForm());
    expect(upd.status).toBe("error");
    expect(upd.error).toMatch(/Reopen the settlement/);
    const del = await deleteSettlementLien(lienId);
    expect(del.ok).toBe(false);
    expect(del.error).toMatch(/Reopen the settlement/);
    const add = await addSettlementLien(settlementId, settlementInitialState, addForm());
    expect(add.status).toBe("error");
    expect(add.error).toMatch(/Reopen the settlement/);
    const lien = await prisma.settlementLien.findUniqueOrThrow({ where: { id: lienId } });
    expect(lien.negotiatedAmount).toBeNull();
    expect(await prisma.settlementLien.count({ where: { settlementId } })).toBe(1);
  });

  test("update and add are refused when disbursed", async () => {
    const { settlementId, lienId } = await seed("disbursed");
    expect(
      (await updateSettlementLien(lienId, settlementInitialState, updateForm())).status
    ).toBe("error");
    expect(
      (await addSettlementLien(settlementId, settlementInitialState, addForm())).status
    ).toBe("error");
  });

  test("pending: all three succeed", async () => {
    const { settlementId, lienId } = await seed("pending");
    expect(
      (await updateSettlementLien(lienId, settlementInitialState, updateForm())).status
    ).toBe("ok");
    expect(
      (await addSettlementLien(settlementId, settlementInitialState, addForm())).status
    ).toBe("ok");
    expect((await deleteSettlementLien(lienId)).ok).toBe(true);
  });
});

describe("lien audit + validation", () => {
  const seedLien = async () => {
    await open();
    const s = await prisma.settlement.findFirstOrThrow({ where: { matterId } });
    const lien = await prisma.settlementLien.create({
      data: { settlementId: s.id, lienholder: "Aetna", originalAmount: "50000" },
    });
    return { settlementId: s.id, lienId: lien.id };
  };

  const lienForm = (negotiated: string, status = "negotiating") => {
    const fd = new FormData();
    fd.set("negotiatedAmount", negotiated);
    fd.set("status", status);
    return fd;
  };

  test("updateSettlementLien records old -> new negotiated amount and status", async () => {
    const { lienId } = await seedLien();
    await updateSettlementLien(lienId, settlementInitialState, lienForm("5000"));
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { matterId, title: { contains: "Lien updated" } },
    });
    expect(log.detail).toContain("none (original $50000.00) → $5000.00");
    expect(log.detail).toContain("pending → negotiating");
  });

  test("a blank negotiated amount clears it to the original; 0 records a write-off", async () => {
    const { lienId } = await seedLien();
    const negotiated = async () =>
      (await prisma.settlementLien.findUniqueOrThrow({ where: { id: lienId } }))
        .negotiatedAmount;
    await updateSettlementLien(lienId, settlementInitialState, lienForm("0.00"));
    expect((await negotiated())!.toNumber()).toBe(0);
    await updateSettlementLien(lienId, settlementInitialState, lienForm(""));
    expect(await negotiated()).toBeNull();
  });

  test("addSettlementLien rejects a lienholder type outside the shared list", async () => {
    const { settlementId } = await seedLien();
    const fd = new FormData();
    fd.set("lienholder", "X");
    fd.set("lienholderType", "bogus");
    fd.set("originalAmount", "10");
    const res = await addSettlementLien(settlementId, settlementInitialState, fd);
    expect(res.status).toBe("error");
    expect(res.errors?.lienholderType).toBeTruthy();
  });

  test("a 3-decimal lien amount returns a field error message", async () => {
    const { settlementId } = await seedLien();
    const fd = new FormData();
    fd.set("lienholder", "X");
    fd.set("originalAmount", "12.345");
    const res = await addSettlementLien(settlementId, settlementInitialState, fd);
    expect(res.errors?.originalAmount?.[0]).toMatch(/valid amount/i);
  });
});

describe("getMatterSettlement — read path matches the row edits target (F797)", () => {
  test("with duplicates, the read resolves to the OLDEST row", async () => {
    await open({ gross: "1000" });
    const oldest = await prisma.settlement.findFirstOrThrow({ where: { matterId } });
    await prisma.settlement.create({
      data: { matterId, grossAmount: "9999", status: "pending" },
    });
    const dto = await getMatterSettlement(matterId);
    expect(dto!.id).toBe(oldest.id);
  });
});
