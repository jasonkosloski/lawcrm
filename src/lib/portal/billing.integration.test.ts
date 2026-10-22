import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  resetDb,
  seedContact,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";
import { getInvoiceById } from "@/lib/queries/billing";
import {
  getPortalBillingForMatter,
  getPortalInvoice,
  getPortalTrust,
  listPortalInvoices,
  portalBalanceDueByMatter,
} from "./billing";

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

let firmId: string;
let userId: string;
let clientId: string; // primary client + identity contact
let otherId: string; // co-client contact
let identityId: string;
let otherIdentityId: string;
let matterId: string;
let areaId: string;
let stageId: string;
let seq = 0;

async function mkInvoice(
  opts: {
    matterId?: string;
    status?: string;
    kind?: string;
    clientId?: string | null;
    total?: string;
    paid?: string;
    dueDate?: Date;
    issueDate?: Date;
  } = {},
) {
  seq += 1;
  return prisma.invoice.create({
    data: {
      invoiceNumber: `T-${seq}`,
      matterId: opts.matterId ?? matterId,
      clientId: opts.clientId === undefined ? null : opts.clientId,
      kind: opts.kind ?? "client",
      status: opts.status ?? "sent",
      issueDate: opts.issueDate ?? new Date("2026-01-01T00:00:00Z"),
      dueDate: opts.dueDate ?? new Date("2999-01-01T00:00:00Z"),
      subtotal: opts.total ?? "100.00",
      totalAmount: opts.total ?? "100.00",
      paidAmount: opts.paid ?? "0",
    },
  });
}

async function mkTrust(
  amount: string,
  date: string,
  extra: { createdAt?: Date; type?: string } = {},
) {
  return prisma.trustTransaction.create({
    data: {
      matterId,
      type: extra.type ?? (amount.startsWith("-") ? "disbursement" : "deposit"),
      amount,
      description: `d ${amount}`,
      date: new Date(date),
      ...(extra.createdAt ? { createdAt: extra.createdAt } : {}),
    },
  });
}

beforeEach(async () => {
  await resetDb();
  ({ firmId } = await seedFirm());
  await prisma.firm.update({ where: { id: firmId }, data: { portalEnabled: true } });
  ({ userId } = await seedUser({ firmId }));
  ({ areaId, stageId } = await seedPracticeArea());
  ({ contactId: clientId } = await seedContact({ email: "jane@example.com" }));
  ({ contactId: otherId } = await seedContact({ email: "bob@example.com" }));
  identityId = (
    await prisma.portalIdentity.create({ data: { contactId: clientId, email: "jane@example.com" } })
  ).id;
  otherIdentityId = (
    await prisma.portalIdentity.create({ data: { contactId: otherId, email: "bob@example.com" } })
  ).id;
  ({ matterId } = await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: userId }));
  await prisma.matter.update({
    where: { id: matterId },
    data: { clientId, portalBillingEnabled: true },
  });
  for (const id of [identityId, otherIdentityId]) {
    await prisma.portalMatterAccess.create({
      data: { identityId: id, matterId, invitedById: userId },
    });
  }
});

afterEach(() => {
  vi.useRealTimers();
});

