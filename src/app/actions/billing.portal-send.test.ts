/**
 * sendInvoice "portal" method: availability gating, the unchanged send
 * flow, and the posted-invoice email (billed identity only, no amount or
 * matter name).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/current-user-tz", () => ({ getCurrentUserTimeZone: vi.fn() }));
vi.mock("@/lib/file-storage", () => {
  const store = new Map<string, Buffer>();
  return {
    statFile: vi.fn(async (k: string) => (store.has(k) ? { size: store.get(k)!.length } : null)),
    readStoredFile: vi.fn(async (k: string) => store.get(k) ?? null),
    storeFile: vi.fn(async (f: File) => {
      const key = `k__${store.size}__${f.name}`;
      store.set(key, Buffer.from(await f.arrayBuffer()));
      return { key, size: f.size, contentType: f.type };
    }),
    deleteFile: vi.fn(async (k: string) => void store.delete(k)),
  };
});
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn().mockResolvedValue("test-user"),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));

import { getCurrentUserId } from "@/lib/current-user";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { prisma } from "@/lib/prisma";
import { sendInvoice } from "@/app/actions/billing";
import { billingInitialState } from "@/lib/billing-form";
import { portalSendAvailability } from "@/lib/queries/portal-billing";
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
let firmId: string;
let matterId: string;
let clientId: string;
let cap: ReturnType<typeof captureEmails>;

const REASON_ACCESS = "The billed client doesn't have portal access to this matter.";
const REASON_SWITCH = "Turn on 'Show billing in the portal' for this matter first.";

beforeEach(async () => {
  await resetDb();
  cap = captureEmails();
  ({ firmId } = await seedFirm());
  await prisma.firm.update({ where: { id: firmId }, data: { portalEnabled: true } });
  ({ userId } = await seedUser({ firmId }));
  vi.mocked(getCurrentUserId).mockResolvedValue(userId);
  vi.mocked(getCurrentUserTimeZone).mockResolvedValue("America/Denver");
  const area = await seedPracticeArea();
  ({ matterId } = await seedMatter({
    practiceAreaId: area.areaId,
    stageId: area.stageId,
    leadUserId: userId,
    name: "Alvarez secret matter",
  }));
  ({ contactId: clientId } = await seedContact({ name: "Client" }));
  await prisma.matter.update({
    where: { id: matterId },
    data: { clientId, portalBillingEnabled: true },
  });
});
afterEach(() => cap.restore());

async function identityFor(contactId: string, email: string, opts: { revoked?: boolean } = {}) {
  const identity = await prisma.portalIdentity.create({ data: { contactId, email } });
  await prisma.portalMatterAccess.create({
    data: {
      identityId: identity.id,
      matterId,
      invitedById: userId,
      revokedAt: opts.revoked ? new Date() : null,
    },
  });
}

async function makeInvoice(opts: { clientId?: string | null } = {}) {
  return (
    await prisma.invoice.create({
      data: {
        invoiceNumber: "2026-901",
        matterId,
        clientId: opts.clientId ?? null,
        kind: "client",
        issueDate: new Date("2026-10-01T12:00:00Z"),
        dueDate: new Date("2026-10-31T12:00:00Z"),
        subtotal: 1234.56,
        totalAmount: 1234.56,
        status: "approved",
      },
      select: { id: true },
    })
  ).id;
}

const form = (o: Record<string, string> = {}) => {
  const fd = new FormData();
  fd.set("method", "portal");
  for (const [k, v] of Object.entries(o)) fd.set(k, v);
  return fd;
};
const statusOf = async (id: string) =>
  (await prisma.invoice.findUniqueOrThrow({ where: { id } })).status;

describe("portalSendAvailability", () => {
  test("available with a live billed identity", async () => {
    await identityFor(clientId, "c@example.com");
    const id = await makeInvoice();
    expect(await portalSendAvailability(id)).toEqual({ available: true, reason: null });
  });

  test("switch off, no identity, revoked, and portal off each give a reason", async () => {
    const id = await makeInvoice();
    expect(await portalSendAvailability(id)).toEqual({ available: false, reason: REASON_ACCESS });
    await identityFor(clientId, "c@example.com", { revoked: true });
    expect((await portalSendAvailability(id)).reason).toBe(REASON_ACCESS);
    await prisma.matter.update({ where: { id: matterId }, data: { portalBillingEnabled: false } });
    expect((await portalSendAvailability(id)).reason).toBe(REASON_SWITCH);
    await prisma.firm.update({ where: { id: firmId }, data: { portalEnabled: false } });
    expect((await portalSendAvailability(id)).reason).toBe("The client portal is turned off.");
  });

  test("uses Invoice.clientId over the matter client", async () => {
    const { contactId: other } = await seedContact({ name: "Other" });
    await identityFor(clientId, "c@example.com");
    const id = await makeInvoice({ clientId: other });
    expect((await portalSendAvailability(id)).available).toBe(false);
    await identityFor(other, "o@example.com");
    expect((await portalSendAvailability(id)).available).toBe(true);
  });
});

describe("sendInvoice via portal", () => {
  test("refused when the switch is off: status unchanged, no email", async () => {
    await identityFor(clientId, "c@example.com");
    await prisma.matter.update({ where: { id: matterId }, data: { portalBillingEnabled: false } });
    const id = await makeInvoice();
    const res = await sendInvoice(id, billingInitialState, form());
    expect(res).toMatchObject({ status: "error", error: REASON_SWITCH });
    expect(await statusOf(id)).toBe("approved");
    expect(cap.sent).toHaveLength(0);
  });

  test("refused when the billed contact's access is revoked", async () => {
    await identityFor(clientId, "c@example.com", { revoked: true });
    const id = await makeInvoice();
    const res = await sendInvoice(id, billingInitialState, form());
    expect(res).toMatchObject({ status: "error", error: REASON_ACCESS });
    expect(await statusOf(id)).toBe("approved");
    expect(cap.sent).toHaveLength(0);
  });

  test("refused while the portal is off", async () => {
    await identityFor(clientId, "c@example.com");
    await prisma.firm.update({ where: { id: firmId }, data: { portalEnabled: false } });
    const id = await makeInvoice();
    const res = await sendInvoice(id, billingInitialState, form());
    expect(res.status).toBe("error");
    expect(await statusOf(id)).toBe("approved");
    expect(cap.sent).toHaveLength(0);
  });

  test("success: sent, emails only the billed identity, no amount or matter name, logged", async () => {
    await identityFor(clientId, "c@example.com");
    const { contactId: co } = await seedContact({ name: "Co-client" });
    await identityFor(co, "co@example.com");
    const id = await makeInvoice();
    const res = await sendInvoice(id, billingInitialState, form());
    expect(res.status).toBe("ok");
    expect(await statusOf(id)).toBe("sent");
    expect(cap.sent).toHaveLength(1);
    const mail = cap.sent[0];
    expect(mail.to).toBe("c@example.com");
    expect(mail.subject).toBe("A new invoice is available in your client portal");
    const body = `${mail.subject} ${mail.text} ${mail.html}`;
    expect(body).not.toMatch(/1,?234/);
    expect(body).not.toMatch(/Alvarez/);
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { matterId, title: { contains: "sent via client portal" } },
    });
    expect(log.title).toBe("Invoice 2026-901 sent via client portal");
    expect(log.title).not.toContain("not emailed");
  });

  test("trust application still runs with the portal method", async () => {
    await identityFor(clientId, "c@example.com");
    await prisma.matter.update({ where: { id: matterId }, data: { trustBalance: 2000 } });
    const id = await makeInvoice();
    const res = await sendInvoice(
      id,
      billingInitialState,
      form({ applyTrust: "true", trustAmount: "100" }),
    );
    expect(res.status).toBe("ok");
    expect(await statusOf(id)).toBe("partial");
  });

  test("a delivery failure keeps the send and notes it on the activity row", async () => {
    await identityFor(clientId, "c@example.com");
    cap.restore();
    const { __setDriverForTests } = await import("@/lib/email/send");
    __setDriverForTests(async () => ({ ok: false, error: "boom" }) as never);
    const id = await makeInvoice();
    const res = await sendInvoice(id, billingInitialState, form());
    expect(res.status).toBe("ok");
    expect(await statusOf(id)).toBe("sent");
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { matterId, title: { contains: "sent via client portal" } },
    });
    expect(log.detail).toContain("email failed");
    __setDriverForTests(null);
  });

  test("email method with an empty recipient is refused: status unchanged", async () => {
    const id = await makeInvoice();
    const res = await sendInvoice(
      id,
      billingInitialState,
      form({ method: "email", recipient: "" }),
    );
    expect(res.status).toBe("error");
    expect(res.errors?.recipient).toEqual(["Recipient is required"]);
    expect(await statusOf(id)).toBe("approved");
  });

  test("email method emails the invoice PDF", async () => {
    const id = await makeInvoice();
    const res = await sendInvoice(
      id,
      billingInitialState,
      form({ method: "email", recipient: "x@example.com" }),
    );
    expect(res.status).toBe("ok");
    expect(cap.sent).toHaveLength(1);
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { matterId, title: { contains: "emailed to" } },
    });
    expect(log.title).toBe("Invoice 2026-901 emailed to x@example.com");
  });
});
