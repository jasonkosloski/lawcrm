import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import {
  resetDb,
  seedContact,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";
import { PORTAL_COOKIE } from "@/lib/portal/cookie";
import { createSession } from "@/lib/portal/sessions";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.has(name) ? { name, value: jar.get(name)! } : undefined,
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

import {
  assertPortalMatterAccess,
  getPortalIdentity,
  portalMatterWhere,
  requirePortalIdentity,
} from "./portal-access";

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

let identityId: string;
let contactId: string;
let matterA: string;
let matterB: string;
let matterC: string;

beforeEach(async () => {
  await resetDb();
  jar.clear();
  const { firmId } = await seedFirm();
  await prisma.firm.update({
    where: { id: firmId },
    data: { portalEnabled: true },
  });
  const { userId } = await seedUser({ firmId });
  const { areaId, stageId } = await seedPracticeArea();
  const mk = async (name: string) =>
    (await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: userId, name }))
      .matterId;
  matterA = await mk("A");
  matterB = await mk("B");
  matterC = await mk("C");
  contactId = (await seedContact({ email: "jane@example.com" })).contactId;
  identityId = (
    await prisma.portalIdentity.create({
      data: { contactId, email: "jane@example.com" },
    })
  ).id;
  await prisma.portalMatterAccess.createMany({
    data: [
      { identityId, matterId: matterA, invitedById: userId },
      { identityId, matterId: matterB, invitedById: userId, revokedAt: new Date() },
    ],
  });
});

describe("portal identity", () => {
  test("no cookie → null; requirePortalIdentity redirects to /login", async () => {
    expect(await getPortalIdentity()).toBeNull();
    await expect(requirePortalIdentity()).rejects.toThrow("REDIRECT:/login");
  });

  test("valid session → identity", async () => {
    jar.set(PORTAL_COOKIE, await createSession(identityId));
    expect(await getPortalIdentity()).toEqual({
      identityId,
      contactId,
      email: "jane@example.com",
    });
    expect((await requirePortalIdentity()).identityId).toBe(identityId);
  });

  test("portal disabled firm-wide → null even with a valid session", async () => {
    jar.set(PORTAL_COOKIE, await createSession(identityId));
    await prisma.firm.updateMany({ data: { portalEnabled: false } });
    expect(await getPortalIdentity()).toBeNull();
  });

  test("a staff Auth.js cookie alone is not a portal identity", async () => {
    jar.set("authjs.session-token", "whatever");
    expect(await getPortalIdentity()).toBeNull();
  });
});

describe("portal matter access", () => {
  test("assertPortalMatterAccess: invited passes; never-invited, revoked and nonexistent all notFound", async () => {
    await expect(assertPortalMatterAccess(identityId, matterA)).resolves.toBeUndefined();
    await expect(assertPortalMatterAccess(identityId, matterC)).rejects.toThrow("NOT_FOUND");
    await expect(assertPortalMatterAccess(identityId, matterB)).rejects.toThrow("NOT_FOUND");
    await expect(assertPortalMatterAccess(identityId, "nope")).rejects.toThrow("NOT_FOUND");
  });

  test("portalMatterWhere lists only live-access matters", async () => {
    const rows = await prisma.matter.findMany({
      where: portalMatterWhere(identityId),
      select: { id: true },
    });
    expect(rows.map((r) => r.id)).toEqual([matterA]);
  });
});
