import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";

let openId = "";
let userId0 = "";
const identity = { identityId: "", contactId: "", email: "jane@example.com" };
vi.mock("@/lib/portal-access", async (orig) => ({
  ...(await orig<typeof import("@/lib/portal-access")>()),
  requirePortalIdentity: vi.fn(async () => identity),
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
import PortalHome from "./page";

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  const { userId } = await seedUser({ firmId });
  const { areaId, stageId } = await seedPracticeArea();
  const { contactId } = await seedContact({ email: "jane@example.com" });
  const ident = await prisma.portalIdentity.create({
    data: { contactId, email: "jane@example.com" },
  });
  identity.identityId = ident.id;
  identity.contactId = contactId;
  const mk = (name: string) =>
    seedMatter({ practiceAreaId: areaId, stageId, leadUserId: userId, name });
  const open = await mk("Open Matter");
  userId0 = userId;
  openId = open.matterId;
  const closed = await mk("Closed Matter");
  await mk("Uninvited Matter");
  const revoked = await mk("Revoked Matter");
  await prisma.matter.update({
    where: { id: closed.matterId },
    data: { isArchived: true },
  });
  await prisma.portalMatterAccess.createMany({
    data: [
      { identityId: ident.id, matterId: open.matterId, invitedById: userId },
      { identityId: ident.id, matterId: closed.matterId, invitedById: userId },
      {
        identityId: ident.id,
        matterId: revoked.matterId,
        invitedById: userId,
        revokedAt: new Date(),
      },
    ],
  });
});

describe("portal home", () => {
  test("My matters lists only invited matters with Open/Closed", async () => {
    render(await PortalHome());
    expect(screen.getByText("Open Matter")).toBeTruthy();
    expect(screen.getByText("Closed Matter")).toBeTruthy();
    expect(screen.queryByText("Uninvited Matter")).toBeNull();
    expect(screen.queryByText("Revoked Matter")).toBeNull();
    const href = screen
      .getByText("Open Matter")
      .closest("a")
      ?.getAttribute("href");
    expect(href).toBe(`/matters/${openId}`);
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByText("Closed")).toBeTruthy();
  });

  test("badge shows only for matters with open requests", async () => {
    const mkReq = (matterId: string, title: string, status = "open") =>
      prisma.documentRequest.create({
        data: { matterId, title, createdById: userId0, status },
      });
    await mkReq(openId, "a");
    await mkReq(openId, "b");
    await mkReq(openId, "c", "submitted");
    const { unmount } = render(await PortalHome());
    expect(screen.getByText("2 items requested")).toBeTruthy();
    expect(screen.queryByText("1 item requested")).toBeNull();
    unmount();
    await prisma.documentRequest.deleteMany({
      where: { title: { in: ["b"] } },
    });
    render(await PortalHome());
    expect(screen.getByText("1 item requested")).toBeTruthy();
  });

  test("shows the latest stage label beside the status", async () => {
    const mk = (stageLabel: string, postedAt: Date) =>
      prisma.portalStatusUpdate.create({
        data: {
          matterId: openId,
          stageLabel,
          body: "b",
          postedById: userId0,
          postedAt,
        },
      });
    await prisma.firm.updateMany({ data: { portalEnabled: true } });
    await mk("Intake", new Date("2026-01-01T00:00:00Z"));
    await mk("Discovery", new Date("2026-02-01T00:00:00Z"));
    render(await PortalHome());
    expect(screen.getByText("Discovery")).toBeTruthy();
    expect(screen.queryByText("Intake")).toBeNull();
  });

  test("New message chip shows only for matters with unread staff messages", async () => {
    await prisma.firm.updateMany({ data: { portalEnabled: true } });
    const thread = await prisma.portalThread.create({
      data: { matterId: openId, lastMessageAt: new Date(), lastFromClient: false },
    });
    await prisma.portalMessage.create({
      data: {
        threadId: thread.id,
        body: "Hi",
        authorKind: "staff",
        authorUserId: userId0,
      },
    });
    render(await PortalHome());
    expect(screen.getAllByText("New message")).toHaveLength(1);
    expect(
      screen.getByText("Open Matter").closest("a")?.textContent,
    ).toContain("New message");
    expect(
      screen.getByText("Closed Matter").closest("a")?.textContent,
    ).not.toContain("New message");
  });
});

describe("portal home balance due", () => {
  test("shows Balance due only for matters with a visible unpaid balance", async () => {
    await prisma.firm.updateMany({ data: { portalEnabled: true } });
    await prisma.matter.update({
      where: { id: openId },
      data: { clientId: identity.contactId, portalBillingEnabled: true },
    });
    await prisma.invoice.create({
      data: {
        invoiceNumber: "INV-5",
        matterId: openId,
        kind: "client",
        status: "partial",
        issueDate: new Date("2026-03-05T18:00:00Z"),
        dueDate: new Date("2999-01-01T00:00:00Z"),
        subtotal: "1500.00",
        totalAmount: "1500.00",
        paidAmount: "500.25",
      },
    });
    render(await PortalHome());
    expect(screen.getAllByText(/Balance due/)).toHaveLength(1);
    expect(screen.getByText("Balance due $999.75")).toBeTruthy();
  });

  test("no Balance due when the switch is off", async () => {
    await prisma.firm.updateMany({ data: { portalEnabled: true } });
    render(await PortalHome());
    expect(screen.queryByText(/Balance due/)).toBeNull();
  });
});
