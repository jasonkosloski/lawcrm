/**
 * voidInvoice: voids, then stamps filed PDFs VOID (or files a stamped
 * fresh copy) and emails the client. Post-commit failures never undo the
 * void.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { PDFDocument } from "pdf-lib";

const store = new Map<string, Buffer>();
let failStoreFor: string | null = null;
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/current-user-tz", () => ({ getCurrentUserTimeZone: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn().mockResolvedValue("test-user"),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/matter-access", async (orig) => ({
  ...(await orig<typeof import("@/lib/matter-access")>()),
  assertChildMatterAccess: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/file-storage", () => ({
  statFile: vi.fn(async (k: string) => (store.has(k) ? { size: store.get(k)!.length } : null)),
  readStoredFile: vi.fn(async (k: string) => store.get(k) ?? null),
  storeFile: vi.fn(async (f: File) => {
    if (failStoreFor && f.name.includes(failStoreFor)) throw new Error("storage down");
    const key = `k__${store.size}__${f.name}`;
    store.set(key, Buffer.from(await f.arrayBuffer()));
    return { key, size: f.size, contentType: f.type };
  }),
  deleteFile: vi.fn(async (k: string) => void store.delete(k)),
}));

import { getCurrentUserId } from "@/lib/current-user";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { currentUserHasPermission, requirePermission } from "@/lib/permission-check";
import { assertChildMatterAccess } from "@/lib/matter-access";
import { prisma } from "@/lib/prisma";
import * as pdf from "@/lib/billing/invoice-pdf";
import * as firmLib from "@/lib/firm";
import { voidInvoice } from "@/app/actions/billing";
import { billingInitialState } from "@/lib/billing-form";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedTimeEntry,
  seedUser,
} from "@/test/integration-helpers";
import { captureEmails } from "@/test/email-capture";

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

let userId: string;
let matterId: string;
let cap: ReturnType<typeof captureEmails>;
const N = "2026-901";

beforeEach(async () => {
  await resetDb();
  store.clear();
  failStoreFor = null;
  vi.restoreAllMocks();
  cap = captureEmails();
  const { firmId } = await seedFirm({ name: "Kosloski Law" });
  ({ userId } = await seedUser({ firmId, email: "atty@firm.com" }));
  vi.mocked(getCurrentUserId).mockResolvedValue(userId);
  vi.mocked(getCurrentUserTimeZone).mockResolvedValue("America/Denver");
  vi.mocked(assertChildMatterAccess).mockResolvedValue(null);
  vi.mocked(requirePermission).mockResolvedValue("test-user");
  vi.mocked(currentUserHasPermission).mockResolvedValue(true);
  const area = await seedPracticeArea();
  ({ matterId } = await seedMatter({
    practiceAreaId: area.areaId,
    stageId: area.stageId,
    leadUserId: userId,
  }));
});
afterEach(() => cap.restore());

async function makeInvoice(status = "sent", opts: { paid?: number; number?: string } = {}) {
  const inv = await prisma.invoice.create({
    data: {
      invoiceNumber: opts.number ?? N,
      matterId,
      kind: "client",
      issueDate: new Date("2026-10-01T12:00:00Z"),
      dueDate: new Date("2026-10-31T12:00:00Z"),
      subtotal: 250,
      totalAmount: 250,
      paidAmount: opts.paid ?? 0,
      status,
    },
    select: { id: true },
  });
  await seedTimeEntry({ matterId, userId, status: "billed", invoiceId: inv.id });
  return inv.id;
}

async function filedCopy(invoiceId: string, name: string, key: string) {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]).drawText(`Invoice ${N}`);
  store.set(key, Buffer.from(await doc.save()));
  return prisma.document.create({
    data: {
      matterId, invoiceId, name, fileUrl: key, fileSize: store.get(key)!.length,
      contentType: "application/pdf", source: "invoice",
    },
  });
}

const form = (o: Record<string, string> = {}) => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ notifyClient: "true", recipient: "client@example.com", ...o })) {
    f.set(k, v);
  }
  return f;
};
const run = (id: string, o: Record<string, string> = {}) =>
  voidInvoice(id, billingInitialState, form(o));
const statusOf = async (id: string) =>
  (await prisma.invoice.findUniqueOrThrow({ where: { id } })).status;
const titles = async () =>
  (await prisma.activityLog.findMany({ where: { matterId } })).map((l) => l.title);

async function extractText(buf: Buffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    parts.push(content.items.map((it) => ("str" in it ? it.str : "")).join(" "));
  }
  return parts.join("\n").replace(/\s+/g, " ");
}

describe("voidInvoice (sent)", () => {
  test("stamps both filed copies, emails the stamped PDF, unlinks entries", async () => {
    const id = await makeInvoice();
    const a = await filedCopy(id, `Invoice ${N} (sent 2026-10-02).pdf`, "old-a");
    const b = await filedCopy(id, `Invoice ${N} (resent 2026-10-03).pdf`, "old-b");
    const res = await run(id);
    expect(res).toEqual({ status: "ok" });
    expect(await statusOf(id)).toBe("void");
    for (const [doc, old] of [[a, "old-a"], [b, "old-b"]] as const) {
      const row = await prisma.document.findUniqueOrThrow({ where: { id: doc.id } });
      expect(row.name).toBe(doc.name);
      expect(row.fileUrl).not.toBe(old);
      expect(store.has(old)).toBe(false);
      expect(await extractText(store.get(row.fileUrl!)!)).toContain("VOID");
    }
    expect(cap.sent).toHaveLength(1);
    const msg = cap.sent[0];
    expect(msg.to).toBe("client@example.com");
    expect(msg.subject).toBe(`Invoice ${N} from Kosloski Law has been voided`);
    expect(msg.fromName).toBe("Kosloski Law");
    expect(msg.replyTo).toBe("atty@firm.com");
    expect(msg.idempotencyKey).toMatch(new RegExp(`^invoice-void-${id}-[0-9a-f-]{36}$`));
    expect(msg.attachments![0].filename).toBe(`Invoice ${N} (VOID).pdf`);
    expect(await extractText(msg.attachments![0].content)).toContain("VOID");
    const t = await titles();
    expect(t).toContain(`Stamped 2 filed PDF(s) of invoice ${N} VOID`);
    expect(t).toContain(`Void notice for invoice ${N} emailed to client@example.com`);
    const entries = await prisma.timeEntry.findMany({ where: { matterId } });
    expect(entries.every((e) => e.invoiceId === null)).toBe(true);
  });

  test("with no filed copy, files a stamped fresh render that lists the line items", async () => {
    const id = await makeInvoice();
    const res = await run(id);
    expect(res).toEqual({ status: "ok" });
    const docs = await prisma.document.findMany({ where: { invoiceId: id } });
    expect(docs).toHaveLength(1);
    expect(docs[0].name).toMatch(new RegExp(`^Invoice ${N} \\(void \\d{4}-\\d{2}-\\d{2}\\)\\.pdf$`));
    const text = await extractText(store.get(docs[0].fileUrl!)!);
    expect(text).toContain("VOID");
    expect(text).toContain("Test work");
    expect(cap.sent).toHaveLength(1);
    expect(await extractText(cap.sent[0].attachments![0].content)).toContain("Test work");
    expect(await titles()).toContain(`Filed voided copy of invoice ${N}`);
  });

  test("unticked: stamped, no email", async () => {
    const id = await makeInvoice();
    await filedCopy(id, `Invoice ${N} (sent 2026-10-02).pdf`, "old-a");
    const res = await voidInvoice(id, billingInitialState, form({ notifyClient: "" }));
    expect(res).toEqual({ status: "ok" });
    expect(cap.sent).toHaveLength(0);
    expect((await titles()).some((t) => t.startsWith("Stamped 1"))).toBe(true);
  });

  test("without billing.send_invoice: stamped, no email", async () => {
    vi.mocked(currentUserHasPermission).mockImplementation(async (k: string) => k !== "billing.send_invoice");
    const id = await makeInvoice();
    await filedCopy(id, `Invoice ${N} (sent 2026-10-02).pdf`, "old-a");
    expect(await run(id)).toEqual({ status: "ok" });
    expect(cap.sent).toHaveLength(0);
    expect((await titles()).some((t) => t.startsWith("Stamped 1"))).toBe(true);
  });

  test("email failure: void stands, warning, failure logged", async () => {
    cap.restore();
    cap = captureEmails({ fail: "mailbox full" });
    const id = await makeInvoice();
    await filedCopy(id, `Invoice ${N} (sent 2026-10-02).pdf`, "old-a");
    const res = await run(id);
    expect(res.status).toBe("ok");
    expect(res.warning).toBe("Invoice voided. The void notice didn't go out: mailbox full.");
    expect(await statusOf(id)).toBe("void");
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { matterId, title: `Void notice for invoice ${N} email failed: client@example.com` },
    });
    expect(log.detail).toBe("mailbox full");
  });

  test("one copy fails to stamp: keeps its key, warning, other copy still emailed", async () => {
    const id = await makeInvoice();
    const a = await filedCopy(id, `Invoice ${N} (sent 2026-10-02).pdf`, "old-a");
    await filedCopy(id, `Invoice ${N} (resent 2026-10-03).pdf`, "old-b");
    failStoreFor = "(sent";
    const res = await run(id);
    expect(res.status).toBe("ok");
    expect(res.warning).toBe("Invoice voided. Some filed copies couldn't be stamped VOID.");
    expect((await prisma.document.findUniqueOrThrow({ where: { id: a.id } })).fileUrl).toBe("old-a");
    expect(cap.sent).toHaveLength(1);
    expect(await statusOf(id)).toBe("void");
  });

  test("failed stamps are recorded with the document names, stamped names too", async () => {
    const id = await makeInvoice();
    await filedCopy(id, `Invoice ${N} (sent 2026-10-02).pdf`, "old-a");
    await filedCopy(id, `Invoice ${N} (resent 2026-10-03).pdf`, "old-b");
    failStoreFor = "(sent";
    await run(id);
    const logs = await prisma.activityLog.findMany({ where: { matterId } });
    const failed = logs.find((l) => l.title === `1 filed PDF(s) of invoice ${N} couldn't be stamped VOID`);
    expect(failed?.detail).toBe(`Invoice ${N} (sent 2026-10-02).pdf`);
    const ok = logs.find((l) => l.title === `Stamped 1 filed PDF(s) of invoice ${N} VOID`);
    expect(ok?.detail).toBe(`Invoice ${N} (resent 2026-10-03).pdf`);
  });

  test("approved on first read but sent at the claim: still stamped and emailed", async () => {
    const id = await makeInvoice("approved");
    await filedCopy(id, `Invoice ${N} (sent 2026-10-02).pdf`, "old-a");
    const real = prisma.invoice.findUnique.bind(prisma.invoice);
    let calls = 0;
    vi.spyOn(prisma.invoice, "findUnique").mockImplementation(((args: never) => {
      calls++;
      // The action's own read sees approved; the claim's read sees sent.
      if (calls === 2) {
        return prisma.invoice
          .update({ where: { id }, data: { status: "sent" } })
          .then(() => real(args));
      }
      return real(args);
    }) as never);
    const res = await run(id);
    expect(res).toEqual({ status: "ok" });
    expect(await statusOf(id)).toBe("void");
    expect(cap.sent).toHaveLength(1);
    expect((await titles()).some((t) => t.startsWith("Stamped 1"))).toBe(true);
    const row = await prisma.document.findFirstOrThrow({ where: { invoiceId: id } });
    expect(row.fileUrl).not.toBe("old-a");
  });

  test("sent with a payment recorded: refused before any render", async () => {
    const spy = vi.spyOn(pdf, "renderInvoicePdf");
    const id = await makeInvoice("sent", { paid: 50 });
    const res = await run(id);
    expect(res).toEqual({
      status: "error",
      error: "Can't void an invoice with payments recorded — refund the payments first.",
    });
    expect(spy).not.toHaveBeenCalled();
    expect(await statusOf(id)).toBe("sent");
  });

  test("firm profile can't load: voided, filed, warns, no blank-name email", async () => {
    vi.spyOn(firmLib, "loadFirmProfileForUser").mockRejectedValue(new Error("db blip"));
    const id = await makeInvoice();
    await filedCopy(id, `Invoice ${N} (sent 2026-10-02).pdf`, "old-a");
    const res = await run(id);
    expect(res.status).toBe("ok");
    expect(res.warning).toBe(
      "Invoice voided. The firm profile couldn't be loaded, so the client wasn't emailed."
    );
    expect(await statusOf(id)).toBe("void");
    expect(cap.sent).toHaveLength(0);
  });

  test("email uses the matter's name", async () => {
    const id = await makeInvoice();
    await filedCopy(id, `Invoice ${N} (sent 2026-10-02).pdf`, "old-a");
    await run(id);
    const m = await prisma.matter.findUniqueOrThrow({ where: { id: matterId } });
    expect(JSON.stringify(cap.sent[0])).toContain(m.name);
  });

  test("storage fully down: void stands, warning, no email", async () => {
    const id = await makeInvoice();
    failStoreFor = "Invoice";
    const res = await run(id);
    expect(res.status).toBe("ok");
    expect(res.warning).toMatch(/^Invoice voided\. /);
    expect(await statusOf(id)).toBe("void");
    expect(cap.sent).toHaveLength(1);
  });

  test("fresh render fails: void stands, warns, no email", async () => {
    vi.spyOn(pdf, "renderInvoicePdf").mockRejectedValueOnce(new Error("render boom"));
    const id = await makeInvoice();
    const res = await run(id);
    expect(res.status).toBe("ok");
    expect(res.warning).toBe(
      "Invoice voided. No PDF was available, so the client wasn't emailed."
    );
    expect(await statusOf(id)).toBe("void");
    expect(cap.sent).toHaveLength(0);
  });

  test("calling twice: second errors, nothing stamped or emailed again", async () => {
    const id = await makeInvoice();
    await filedCopy(id, `Invoice ${N} (sent 2026-10-02).pdf`, "old-a");
    await run(id);
    const keyAfterFirst = (await prisma.document.findFirstOrThrow({ where: { invoiceId: id } })).fileUrl;
    const second = await run(id);
    expect(second.status).toBe("error");
    expect(cap.sent).toHaveLength(1);
    expect((await prisma.document.findFirstOrThrow({ where: { invoiceId: id } })).fileUrl).toBe(keyAfterFirst);
  });

  test("a payment landing mid-way: error, nothing stamped, filed or emailed", async () => {
    const id = await makeInvoice();
    const real = pdf.renderInvoicePdf;
    vi.spyOn(pdf, "renderInvoicePdf").mockImplementationOnce(async (...args) => {
      await prisma.invoice.update({ where: { id }, data: { status: "partial", paidAmount: 50 } });
      return real(...args);
    });
    const res = await run(id);
    expect(res.status).toBe("error");
    expect(await statusOf(id)).toBe("partial");
    expect(await prisma.document.count({ where: { matterId } })).toBe(0);
    expect(cap.sent).toHaveLength(0);
  });
});

describe("voidInvoice (other)", () => {
  test("approved: voids, nothing filed, no email", async () => {
    const id = await makeInvoice("approved");
    expect(await run(id)).toEqual({ status: "ok" });
    expect(await statusOf(id)).toBe("void");
    expect(await prisma.document.count({ where: { matterId } })).toBe(0);
    expect(cap.sent).toHaveLength(0);
  });

  test("refused without billing.void_invoice", async () => {
    vi.mocked(requirePermission).mockRejectedValue(new Error("forbidden"));
    const id = await makeInvoice();
    await expect(run(id)).rejects.toThrow("forbidden");
    expect(await statusOf(id)).toBe("sent");
    expect(requirePermission).toHaveBeenCalledWith("billing.void_invoice");
  });

  test("refused across an ethical wall: nothing rendered", async () => {
    const spy = vi.spyOn(pdf, "renderInvoicePdf");
    vi.mocked(assertChildMatterAccess).mockRejectedValue(new Error("walled"));
    const id = await makeInvoice();
    await expect(run(id)).rejects.toThrow("walled");
    expect(spy).not.toHaveBeenCalled();
    expect(await statusOf(id)).toBe("sent");
  });

  test("refused with a payment recorded", async () => {
    const id = await makeInvoice("partial", { paid: 50 });
    const res = await run(id);
    expect(res.status).toBe("error");
    expect(await statusOf(id)).toBe("partial");
    expect(cap.sent).toHaveLength(0);
  });

  test("rejects a bad recipient before voiding", async () => {
    const id = await makeInvoice();
    const res = await run(id, { recipient: "a@b.com, c@d.com" });
    expect(res.status).toBe("error");
    expect(res.errors?.recipient).toBeDefined();
    expect(await statusOf(id)).toBe("sent");
  });
});
