import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";

let hostHeader = "portal.localhost:3000";
vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (n: string) => (n === "host" ? hostHeader : null),
  }),
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
import PortalLoginPage from "./page";

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  hostHeader = "portal.localhost:3000";
  const { firmId } = await seedFirm();
  await prisma.firm.update({ where: { id: firmId }, data: { portalEnabled: true } });
  const { userId } = await seedUser({ firmId });
  const { areaId, stageId } = await seedPracticeArea();
  const { matterId } = await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: userId });
  const live = await seedContact({ email: "jane@example.com" });
  const gone = await seedContact({ email: "gone@example.com" });
  const janeId = (
    await prisma.portalIdentity.create({ data: { contactId: live.contactId, email: "jane@example.com" } })
  ).id;
  const goneId = (
    await prisma.portalIdentity.create({ data: { contactId: gone.contactId, email: "gone@example.com" } })
  ).id;
  await prisma.portalMatterAccess.createMany({
    data: [
      { identityId: janeId, matterId, invitedById: userId },
      { identityId: goneId, matterId, invitedById: userId, revokedAt: new Date() },
    ],
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("portal login page dev sign-in", () => {
  test("on portal.localhost lists invited clients with live access only", async () => {
    render(await PortalLoginPage());
    expect(screen.getByRole("region", { name: "Dev sign-in" })).toBeTruthy();
    expect(screen.getByText(/jane@example\.com/)).toBeTruthy();
    expect(screen.queryByText(/gone@example\.com/)).toBeNull();
  });

  test("absent in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    render(await PortalLoginPage());
    expect(screen.queryByRole("region", { name: "Dev sign-in" })).toBeNull();
  });

  test("absent on the configured portal host", async () => {
    vi.stubEnv("PORTAL_HOST", "portal.example.com");
    hostHeader = "portal.example.com";
    render(await PortalLoginPage());
    expect(screen.queryByRole("region", { name: "Dev sign-in" })).toBeNull();
  });
});
