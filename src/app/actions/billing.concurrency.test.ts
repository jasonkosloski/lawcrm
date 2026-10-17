/**
 * Real-concurrency tests for the billing row locks and the invoice-
 * number retry.
 *
 * The app's shared Prisma client is capped at ONE pooled connection
 * (src/lib/prisma.ts), so `Promise.all([action, action])` through it
 * runs the two interactive transactions strictly one after another and
 * can never contend a lock. This file swaps in a client with a larger
 * pool and makes the overlap deterministic: a "holder" transaction
 * takes the row lock (or an uncommitted conflicting insert) first, the
 * actions start and are confirmed BLOCKED via pg_stat_activity, and
 * only then is the holder released. Outcomes are asserted after the
 * release:
 *
 *   - Without `SELECT ... FOR UPDATE` in the action, both racers have
 *     already read the pre-payment state before they block, so both
 *     succeed and the invoice is overpaid / the trust account
 *     overdrawn (lost update).
 *   - Without the outside-the-transaction P2002 retry, the loser of an
 *     invoice-number collision returns an error instead of re-running
 *     and taking the next number.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/prisma", async () => {
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { PrismaClient } = await import("@/generated/prisma/client");
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    max: 8,
  });
  return { prisma: new PrismaClient({ adapter }) };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/current-user-tz", () => ({ getCurrentUserTimeZone: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn().mockResolvedValue("test-user"),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));

import { getCurrentUserId } from "@/lib/current-user";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { prisma } from "@/lib/prisma";
import {
  addTrustTransaction,
  bundleAsInternalRecord,
  generateInvoiceFromWip,
  recordInvoicePayment,
  sendInvoice,
} from "@/app/actions/billing";
import { billingInitialState } from "@/lib/billing-form";
import { todayKey } from "@/lib/format-date";
import {
  resetDb,
  seedExpense,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedTimeEntry,
  seedUser,
} from "@/test/integration-helpers";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

let userId: string;
let matterId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  ({ userId } = await seedUser({ firmId }));
  vi.mocked(getCurrentUserId).mockResolvedValue(userId);
  vi.mocked(getCurrentUserTimeZone).mockResolvedValue("America/Denver");
  const area = await seedPracticeArea();
  ({ matterId } = await seedMatter({
    practiceAreaId: area.areaId,
    stageId: area.stageId,
    leadUserId: userId,
  }));
});

/** Run `work` inside an open transaction and keep it open (holding
 *  whatever locks / uncommitted rows `work` took) until `release()`. */
async function holdTransaction(work: (tx: Tx) => Promise<unknown>) {
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  let ready!: () => void;
  const readyP = new Promise<void>((r) => (ready = r));
  const done = prisma.$transaction(
    async (tx) => {
      await work(tx);
      ready();
      await gate;
    },
    { timeout: 30_000, maxWait: 10_000 }
  );
  await Promise.race([readyP, done]);
  return {
    release: async () => {
      open();
      await done;
    },
  };
}

/** Wait until at least `n` backends are blocked on a lock. Polling a
 *  database fact instead of sleeping, so the test never releases the
 *  holder before the racers are actually contending. */
