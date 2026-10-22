/**
 * Integration tests for the expense server actions.
 *
 * Pins: permission keys, amount parsing / Decimal exactness, ADR-012
 * date-only storage, the receipt cross-matter guard, the billed-expense
 * lock (including the guarded-write race against invoice generation),
 * and the audit rows. Auth is module-mocked; the gate's own semantics
 * live in permission-check.test.ts.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn().mockResolvedValue("test-user"),
  currentUserHasAnyPermission: vi.fn().mockResolvedValue(true),
}));

import { getCurrentUserId } from "@/lib/current-user";
import {
  currentUserHasAnyPermission,
  requirePermission,
} from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import {
  createExpense,
  deleteExpense,
  searchReceiptDocuments,
  updateExpense,
} from "@/app/actions/expenses";
import { expenseInitialState } from "@/lib/expense-constants";
import {
  resetDb,
  seedDocument,
  seedExpense,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

let userId: string;
let matterId: string;
let otherMatterId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  userId = (await seedUser({ firmId })).userId;
  vi.mocked(getCurrentUserId).mockResolvedValue(userId);
  const area = await seedPracticeArea();
  const mk = async () =>
    (
      await seedMatter({
        practiceAreaId: area.areaId,
        stageId: area.stageId,
        leadUserId: userId,
      })
    ).matterId;
  matterId = await mk();
  otherMatterId = await mk();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(requirePermission).mockClear();
});

const form = (over: Record<string, string> = {}): FormData => {
  const fd = new FormData();
  const fields: Record<string, string> = {
    date: "2026-04-15",
    description: "Court filing fee",
    category: "filing_fee",
    amount: "350.00",
    ...over,
  };
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

const create = (over?: Record<string, string>) =>
  createExpense(matterId, expenseInitialState, form(over));

const seedInvoice = (forMatter = matterId) =>
  prisma.invoice.create({
    data: {
      invoiceNumber: `T-${Math.random().toString(36).slice(2, 8)}`,
      matterId: forMatter,
      issueDate: new Date("2026-04-01T00:00:00Z"),
      dueDate: new Date("2026-05-01T00:00:00Z"),
    },
    select: { id: true },
  });

describe("createExpense", () => {
  test("gates on matters.expense.create and stores a Decimal amount", async () => {
    const res = await create({ amount: "$1,234.50" });
    expect(res.status).toBe("ok");
    expect(requirePermission).toHaveBeenCalledWith("matters.expense.create");
    const row = await prisma.expense.findFirstOrThrow({ where: { matterId } });
    expect(row.amount.toString()).toBe("1234.5");
    expect(row.loggedBy).toBe(userId);
  });

  test("date is stored as UTC midnight of the calendar day (ADR-012)", async () => {
    await create({ date: "2026-04-15" });
    const row = await prisma.expense.findFirstOrThrow({ where: { matterId } });
    expect(row.date.toISOString()).toBe("2026-04-15T00:00:00.000Z");
  });

  test.each(["2026-02-31", "not-a-date", "2026-13-01"])(
    "invalid date %s is a field error and creates nothing",
    async (date) => {
      const res = await create({ date });
      expect(res.status).toBe("error");
      expect(res.errors?.date).toBeTruthy();
      expect(await prisma.expense.count({ where: { matterId } })).toBe(0);
    }
  );

  test("an amount over DECIMAL(14,2) is a field error, not a Prisma throw", async () => {
    const res = await create({ amount: "1000000000000.00" });
    expect(res.status).toBe("error");
    expect(res.errors?.amount?.[0]).toMatch(/too large|exceeds|at most/i);
    expect(await prisma.expense.count({ where: { matterId } })).toBe(0);
    // The ceiling itself is storable.
    const ok = await create({ amount: "999999999999.99" });
    expect(ok.status).toBe("ok");
  });

  test("a blank date is a field error", async () => {
    const res = await create({ date: "" });
    expect(res.errors?.date).toBeTruthy();
  });

  test.each([
    ["0.00", /greater than 0/i],
    ["0", /greater than 0/i],
    ["5.999", /valid amount/i],
    ["-5", /valid amount/i],
    ["abc", /valid amount/i],
  ])("amount %s is rejected", async (amount, message) => {
    const res = await create({ amount });
    expect(res.status).toBe("error");
    expect(res.errors?.amount?.[0]).toMatch(message);
    expect(await prisma.expense.count({ where: { matterId } })).toBe(0);
  });

  test("thousands separators are stripped wherever they appear (pins current behavior)", async () => {
    await create({ amount: "1,2.50" });
    const row = await prisma.expense.findFirstOrThrow({ where: { matterId } });
    expect(row.amount.toString()).toBe("12.5");
  });

  test("checkboxes: absent = non-billable / not client-advanced; 'on' = true", async () => {
    await create({ description: "off" });
    await create({ description: "on", billable: "on", clientAdvanced: "on" });
    const off = await prisma.expense.findFirstOrThrow({ where: { description: "off" } });
    const on = await prisma.expense.findFirstOrThrow({ where: { description: "on" } });
    expect([off.billable, off.clientAdvanced]).toEqual([false, false]);
    expect([on.billable, on.clientAdvanced]).toEqual([true, true]);
  });

  test("unknown matter is a clean error", async () => {
    // Unknown == hidden: the matter wall answers with notFound().
    await expect(
      createExpense("nope", expenseInitialState, form())
    ).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK|NEXT_NOT_FOUND/);
  });

  test("receipt: a document on THIS matter links; another matter's or an unknown id becomes null", async () => {
    const mine = await seedDocument({ matterId });
    const theirs = await seedDocument({ matterId: otherMatterId });
    await create({ description: "mine", receiptDocumentId: mine.documentId });
    await create({ description: "theirs", receiptDocumentId: theirs.documentId });
    await create({ description: "ghost", receiptDocumentId: "does-not-exist" });
    await create({ description: "none", receiptDocumentId: "" });
    const receipt = async (d: string) =>
      (await prisma.expense.findFirstOrThrow({ where: { description: d } }))
        .receiptDocumentId;
    expect(await receipt("mine")).toBe(mine.documentId);
    expect(await receipt("theirs")).toBeNull();
    expect(await receipt("ghost")).toBeNull();
    expect(await receipt("none")).toBeNull();
  });

  test("writes an audit row with the expense title format", async () => {
    await create({ amount: "350", description: "Postage", clientAdvanced: "on" });
    const log = await prisma.activityLog.findFirstOrThrow({ where: { matterId } });
    expect(log.title).toBe("Expense logged · $350.00 · Postage");
    expect(log.detail).toMatch(/client-advanced/);
    expect(log.detail).toMatch(/non-billable/);
  });
});

describe("updateExpense", () => {
  test("gates on matters.expense.edit, updates the row and logs old -> new amount", async () => {
    const { expenseId } = await seedExpense({ matterId, amount: 100 });
    const res = await updateExpense(
      expenseId,
      expenseInitialState,
      form({ amount: "125.25", description: "Corrected" })
    );
    expect(res.status).toBe("ok");
    expect(requirePermission).toHaveBeenCalledWith("matters.expense.edit");
    const row = await prisma.expense.findUniqueOrThrow({ where: { id: expenseId } });
    expect(row.amount.toString()).toBe("125.25");
    expect(row.description).toBe("Corrected");
    expect(row.date.toISOString()).toBe("2026-04-15T00:00:00.000Z");
    const log = await prisma.activityLog.findFirstOrThrow({ where: { matterId } });
    expect(log.title).toBe("Expense edited · Corrected");
    expect(log.detail).toBe("Amount: $100.00 → $125.25");
  });

  test("an unchanged amount adds no amount detail", async () => {
    const { expenseId } = await seedExpense({ matterId, amount: 350 });
    await updateExpense(expenseId, expenseInitialState, form({ amount: "350" }));
    const log = await prisma.activityLog.findFirstOrThrow({ where: { matterId } });
    expect(log.detail).toBeNull();
  });

  test("a billed expense is refused and left untouched", async () => {
    const inv = await seedInvoice();
    const { expenseId } = await seedExpense({ matterId, amount: 100, invoiceId: inv.id });
    const res = await updateExpense(expenseId, expenseInitialState, form({ amount: "999" }));
    expect(res.status).toBe("error");
    expect(res.error).toMatch(/billed on an invoice/i);
    const row = await prisma.expense.findUniqueOrThrow({ where: { id: expenseId } });
    expect(row.amount.toString()).toBe("100");
  });

  test("an invoice claiming the row between the read and the write wins (guarded write)", async () => {
    const inv = await seedInvoice();
    const { expenseId } = await seedExpense({ matterId, amount: 100 });
    // The action's read sees the row unbilled; by the time it writes,
    // invoice generation has linked it.
    const realFind = prisma.expense.findUnique.bind(prisma.expense);
    vi.spyOn(prisma.expense, "findUnique").mockImplementationOnce(((args: never) =>
      realFind(args).then(async (r: unknown) => {
        await prisma.expense.update({ where: { id: expenseId }, data: { invoiceId: inv.id } });
        return r;
      })) as never);
    const res = await updateExpense(expenseId, expenseInitialState, form({ amount: "999" }));
    expect(res.status).toBe("error");
    expect(res.error).toMatch(/billed on an invoice/i);
    const row = await prisma.expense.findUniqueOrThrow({ where: { id: expenseId } });
    expect(row.amount.toString()).toBe("100");
  });

  test("the receipt guard uses the expense's own matter", async () => {
    const { expenseId } = await seedExpense({ matterId });
    const theirs = await seedDocument({ matterId: otherMatterId });
    await updateExpense(
      expenseId,
      expenseInitialState,
      form({ receiptDocumentId: theirs.documentId })
    );
    const row = await prisma.expense.findUniqueOrThrow({ where: { id: expenseId } });
    expect(row.receiptDocumentId).toBeNull();
  });

  test("unknown expense and invalid input are clean errors", async () => {
    expect(await updateExpense("nope", expenseInitialState, form())).toEqual({
      status: "error",
      error: "Expense not found.",
    });
    const { expenseId } = await seedExpense({ matterId });
    const bad = await updateExpense(expenseId, expenseInitialState, form({ date: "2026-02-31" }));
    expect(bad.errors?.date).toBeTruthy();
    const huge = await updateExpense(
      expenseId,
      expenseInitialState,
      form({ amount: "1000000000000" })
    );
    expect(huge.status).toBe("error");
    expect(huge.errors?.amount).toBeTruthy();
  });
});

describe("deleteExpense", () => {
  test("gates on matters.expense.delete, removes the row and logs it", async () => {
    const { expenseId } = await seedExpense({ matterId, amount: 42 });
    const res = await deleteExpense(expenseId);
    expect(res).toEqual({ ok: true });
    expect(requirePermission).toHaveBeenCalledWith("matters.expense.delete");
    expect(await prisma.expense.count({ where: { id: expenseId } })).toBe(0);
    const log = await prisma.activityLog.findFirstOrThrow({ where: { matterId } });
    expect(log.title).toBe("Expense deleted · $42.00 · Test expense");
  });

  test("a billed expense is refused and kept", async () => {
    const inv = await seedInvoice();
    const { expenseId } = await seedExpense({ matterId, invoiceId: inv.id });
    const res = await deleteExpense(expenseId);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/billed on an invoice/i);
    expect(await prisma.expense.count({ where: { id: expenseId } })).toBe(1);
  });

  test("an invoice claiming the row between the read and the delete wins (guarded write)", async () => {
    const inv = await seedInvoice();
    const { expenseId } = await seedExpense({ matterId });
    const realFind = prisma.expense.findUnique.bind(prisma.expense);
    vi.spyOn(prisma.expense, "findUnique").mockImplementationOnce(((args: never) =>
      realFind(args).then(async (r: unknown) => {
        await prisma.expense.update({ where: { id: expenseId }, data: { invoiceId: inv.id } });
        return r;
      })) as never);
    const res = await deleteExpense(expenseId);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/billed on an invoice/i);
    expect(await prisma.expense.count({ where: { id: expenseId } })).toBe(1);
  });

  test("an unknown id is a clean error", async () => {
    expect(await deleteExpense("nope")).toEqual({
      ok: false,
      error: "Expense not found.",
    });
  });
});

describe("searchReceiptDocuments", () => {
  test("lists only this matter's documents, newest first, filtered by name", async () => {
    const older = await seedDocument({ matterId, name: "Filing fee receipt.pdf" });
    const newer = await seedDocument({ matterId, name: "Court costs.pdf" });
    await prisma.document.update({
      where: { id: older.documentId },
      data: { createdAt: new Date("2026-01-01T00:00:00Z") },
    });
    await seedDocument({ matterId: otherMatterId, name: "Other matter receipt.pdf" });

    expect((await searchReceiptDocuments(matterId, "")).map((d) => d.id)).toEqual([
      newer.documentId,
      older.documentId,
    ]);
    expect(await searchReceiptDocuments(matterId, "  RECEIPT ")).toEqual([
      { id: older.documentId, name: "Filing fee receipt.pdf" },
    ]);
    expect(currentUserHasAnyPermission).toHaveBeenCalledWith([
      "matters.expense.create",
      "matters.expense.edit",
    ]);
  });

  test("returns nothing without an expense create/edit permission", async () => {
    await seedDocument({ matterId });
    vi.mocked(currentUserHasAnyPermission).mockResolvedValueOnce(false);
    expect(await searchReceiptDocuments(matterId, "")).toEqual([]);
  });

  test("a malformed payload returns nothing", async () => {
    await seedDocument({ matterId });
    expect(
      await searchReceiptDocuments(matterId, { contains: "" } as unknown as string)
    ).toEqual([]);
  });
});
