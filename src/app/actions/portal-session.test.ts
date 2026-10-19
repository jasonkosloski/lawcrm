import { beforeAll, beforeEach, afterEach, describe, expect, test, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import {
  resetDb,
  seedContact,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";
import { captureEmails } from "@/test/email-capture";
import { PORTAL_COOKIE } from "@/lib/portal/cookie";
import { createSession } from "@/lib/portal/sessions";
import { issueToken } from "@/lib/portal/tokens";
import { hashSecret } from "@/lib/portal/secrets";

const jar = new Map<string, string>();
let hostHeader = "portal.localhost:3000";
let forwardedFor = "203.0.113.7, 10.0.0.1";
vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (n: string) =>
      n === "host" ? hostHeader : n === "x-forwarded-for" ? forwardedFor : null,
  }),
  cookies: async () => ({
    get: (name: string) =>
      jar.has(name) ? { name, value: jar.get(name)! } : undefined,
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

import {
  portalLinkUrl,
  requestPortalLink,
  signOutPortal,
  verifyPortalLink,
} from "./portal-session";

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

let firmId: string;
let identityId: string;
let matterId: string;
let cap: ReturnType<typeof captureEmails>;

const form = (email: string) => {
  const fd = new FormData();
  fd.set("email", email);
  return fd;
};
const tokenForm = (token: string) => {
  const fd = new FormData();
  fd.set("token", token);
  return fd;
};
const SENT = { status: "sent" };

beforeEach(async () => {
  await resetDb();
  jar.clear();
  hostHeader = "portal.localhost:3000";
  forwardedFor = "203.0.113.7, 10.0.0.1";
  cap = captureEmails();
  ({ firmId } = await seedFirm());
  await prisma.firm.update({ where: { id: firmId }, data: { portalEnabled: true } });
  const { userId } = await seedUser({ firmId });
  const { areaId, stageId } = await seedPracticeArea();
  matterId = (
    await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: userId, name: "Secret Matter Name" })
  ).matterId;
  const { contactId } = await seedContact({ email: "jane@example.com" });
  identityId = (
    await prisma.portalIdentity.create({ data: { contactId, email: "jane@example.com" } })
  ).id;
  await prisma.portalMatterAccess.create({
    data: { identityId, matterId, invitedById: userId },
  });
});
afterEach(() => cap.restore());

describe("requestPortalLink", () => {
  test("known email with live access gets one login email; response is the uniform copy", async () => {
    expect(await requestPortalLink({ status: "idle" }, form("jane@example.com"))).toEqual(SENT);
    expect(cap.sent).toHaveLength(1);
    expect(cap.sent[0].to).toBe("jane@example.com");
    expect(cap.sent[0].text).toContain("/auth/verify?token=");
    expect(cap.sent[0].text).not.toContain("Secret Matter Name");
  });

  test("unknown, disabled, no-live-access, and portal-off all return the same state and send nothing", async () => {
    const { contactId: c2 } = await seedContact({ email: "off@example.com" });
    await prisma.portalIdentity.create({
      data: { contactId: c2, email: "off@example.com", disabledAt: new Date() },
    });
    const { contactId: c3 } = await seedContact({ email: "none@example.com" });
    const noAccess = await prisma.portalIdentity.create({
      data: { contactId: c3, email: "none@example.com" },
    });
    await prisma.portalMatterAccess.updateMany({
      where: { identityId },
      data: { revokedAt: new Date() },
    });
    void noAccess;
    for (const e of ["nobody@example.com", "off@example.com", "none@example.com", "jane@example.com"]) {
      expect(await requestPortalLink({ status: "idle" }, form(e))).toEqual(SENT);
    }
    await prisma.portalMatterAccess.updateMany({ data: { revokedAt: null } });
    await prisma.firm.update({ where: { id: firmId }, data: { portalEnabled: false } });
    expect(await requestPortalLink({ status: "idle" }, form("jane@example.com"))).toEqual(SENT);
    expect(cap.sent).toHaveLength(0);
  });

  test("off the portal host: uniform state, nothing written or sent", async () => {
    hostHeader = "app.example.com";
    expect(await requestPortalLink({ status: "idle" }, form("jane@example.com"))).toEqual(SENT);
    expect(cap.sent).toHaveLength(0);
    expect(await prisma.portalLinkRequest.count()).toBe(0);
    expect(await prisma.activityLog.count({ where: { type: "auth" } })).toBe(0);
  });

  test("email is trimmed and case-folded before lookup", async () => {
    await requestPortalLink({ status: "idle" }, form("  Jane@Example.COM "));
    expect(cap.sent).toHaveLength(1);
    const rows = await prisma.portalLinkRequest.findMany();
    expect(rows[0].emailHash).toBe(hashSecret("jane@example.com"));
  });

  test("4th request for one email in 15 min sends nothing; response unchanged", async () => {
    for (let i = 0; i < 3; i++) {
      await requestPortalLink({ status: "idle" }, form("jane@example.com"));
    }
    expect(cap.sent).toHaveLength(3);
    expect(await requestPortalLink({ status: "idle" }, form("jane@example.com"))).toEqual(SENT);
    expect(cap.sent).toHaveLength(3);
  });

  test("21st request from one IP in 15 min sends nothing; rows hold hashes only", async () => {
    for (let i = 0; i < 20; i++) {
      await requestPortalLink({ status: "idle" }, form(`x${i}@example.com`));
    }
    expect(await prisma.portalLinkRequest.count()).toBe(20);
    expect(await requestPortalLink({ status: "idle" }, form("jane@example.com"))).toEqual(SENT);
    expect(cap.sent).toHaveLength(0);
    expect(await prisma.portalLinkRequest.count()).toBe(21);
    const row = await prisma.portalLinkRequest.findFirst({
      where: { emailHash: hashSecret("jane@example.com") },
    });
    expect(row?.ipHash).toBe(hashSecret("203.0.113.7"));
    const all = JSON.stringify(await prisma.portalLinkRequest.findMany());
    expect(all).not.toContain("jane@example.com");
    expect(all).not.toContain("203.0.113.7");
  });

  test("a matched request writes one portal auth activity row; an unmatched one writes none; no row contains the token", async () => {
    await requestPortalLink({ status: "idle" }, form("nobody@example.com"));
    expect(await prisma.activityLog.count({ where: { type: "auth" } })).toBe(0);
    await requestPortalLink({ status: "idle" }, form("jane@example.com"));
    const rows = await prisma.activityLog.findMany({ where: { type: "auth" } });
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBeNull();
    expect(rows[0].detail).toContain(`portal identity ${identityId}`);
    const token = new URL(cap.sent[0].text.match(/https?:\/\/\S+/)![0]).searchParams.get("token")!;
    expect(JSON.stringify(rows)).not.toContain(token);
  });
});