describe("visibility", () => {
  test("shows sent, partial and paid client invoices to the billed contact", async () => {
    await mkInvoice({ status: "sent" });
    await mkInvoice({ status: "partial", paid: "40" });
    await mkInvoice({ status: "paid", paid: "100" });
    const rows = await listPortalInvoices(identityId, matterId);
    expect(rows.map((r) => r.status).sort()).toEqual(["paid", "partial", "sent"]);
  });

  test("hides everything when the matter switch is off", async () => {
    const inv = await mkInvoice();
    await mkTrust("50.00", "2026-01-01");
    await prisma.matter.update({ where: { id: matterId }, data: { portalBillingEnabled: false } });
    expect(await listPortalInvoices(identityId, matterId)).toEqual([]);
    expect(await getPortalInvoice(identityId, inv.id)).toBeNull();
    expect(await getPortalTrust(identityId, matterId)).toBeNull();
    expect(await getPortalBillingForMatter(identityId, matterId)).toBeNull();
    expect((await portalBalanceDueByMatter(identityId, [matterId])).size).toBe(0);
  });

  test("a non-billed co-client sees no invoices, no trust, and canSee is false", async () => {
    const inv = await mkInvoice();
    await mkTrust("50.00", "2026-01-01");
    expect(await listPortalInvoices(otherIdentityId, matterId)).toEqual([]);
    expect(await getPortalInvoice(otherIdentityId, inv.id)).toBeNull();
    expect(await getPortalTrust(otherIdentityId, matterId)).toBeNull();
    expect(await getPortalBillingForMatter(otherIdentityId, matterId)).toBeNull();
    expect((await portalBalanceDueByMatter(otherIdentityId, [matterId])).size).toBe(0);
  });

  test("an invoice billed to the co-client is visible to them, not to the primary client", async () => {
    const inv = await mkInvoice({ clientId: otherId });
    expect((await listPortalInvoices(otherIdentityId, matterId)).map((r) => r.id)).toEqual([
      inv.id,
    ]);
    expect(await getPortalInvoice(otherIdentityId, inv.id)).not.toBeNull();
    expect(await getPortalBillingForMatter(otherIdentityId, matterId)).not.toBeNull();
    expect(await getPortalTrust(otherIdentityId, matterId)).toBeNull();
    expect(await listPortalInvoices(identityId, matterId)).toEqual([]);
    expect(await getPortalInvoice(identityId, inv.id)).toBeNull();
  });

  test.each(["draft", "approved", "void"])("never shows a %s invoice", async (status) => {
    const inv = await mkInvoice({ status });
    expect(await listPortalInvoices(identityId, matterId)).toEqual([]);
    expect(await getPortalInvoice(identityId, inv.id)).toBeNull();
  });

  test("never shows an internal_record invoice", async () => {
    const inv = await mkInvoice({ kind: "internal_record" });
    expect(await listPortalInvoices(identityId, matterId)).toEqual([]);
    expect(await getPortalInvoice(identityId, inv.id)).toBeNull();
  });

  test("hidden when access revoked, portal off, or identity disabled", async () => {
    const inv = await mkInvoice();
    await mkTrust("50.00", "2026-01-01");
    const gone = async () => {
      expect(await listPortalInvoices(identityId, matterId)).toEqual([]);
      expect(await getPortalInvoice(identityId, inv.id)).toBeNull();
      expect(await getPortalTrust(identityId, matterId)).toBeNull();
      expect(await getPortalBillingForMatter(identityId, matterId)).toBeNull();
    };
    await prisma.portalMatterAccess.updateMany({
      where: { identityId },
      data: { revokedAt: new Date() },
    });
    await gone();
    await prisma.portalMatterAccess.updateMany({
      where: { identityId },
      data: { revokedAt: null },
    });
    await prisma.firm.update({ where: { id: firmId }, data: { portalEnabled: false } });
    await gone();
    await prisma.firm.update({ where: { id: firmId }, data: { portalEnabled: true } });
    await prisma.portalIdentity.update({
      where: { id: identityId },
      data: { disabledAt: new Date() },
    });
    await gone();
  });

  test("null Invoice.clientId falls back to Matter.clientId; changing the client hides it from the old one", async () => {
    const inv = await mkInvoice({ clientId: null });
    expect(await getPortalInvoice(identityId, inv.id)).not.toBeNull();
    await prisma.matter.update({ where: { id: matterId }, data: { clientId: otherId } });
    expect(await getPortalInvoice(identityId, inv.id)).toBeNull();
    expect(await listPortalInvoices(identityId, matterId)).toEqual([]);
    expect(await getPortalInvoice(otherIdentityId, inv.id)).not.toBeNull();
  });

  test("a matter id the identity has no access to returns nothing", async () => {
    const { matterId: m2 } = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
    });
    await prisma.matter.update({
      where: { id: m2 },
      data: { clientId, portalBillingEnabled: true },
    });
    const inv = await mkInvoice({ matterId: m2 });
    expect(await listPortalInvoices(identityId, m2)).toEqual([]);
    expect(await getPortalInvoice(identityId, inv.id)).toBeNull();
  });
});

describe("amounts", () => {
  test("totals equal the staff getInvoiceById and include matterId", async () => {
    const inv = await mkInvoice({ total: "1234.56", paid: "0.10", status: "partial" });
    const portal = await getPortalInvoice(identityId, inv.id);
    const staff = await getInvoiceById(inv.id, "America/Denver");
    expect(portal).toEqual({ ...staff, matterId });
    const [row] = await listPortalInvoices(identityId, matterId);
    expect(row.totalAmount).toBe(staff!.totalAmount);
    expect(row.paidAmount).toBe(staff!.paidAmount);
    expect(row.balance).toBe(staff!.balance);
    expect(row.balance).toBe(1234.46);
  });

  test("newest issue date first", async () => {
    const a = await mkInvoice({ issueDate: new Date("2026-01-01T00:00:00Z") });
    const b = await mkInvoice({ issueDate: new Date("2026-03-01T00:00:00Z") });
    expect((await listPortalInvoices(identityId, matterId)).map((r) => r.id)).toEqual([b.id, a.id]);
  });
});

