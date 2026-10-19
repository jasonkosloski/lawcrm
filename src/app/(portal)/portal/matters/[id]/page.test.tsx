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
import PortalMatterPage from "./page";

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

let invited: string;
let other: string;

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
  invited = (
    await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
      name: "Smith Estate",
    })
  ).matterId;
  other = (
    await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
      name: "Secret Matter",
    })
  ).matterId;
  await prisma.portalMatterAccess.create({
    data: { identityId: ident.id, matterId: invited, invitedById: userId },
  });
});

describe("portal matter page", () => {
  test("matter page 404s for an un-invited matter and shows the name for an invited one", async () => {
    await expect(
      PortalMatterPage({ params: Promise.resolve({ id: other }) })
    ).rejects.toThrow("NEXT_NOT_FOUND");

    render(await PortalMatterPage({ params: Promise.resolve({ id: invited }) }));
    expect(screen.getByText("Smith Estate")).toBeTruthy();
    expect(screen.getByText("More details are coming soon.")).toBeTruthy();
  });
});