describe("verifyPortalLink", () => {
  test("valid token sets the cookie and redirects to /", async () => {
    const raw = await issueToken(identityId, "login");
    await expect(verifyPortalLink({ status: "idle" }, tokenForm(raw))).rejects.toThrow("REDIRECT:/");
    expect(jar.get(PORTAL_COOKIE)).toBeTruthy();
    expect(await prisma.portalSession.count({ where: { identityId } })).toBe(1);
    expect(await prisma.activityLog.count({ where: { title: "Signed in to portal" } })).toBe(1);
  });

  test("used/expired token returns invalid and sets no cookie", async () => {
    const raw = await issueToken(identityId, "login");
    await expect(verifyPortalLink({ status: "idle" }, tokenForm(raw))).rejects.toThrow("REDIRECT:/");
    jar.clear();
    expect(await verifyPortalLink({ status: "idle" }, tokenForm(raw))).toEqual({ status: "invalid" });
    expect(jar.size).toBe(0);
    expect(await prisma.activityLog.count({ where: { title: "Portal link rejected" } })).toBe(1);
    expect(await verifyPortalLink({ status: "idle" }, tokenForm("garbage"))).toEqual({ status: "invalid" });
    expect(await prisma.activityLog.count({ where: { title: "Portal link rejected" } })).toBe(1);
  });

  test("off the portal host: invalid, no cookie, token not consumed", async () => {
    const raw = await issueToken(identityId, "login");
    hostHeader = "app.example.com";
    expect(await verifyPortalLink({ status: "idle" }, tokenForm(raw))).toEqual({ status: "invalid" });
    expect(jar.size).toBe(0);
    hostHeader = "portal.localhost:3000";
    await expect(verifyPortalLink({ status: "idle" }, tokenForm(raw))).rejects.toThrow("REDIRECT:/");
  });
});

describe("signOutPortal", () => {
  test("deletes the session row and clears the cookie", async () => {
    jar.set(PORTAL_COOKIE, await createSession(identityId));
    await expect(signOutPortal()).rejects.toThrow("REDIRECT:/login");
    expect(jar.has(PORTAL_COOKIE)).toBe(false);
    expect(await prisma.portalSession.count({ where: { identityId } })).toBe(0);
  });
});

describe("portalLinkUrl", () => {
  test("uses PORTAL_HOST over https, dev fallback otherwise", () => {
    vi.stubEnv("PORTAL_HOST", "portal.firm.test");
    expect(portalLinkUrl("abc_-")).toBe("https://portal.firm.test/auth/verify?token=abc_-");
    vi.stubEnv("PORTAL_HOST", "");
    expect(portalLinkUrl("abc")).toBe("http://portal.localhost:3000/auth/verify?token=abc");
    vi.unstubAllEnvs();
  });
});
