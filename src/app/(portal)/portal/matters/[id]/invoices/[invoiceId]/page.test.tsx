import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const identity = { identityId: "", contactId: "", email: "jane@example.com" };
vi.mock("@/lib/portal-access", async (orig) => ({
  ...(await orig<typeof import("@/lib/portal-access")>()),
  requirePortalIdentity: vi.fn(async () => identity),
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn(),
}));
vi.mock("next/link", () => ({
  default: (props: React.ComponentProps<"a">) => <a {...props} />,
}));

import { prisma } from "@/lib/prisma";
import {
  resetDb,
  seedContact,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";
import PortalInvoicePage, { generateMetadata } from "./page";

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

let matterId: string;
let otherMatterId: string;
let invoiceId: string;
let draftId: string;

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  await prisma.firm.update({
    where: { id: firmId },
    data: { portalEnabled: true, name: "Acme Law" },
  });
  const { userId } = await seedUser({ firmId });
  const { areaId, stageId } = await seedPracticeArea();
  const { contactId } = await seedContact({ email: "jane@example.com" });
  const ident = await prisma.portalIdentity.create({
    data: { contactId, email: "jane@example.com" },
  });
  identity.identityId = ident.id;
  identity.contactId = contactId;
  const mk = async (name: string) =>
    (await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: userId, name })).matterId;
  matterId = await mk("Smith Estate");
  otherMatterId = await mk("Other Matter");
  for (const id of [matterId, otherMatterId]) {
    await prisma.matter.update({
      where: { id },
      data: { clientId: contactId, portalBillingEnabled: true },
    });
    await prisma.portalMatterAccess.create({
      data: { identityId: ident.id, matterId: id, invitedById: userId },
    });
  }
  const mkInv = (n: string, status: string) =>
    prisma.invoice.create({
      data: {
        invoiceNumber: n,
        matterId,
        kind: "client",
        status,
        issueDate: new Date("2026-03-05T18:00:00Z"),
        dueDate: new Date("2999-01-01T00:00:00Z"),
        subtotal: "100.00",
        totalAmount: "100.00",
        paidAmount: "0",
      },
    });
  invoiceId = (await mkInv("INV-77", "sent")).id;
  draftId = (await mkInv("INV-78", "draft")).id;
});

describe("portal invoice page", () => {
  test("renders a visible invoice with firm letterhead and Download PDF", async () => {
    render(
      await PortalInvoicePage({
        params: Promise.resolve({ id: matterId, invoiceId }),
      }),
    );
    expect(screen.getByText("INV-77")).toBeTruthy();
    expect(screen.getByText("Acme Law")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Download PDF/ })).toBeTruthy();
    const back = screen.getByRole("link", { name: /Smith Estate|Back/ });
    expect(back.getAttribute("href")).toBe(`/matters/${matterId}`);
    expect(back.className).toContain("print:hidden");
  });

  test("generateMetadata titles the page with the invoice number", async () => {
    const meta = await generateMetadata({
      params: Promise.resolve({ id: matterId, invoiceId }),
    });
    expect(meta.title).toBe("Invoice INV-77");
  });

  test("generateMetadata falls back to a generic title when not visible", async () => {
    const meta = await generateMetadata({
      params: Promise.resolve({ id: matterId, invoiceId: draftId }),
    });
    expect(meta.title).toBe("Invoice");
  });

  test("404s for a draft, an unknown id, and an invoice on another matter", async () => {
    const go = (id: string, invId: string) =>
      PortalInvoicePage({ params: Promise.resolve({ id, invoiceId: invId }) });
    await expect(go(matterId, draftId)).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(go(matterId, "nope")).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(go(otherMatterId, invoiceId)).rejects.toThrow("NEXT_NOT_FOUND");
  });

  test("404s for a co-client who is not the billed contact", async () => {
    const { contactId: bobId } = await seedContact({ email: "bob@example.com" });
    const bob = await prisma.portalIdentity.create({
      data: { contactId: bobId, email: "bob@example.com" },
    });
    const staff = await prisma.user.findFirstOrThrow({ select: { id: true } });
    await prisma.portalMatterAccess.create({
      data: { identityId: bob.id, matterId, invitedById: staff.id },
    });
    identity.identityId = bob.id;
    identity.contactId = bobId;
    await expect(
      PortalInvoicePage({ params: Promise.resolve({ id: matterId, invoiceId }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
