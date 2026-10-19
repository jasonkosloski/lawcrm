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
});
