/**
 * Invoice email delivery orchestrator: render PDF, file it, email it,
 * log activity. Never throws; reports a warning instead.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

const store = new Map<string, Buffer>();
let storeFails = false;
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/current-user-tz", () => ({ getCurrentUserTimeZone: vi.fn() }));
vi.mock("@/lib/file-storage", () => ({
  storeFile: vi.fn(async (f: File) => {
    if (storeFails) throw new Error("storage down");
    const key = `k__${store.size}__${f.name}`;
    store.set(key, Buffer.from(await f.arrayBuffer()));
    return { key, size: f.size, contentType: f.type };
  }),
  deleteFile: vi.fn(async (k: string) => void store.delete(k)),
}));

import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { prisma } from "@/lib/prisma";
import { deliverInvoiceEmail } from "@/lib/billing/invoice-delivery";
import { captureEmails } from "@/test/email-capture";
import {
  resetDb,
  seedContact,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

let userId: string;
let firmId: string;
let matterId: string;
let invoiceId: string;
let cap: ReturnType<typeof captureEmails>;
const NUMBER = "2026-777";

beforeEach(async () => {
  store.clear();
  storeFails = false;
  await resetDb();
  cap = captureEmails();
  vi.mocked(getCurrentUserTimeZone).mockResolvedValue("America/Denver");
  ({ firmId } = await seedFirm({ name: "Kosloski Law" }));
  ({ userId } = await seedUser({ firmId, email: "atty@firm.com" }));
  const area = await seedPracticeArea();
  ({ matterId } = await seedMatter({
    practiceAreaId: area.areaId,
    stageId: area.stageId,
    leadUserId: userId,
  }));
  invoiceId = (
    await prisma.invoice.create({
      data: {
        invoiceNumber: NUMBER,
        matterId,
        kind: "client",
        issueDate: new Date("2026-10-01T00:00:00Z"),
        dueDate: new Date("2026-10-31T00:00:00Z"),
        subtotal: 500,
        totalAmount: 500,
        status: "sent",
      },
      select: { id: true },
    })
  ).id;
});
afterEach(() => cap.restore());

const run = (kind: "initial" | "updated" | "resend" = "initial") =>
  deliverInvoiceEmail({ invoiceId, to: "client@x.com", userId, kind });

describe("deliverInvoiceEmail", () => {
  test("emails the PDF, files it, logs activity", async () => {
    expect(await run()).toEqual({ ok: true });
    expect(cap.sent).toHaveLength(1);
    const msg = cap.sent[0];
    expect(msg.to).toBe("client@x.com");
    expect(msg.fromName).toBe("Kosloski Law");
    expect(msg.replyTo).toBe("atty@firm.com");
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments![0].filename).toBe(`Invoice ${NUMBER}.pdf`);
    expect(msg.attachments![0].content.subarray(0, 4).toString()).toBe("%PDF");
    expect(await prisma.document.count({ where: { matterId, source: "invoice" } })).toBe(1);
    const log = await prisma.activityLog.findFirstOrThrow({ where: { matterId } });
    expect(log.title).toBe(`Invoice ${NUMBER} emailed to client@x.com`);
    expect(log.type).toBe("filing");
    expect(log.detail).toBe("Resend id test-1");
  });

  test("updated kind titles the activity accordingly", async () => {
    await run("updated");
    const log = await prisma.activityLog.findFirstOrThrow({ where: { matterId } });
    expect(log.title).toBe(`Updated invoice ${NUMBER} emailed to client@x.com`);
  });

  test("portal link included only when portal billing is available", async () => {
    await prisma.firm.update({ where: { id: firmId }, data: { portalEnabled: true } });
    const { contactId } = await seedContact({ name: "Client" });
    await prisma.matter.update({
      where: { id: matterId },
      data: { clientId: contactId, portalBillingEnabled: true },
    });
    const identity = await prisma.portalIdentity.create({
      data: { contactId, email: "c@example.com" },
    });
    await prisma.portalMatterAccess.create({
      data: { identityId: identity.id, matterId, invitedById: userId },
    });
    await run();
    expect(cap.sent[0].text).toContain(`/matters/${matterId}/invoices/${invoiceId}`);

    await prisma.matter.update({ where: { id: matterId }, data: { portalBillingEnabled: false } });
    await run();
    expect(cap.sent[1].text).not.toContain(`/matters/${matterId}/invoices/`);
  });

  test("email failure warns, logs a failure, still files the PDF", async () => {
    cap.restore();
    cap = captureEmails({ fail: "Resend responded 500" });
    const r = await run();
    expect(r).toMatchObject({ ok: false, emailSent: false });
    if (!r.ok) expect(r.warning).toContain("Resend responded 500");
    const log = await prisma.activityLog.findFirstOrThrow({ where: { matterId } });
    expect(log.title).toBe(`Invoice ${NUMBER} email failed: client@x.com`);
    expect(log.detail).toBe("Resend responded 500");
    expect(await prisma.document.count({ where: { matterId, source: "invoice" } })).toBe(1);
  });

  test("filing failure still emails and warns about Documents", async () => {
    storeFails = true;
    const r = await run();
    expect(cap.sent).toHaveLength(1);
    expect(r).toMatchObject({ ok: false, emailSent: true });
    if (!r.ok) expect(r.warning).toContain("Documents");
  });

  test("missing invoice returns a warning without throwing or emailing", async () => {
    const r = await deliverInvoiceEmail({ invoiceId: "nope", to: "client@x.com", userId, kind: "initial" });
    expect(r.ok).toBe(false);
    expect(cap.sent).toHaveLength(0);
  });
});