async function waitForBlocked(n: number): Promise<void> {
  const deadline = Date.now() + 8_000;
  for (;;) {
    const rows = await prisma.$queryRaw<{ c: bigint }[]>`
      SELECT count(*)::bigint AS c FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if (Number(rows[0]!.c) >= n) return;
    if (Date.now() > deadline) {
      throw new Error(`expected ${n} blocked backends, never saw them`);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

const payForm = (amount: string) => {
  const fd = new FormData();
  fd.set("amount", amount);
  fd.set("source", "check");
  return fd;
};

async function makeInvoice(status: string, total = 100): Promise<string> {
  const inv = await prisma.invoice.create({
    data: {
      invoiceNumber: "2026-900",
      matterId,
      issueDate: new Date(),
      dueDate: new Date(),
      subtotal: total,
      totalAmount: total,
      paidAmount: 0,
      status,
    },
    select: { id: true },
  });
  return inv.id;
}

describe("billing row locks under real contention", () => {
  test("two payments for the full balance can't both land (invoice FOR UPDATE)", async () => {
    const id = await makeInvoice("sent");
    const holder = await holdTransaction((tx) =>
      tx.$queryRaw`SELECT id FROM invoices WHERE id = ${id} FOR UPDATE`
    );
    const racers = Promise.all([
      recordInvoicePayment(id, billingInitialState, payForm("100")),
      recordInvoicePayment(id, billingInitialState, payForm("100")),
    ]);
    await waitForBlocked(2);
    await holder.release();
    const [a, b] = await racers;

    expect([a.status, b.status].sort()).toEqual(["error", "ok"]);
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id } });
    expect(inv.paidAmount.toNumber()).toBe(100);
    expect(inv.status).toBe("paid");
    expect(await prisma.invoicePayment.count({ where: { invoiceId: id } })).toBe(1);
  });

  test("two trust payments can't both spend the same trust dollars (matter FOR UPDATE)", async () => {
    // Two DIFFERENT invoices so only the matter row serializes them.
    const a = await makeInvoice("sent", 100);
    const bInv = await prisma.invoice.create({
      data: {
        invoiceNumber: "2026-901",
        matterId,
        issueDate: new Date(),
        dueDate: new Date(),
        subtotal: 100,
        totalAmount: 100,
        paidAmount: 0,
        status: "sent",
      },
      select: { id: true },
    });
    await prisma.matter.update({ where: { id: matterId }, data: { trustBalance: 100 } });

    const trustForm = () => {
      const fd = payForm("100");
      fd.set("source", "trust");
      return fd;
    };
    const holder = await holdTransaction((tx) =>
      tx.$queryRaw`SELECT id FROM matters WHERE id = ${matterId} FOR UPDATE`
    );
    const racers = Promise.all([
      recordInvoicePayment(a, billingInitialState, trustForm()),
      recordInvoicePayment(bInv.id, billingInitialState, trustForm()),
    ]);
    await waitForBlocked(2);
    await holder.release();
    const results = await racers;

    expect(results.map((r) => r.status).sort()).toEqual(["error", "ok"]);
    const matter = await prisma.matter.findUniqueOrThrow({ where: { id: matterId } });
    expect(matter.trustBalance.toNumber()).toBe(0);
    expect(await prisma.trustTransaction.count({ where: { matterId } })).toBe(1);
  });

  test("sendInvoice applying trust and a concurrent payment can't both claim the balance", async () => {
    const id = await makeInvoice("approved");
    await prisma.matter.update({ where: { id: matterId }, data: { trustBalance: 500 } });
    // Hold the invoice row, then queue a send (apply trust) behind it.
    const holder = await holdTransaction((tx) =>
      tx.$queryRaw`SELECT id FROM invoices WHERE id = ${id} FOR UPDATE`
    );
    const fd = new FormData();
    fd.set("method", "email");
    fd.set("recipient", "c@example.com");
    fd.set("applyTrust", "true");
    const send = sendInvoice(id, billingInitialState, fd);
    await waitForBlocked(1);
    await holder.release();
    expect((await send).status).toBe("ok");
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id } })).status).toBe("paid");
  });

  test("two disbursements can't overdraw the matter trust (adjustTrustBalance lock)", async () => {
    await prisma.matter.update({ where: { id: matterId }, data: { trustBalance: 100 } });
    const form = () => {
      const fd = new FormData();
      fd.set("type", "disbursement");
      fd.set("amount", "100");
      fd.set("description", "Concurrent disbursement");
      return fd;
    };
    const holder = await holdTransaction((tx) =>
      tx.$queryRaw`SELECT id FROM matters WHERE id = ${matterId} FOR UPDATE`
    );
    const racers = Promise.all([
      addTrustTransaction(matterId, billingInitialState, form()),
      addTrustTransaction(matterId, billingInitialState, form()),
    ]);
    await waitForBlocked(2);
    await holder.release();
    const [a, b] = await racers;

    expect([a.status, b.status].sort()).toEqual(["error", "ok"]);
    const matter = await prisma.matter.findUniqueOrThrow({ where: { id: matterId } });
    expect(matter.trustBalance.toNumber()).toBe(0);
    expect(await prisma.trustTransaction.count({ where: { matterId } })).toBe(1);
  });

  test("two generates on the same matter bill each entry exactly once (matter FOR UPDATE)", async () => {
    await seedTimeEntry({ matterId, userId, amount: 100 });
    await seedExpense({ matterId, amount: 25 });
    const holder = await holdTransaction((tx) =>
      tx.$queryRaw`SELECT id FROM matters WHERE id = ${matterId} FOR UPDATE`
    );
    const racers = Promise.all([
      generateInvoiceFromWip(matterId, billingInitialState, new FormData()),
      generateInvoiceFromWip(matterId, billingInitialState, new FormData()),
    ]);
    await waitForBlocked(2);
    await holder.release();
    const results = await racers;

    expect(results.map((r) => r.status).sort()).toEqual(["error", "ok"]);
    const invoices = await prisma.invoice.findMany({ where: { matterId } });
    expect(invoices).toHaveLength(1);
    expect(invoices[0]!.totalAmount.toNumber()).toBe(125);
  });

  test("a generate and a bundle on the same matter can't both claim the entries", async () => {
    await seedTimeEntry({ matterId, userId, amount: 100 });
    const holder = await holdTransaction((tx) =>
      tx.$queryRaw`SELECT id FROM matters WHERE id = ${matterId} FOR UPDATE`
    );
    const fd = new FormData();
    fd.set("notes", "closing out");
    const racers = Promise.all([
      generateInvoiceFromWip(matterId, billingInitialState, new FormData()),
      bundleAsInternalRecord(matterId, billingInitialState, fd),
    ]);
    await waitForBlocked(2);
    await holder.release();
    const results = await racers;
    expect(results.map((r) => r.status).sort()).toEqual(["error", "ok"]);
    expect(await prisma.invoice.count({ where: { matterId } })).toBe(1);
  });
});

describe("invoice-number collision retry", () => {
  test("a generate that loses the number race re-runs its whole transaction and takes the next number", async () => {
    await seedTimeEntry({ matterId, userId, amount: 100 });
    const year = todayKey("America/Denver").slice(0, 4);

    // Another process has inserted (but not yet committed) the number
    // this generate is about to compute. The generate reads the
    // committed max, picks `${year}-001`, and its INSERT blocks on the
    // uncommitted unique key; when the holder commits, the INSERT
    // fails with P2002 — which aborts the Postgres transaction — and
    // only a retry of the WHOLE transaction can succeed.
    const area = await seedPracticeArea({ name: "Other area" });
    const other = await seedMatter({
      practiceAreaId: area.areaId,
      stageId: area.stageId,
      leadUserId: userId,
      name: "Other matter",
    });
    const holder = await holdTransaction((tx) =>
      tx.invoice.create({
        data: {
          invoiceNumber: `${year}-001`,
          matterId: other.matterId,
          issueDate: new Date(),
          dueDate: new Date(),
          subtotal: 5,
          totalAmount: 5,
          paidAmount: 0,
        },
      })
    );
    const racer = generateInvoiceFromWip(matterId, billingInitialState, new FormData());
    await waitForBlocked(1);
    await holder.release();
    const res = await racer;

    expect(res.status).toBe("ok");
    const mine = await prisma.invoice.findFirstOrThrow({ where: { matterId } });
    expect(mine.invoiceNumber).toBe(`${year}-002`);
    // The retry linked the entry exactly once.
    expect(
      await prisma.timeEntry.count({ where: { matterId, invoiceId: mine.id } })
    ).toBe(1);
  });
});
