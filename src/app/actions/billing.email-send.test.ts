/**
 * Invoice email delivery wiring: sendInvoice (email), the updated-invoice
 * email after a payment, and resendInvoiceEmail. The delivery pipeline
 * itself is covered in src/lib/billing/*.test.ts.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

const store = new Map<string, Buffer>();
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
    const key = `k__${store.size}__${f.name}`;
    store.set(key, Buffer.from(await f.arrayBuffer()));
    return { key, size: f.size, contentType: f.type };
  }),
  deleteFile: vi.fn(async (k: string) => void store.delete(k)),
}));

import { notFound } from "next/navigation";
import { getCurrentUserId } from "@/lib/current-user";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { currentUserHasPermission, requirePermission } from "@/lib/permission-check";
import { assertChildMatterAccess } from "@/lib/matter-access";
import { prisma } from "@/lib/prisma";
import { recordInvoicePayment, resendInvoiceEmail, sendInvoice } from "@/app/actions/billing";
import { billingInitialState } from "@/lib/billing-form";
import {
  resetDb,
  seedContact,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";
import { captureEmails } from "@/test/email-capture";

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

let userId: string;
let matterId: string;
let cap: ReturnType<typeof captureEmails>;

beforeEach(async () => {
  await resetDb();
  store.clear();
  cap = captureEmails();
  const { firmId } = await seedFirm();
  ({ userId } = await seedUser({ firmId }));
  vi.mocked(getCurrentUserId).mockResolvedValue(userId);
  vi.mocked(getCurrentUserTimeZone).mockResolvedValue("America/Denver");
  vi.mocked(assertChildMatterAccess).mockResolvedValue(null);
  vi.mocked(requirePermission).mockClear();
  const area = await seedPracticeArea();
  ({ matterId } = await seedMatter({
    practiceAreaId: area.areaId,
    stageId: area.stageId,
    leadUserId: userId,
  }));
});
afterEach(() => cap.restore());

async function makeInvoice(status = "approved", total = 1000) {
  return (
    await prisma.invoice.create({
      data: {
        invoiceNumber: "2026-901",
        matterId,
        kind: "client",
        issueDate: new Date("2026-10-01T12:00:00Z"),
        dueDate: new Date("2026-10-31T12:00:00Z"),
        subtotal: total,
        totalAmount: total,
        status,
      },
      select: { id: true },
    })
  ).id;
}

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const sendForm = (o: Record<string, string> = {}) =>
  fd({ method: "email", recipient: "client@example.com", ...o });
const statusOf = async (id: string) =>
  (await prisma.invoice.findUniqueOrThrow({ where: { id } })).status;

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

describe("sendInvoice by email", () => {
  test("marks sent, emails the PDF, logs the delivery", async () => {
    const id = await makeInvoice();
    const res = await sendInvoice(id, billingInitialState, sendForm());
    expect(res.status).toBe("ok");
    expect(res.warning).toBeUndefined();
    expect(await statusOf(id)).toBe("sent");
    expect(cap.sent).toHaveLength(1);
    expect(cap.sent[0].to).toBe("client@example.com");
    expect(cap.sent[0].attachments).toHaveLength(1);
    const titles = (await prisma.activityLog.findMany({ where: { matterId } })).map((l) => l.title);
    expect(titles).toContain("Invoice 2026-901 emailed to client@example.com");
    expect(titles.some((t) => t.includes("not emailed"))).toBe(false);
  });

  test("the idempotency key is stable within a minute (double-submit dedupes)", async () => {
    const id = await makeInvoice();
    await sendInvoice(id, billingInitialState, sendForm());
    const key = cap.sent[0].idempotencyKey;
    expect(key).toMatch(new RegExp(`^invoice-${id}-initial-client@example\\.com-\\d+$`));
    // Deterministic: same inputs in the same minute rebuild the same key.
    const bucket = Math.floor(Date.now() / 60_000);
    expect([bucket, bucket - 1].map((b) => `invoice-${id}-initial-client@example.com-${b}`)).toContain(key);
  });

  test("rejects a multi-recipient string", async () => {
    const id = await makeInvoice();
    const res = await sendInvoice(id, billingInitialState, sendForm({ recipient: "a@b.com, c@d.com" }));
    expect(res.status).toBe("error");
    expect(res.errors?.recipient).toBeDefined();
    expect(cap.sent).toHaveLength(0);
    expect(await statusOf(id)).toBe("approved");
  });

  test("with applyTrust the PDF shows the trust payment", async () => {
    await prisma.matter.update({ where: { id: matterId }, data: { trustBalance: 2000 } });
    const id = await makeInvoice();
    const res = await sendInvoice(id, billingInitialState, sendForm({ applyTrust: "true", trustAmount: "123.45" }));
    expect(res.status).toBe("ok");
    expect(await statusOf(id)).toBe("partial");
    const pdf = cap.sent[0].attachments![0].content as Buffer;
    expect(await extractText(Buffer.from(pdf))).toContain("$123.45");
  });

  test("a failing driver keeps the send and trust, and warns", async () => {
    cap.restore();
    cap = captureEmails({ fail: "boom" });
    await prisma.matter.update({ where: { id: matterId }, data: { trustBalance: 2000 } });
    const id = await makeInvoice();
    const res = await sendInvoice(id, billingInitialState, sendForm({ applyTrust: "true", trustAmount: "100" }));
    expect(res.status).toBe("ok");
    expect(res.warning).toContain("Re-send email");
    expect(res.warning).toContain("Invoice 2026-901 was marked sent.");
    expect(await statusOf(id)).toBe("partial");
    expect(await prisma.trustTransaction.count({ where: { matterId } })).toBe(1);
  });
});

describe("recordInvoicePayment notifyClient", () => {
  test("emails an updated invoice to the client", async () => {
    const { contactId } = await seedContact({ name: "Pat", email: "pat@example.com" });
    await prisma.matter.update({ where: { id: matterId }, data: { clientId: contactId } });
    const id = await makeInvoice("sent", 100);
    const res = await recordInvoicePayment(id, billingInitialState, fd({ amount: "25", source: "check", notifyClient: "true" }));
    expect(res.status).toBe("ok");
    expect(cap.sent).toHaveLength(1);
    expect(cap.sent[0].to).toBe("pat@example.com");
    expect(cap.sent[0].subject.startsWith("Updated invoice")).toBe(true);
  });

  test("without billing.send_invoice: payment recorded, no email, warning", async () => {
    const { contactId } = await seedContact({ name: "Pat", email: "pat@example.com" });
    await prisma.matter.update({ where: { id: matterId }, data: { clientId: contactId } });
    const id = await makeInvoice("sent", 100);
    vi.mocked(currentUserHasPermission).mockImplementation(
      async (key: string) => key !== "billing.send_invoice"
    );
    try {
      const res = await recordInvoicePayment(id, billingInitialState, fd({ amount: "25", source: "check", notifyClient: "true" }));
      expect(res.status).toBe("ok");
      expect(res.warning).toBe(
        "Payment recorded. You don't have permission to email invoices, so no updated copy was sent."
      );
      expect(cap.sent).toHaveLength(0);
      expect(await prisma.invoicePayment.count({ where: { invoiceId: id } })).toBe(1);
    } finally {
      vi.mocked(currentUserHasPermission).mockReset();
      vi.mocked(currentUserHasPermission).mockResolvedValue(true);
    }
  });

  test("permission lookup throwing after commit: payment stays ok with warning, no email", async () => {
    const { contactId } = await seedContact({ name: "Pat", email: "pat@example.com" });
    await prisma.matter.update({ where: { id: matterId }, data: { clientId: contactId } });
    const id = await makeInvoice("sent", 100);
    vi.mocked(currentUserHasPermission).mockImplementation(async (key: string) => {
      if (key === "billing.send_invoice") throw new Error("db blip");
      return true;
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await recordInvoicePayment(id, billingInitialState, fd({ amount: "25", source: "check", notifyClient: "true" }));
      expect(res.status).toBe("ok");
      expect(res.warning).toBe(
        "Payment recorded, but the updated invoice couldn't be emailed. Use Re-send email to retry."
      );
      expect(cap.sent).toHaveLength(0);
      expect(await prisma.invoicePayment.count({ where: { invoiceId: id } })).toBe(1);
    } finally {
      errSpy.mockRestore();
      vi.mocked(currentUserHasPermission).mockReset();
      vi.mocked(currentUserHasPermission).mockResolvedValue(true);
    }
  });

  test("no client email: no email, payment still recorded", async () => {
    const id = await makeInvoice("sent", 100);
    const res = await recordInvoicePayment(id, billingInitialState, fd({ amount: "25", source: "check", notifyClient: "true" }));
    expect(res.status).toBe("ok");
    expect(cap.sent).toHaveLength(0);
    expect(await prisma.invoicePayment.count({ where: { invoiceId: id } })).toBe(1);
  });
});

describe("resendInvoiceEmail", () => {
  test("re-sends a sent invoice without changing its status", async () => {
    const id = await makeInvoice("sent");
    const res = await resendInvoiceEmail(id, billingInitialState, fd({ recipient: "a@example.com" }));
    expect(res.status).toBe("ok");
    expect(cap.sent).toHaveLength(1);
    expect(await statusOf(id)).toBe("sent");
    expect(requirePermission).toHaveBeenCalledWith("billing.send_invoice");
  });

  test("rejects a multi-recipient string", async () => {
    const id = await makeInvoice("sent");
    const res = await resendInvoiceEmail(id, billingInitialState, fd({ recipient: "a@b.com, c@d.com" }));
    expect(res.status).toBe("error");
    expect(res.errors?.recipient).toBeDefined();
    expect(cap.sent).toHaveLength(0);
  });

  test("refuses an approved invoice", async () => {
    const id = await makeInvoice("approved");
    const res = await resendInvoiceEmail(id, billingInitialState, fd({ recipient: "a@example.com" }));
    expect(res).toMatchObject({ status: "error", error: "Only sent invoices can be re-sent." });
    expect(cap.sent).toHaveLength(0);
  });

  test("rejects an invalid recipient", async () => {
    const id = await makeInvoice("sent");
    const res = await resendInvoiceEmail(id, billingInitialState, fd({ recipient: "nope" }));
    expect(res.status).toBe("error");
    expect(res.errors?.recipient).toBeDefined();
    expect(cap.sent).toHaveLength(0);
  });

  test("permission failure rejects before anything is sent", async () => {
    const id = await makeInvoice("sent");
    vi.mocked(requirePermission).mockRejectedValueOnce(new Error("forbidden"));
    await expect(
      resendInvoiceEmail(id, billingInitialState, fd({ recipient: "a@example.com" }))
    ).rejects.toThrow("forbidden");
    expect(requirePermission).toHaveBeenCalledWith("billing.send_invoice");
    expect(cap.sent).toHaveLength(0);
  });

  test("matter access failure rejects before anything is sent", async () => {
    const id = await makeInvoice("sent");
    vi.mocked(assertChildMatterAccess).mockImplementationOnce(async () => notFound());
    await expect(
      resendInvoiceEmail(id, billingInitialState, fd({ recipient: "a@example.com" }))
    ).rejects.toThrow();
    expect(cap.sent).toHaveLength(0);
  });

  test("a failing driver returns an error with the warning text", async () => {
    cap.restore();
    cap = captureEmails({ fail: "boom" });
    const id = await makeInvoice("sent");
    const res = await resendInvoiceEmail(id, billingInitialState, fd({ recipient: "a@example.com" }));
    expect(res.status).toBe("error");
    expect(res.error).toContain("Re-send email");
  });
});