describe("overdue (instant due date, Denver calendar day)", () => {
  test("flips at the Denver day boundary", async () => {
    // Due instant 2026-06-10 19:00 MDT: the Denver due day is Jun 10.
    await mkInvoice({ dueDate: new Date("2026-06-11T01:00:00Z") });
    vi.useFakeTimers({ toFake: ["Date"] });
    // 2026-06-10 23:30 MDT: still the due day (UTC is already Jun 11).
    vi.setSystemTime(new Date("2026-06-11T05:30:00Z"));
    expect((await listPortalInvoices(identityId, matterId))[0].overdue).toBe(false);
    // 2026-06-11 00:30 MDT: past due.
    vi.setSystemTime(new Date("2026-06-11T06:30:00Z"));
    expect((await listPortalInvoices(identityId, matterId))[0].overdue).toBe(true);
  });

  test("paid invoices are never overdue", async () => {
    await mkInvoice({ status: "paid", paid: "100", dueDate: new Date("2020-01-01T00:00:00Z") });
    expect((await listPortalInvoices(identityId, matterId))[0].overdue).toBe(false);
  });
});

describe("portalBalanceDueByMatter", () => {
  test("sums unpaid visible balances, drops paid and void", async () => {
    await mkInvoice({ total: "100.00" });
    await mkInvoice({ status: "partial", total: "200.00", paid: "50.00" });
    await mkInvoice({ status: "paid", total: "300.00", paid: "300.00" });
    const v = await mkInvoice({ total: "999.00" });
    expect((await portalBalanceDueByMatter(identityId, [matterId])).get(matterId)).toBe(1249);
    await prisma.invoice.update({ where: { id: v.id }, data: { status: "void" } });
    expect((await portalBalanceDueByMatter(identityId, [matterId])).get(matterId)).toBe(250);
  });

  test("omits matters with nothing due", async () => {
    await mkInvoice({ status: "paid", paid: "100" });
    expect((await portalBalanceDueByMatter(identityId, [matterId])).has(matterId)).toBe(false);
    expect((await portalBalanceDueByMatter(identityId, [])).size).toBe(0);
  });
});

describe("getPortalBillingForMatter", () => {
  test("returns invoices and trust together for the billed primary client", async () => {
    const inv = await mkInvoice();
    await mkTrust("50.00", "2026-01-01");
    const billing = await getPortalBillingForMatter(identityId, matterId);
    expect(billing!.invoices.map((r) => r.id)).toEqual([inv.id]);
    expect(billing!.trust).toEqual(await getPortalTrust(identityId, matterId));
  });

  test("co-client with only an invoice gets invoices and null trust; one with nothing gets null", async () => {
    const inv = await mkInvoice({ clientId: otherId });
    const billing = await getPortalBillingForMatter(otherIdentityId, matterId);
    expect(billing!.invoices.map((r) => r.id)).toEqual([inv.id]);
    expect(billing!.trust).toBeNull();
    await prisma.invoice.deleteMany({ where: { matterId } });
    expect(await getPortalBillingForMatter(otherIdentityId, matterId)).toBeNull();
  });

  test("null when the matter switch is off", async () => {
    await mkInvoice();
    await prisma.matter.update({ where: { id: matterId }, data: { portalBillingEnabled: false } });
    expect(await getPortalBillingForMatter(identityId, matterId)).toBeNull();
  });
});

describe("trust", () => {
  test("primary client sees newest-first ledger with stable same-day running balance", async () => {
    const t0 = new Date("2026-01-01T10:00:00Z");
    await mkTrust("100.00", "2026-02-01", { createdAt: t0 });
    await mkTrust("-30.00", "2026-02-01", { createdAt: new Date(t0.getTime() + 1000) });
    await mkTrust("10.50", "2026-02-01", { createdAt: new Date(t0.getTime() + 2000) });
    await mkTrust("5.00", "2026-01-15");
    await prisma.matter.update({ where: { id: matterId }, data: { trustBalance: "85.50" } });
    const trust = await getPortalTrust(identityId, matterId);
    expect(trust!.balance).toBe(85.5);
    expect(trust!.entries.map((e) => e.amount)).toEqual([10.5, -30, 100, 5]);
    expect(trust!.entries.map((e) => e.runningBalance)).toEqual([85.5, 75, 105, 5]);
    // Balance is not coincidentally any single amount: it is the newest
    // running balance of the ledger.
    expect(trust!.balance).toBe(trust!.entries[0].runningBalance);
    expect(trust!.entries[0].runningBalance).toBe(trust!.entries.reduce((s, e) => s + e.amount, 0));
    expect(await getPortalBillingForMatter(identityId, matterId)).not.toBeNull();
  });

  test("a matter with no invoices and no trust still yields an empty-ledger object for the primary client", async () => {
    const trust = await getPortalTrust(identityId, matterId);
    expect(trust).toEqual({ balance: 0, entries: [] });
  });
});
