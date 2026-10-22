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
import { PORTAL_COOKIE, portalCookieOptions } from "@/lib/portal/cookie";
import { createSession } from "@/lib/portal/sessions";
import { issueToken } from "@/lib/portal/tokens";
import { createHash } from "node:crypto";
import { hmacSecret } from "@/lib/portal/secrets";

const jar = new Map<string, string>();
const setCalls: { name: string; value: string; opts: unknown }[] = [];
let hostHeader = "portal.localhost:3000";
let forwardedFor = "203.0.113.7, 10.0.0.1";
vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (n: string) => (n === "host" ? hostHeader : n === "x-forwarded-for" ? forwardedFor : null),
  }),
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string, opts?: unknown) => {
      setCalls.push({ name, value, opts });
      if (value === "") jar.delete(name);
      else jar.set(name, value);
    },
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

import { redirect } from "next/navigation";
import {
  devPortalSignIn,
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
  setCalls.length = 0;
  hostHeader = "portal.localhost:3000";
  forwardedFor = "203.0.113.7, 10.0.0.1";
  cap = captureEmails();
  ({ firmId } = await seedFirm());
  await prisma.firm.update({ where: { id: firmId }, data: { portalEnabled: true } });
  const { userId } = await seedUser({ firmId });
  const { areaId, stageId } = await seedPracticeArea();
  matterId = (
    await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
      name: "Secret Matter Name",
    })
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
    await prisma.portalIdentity.create({
      data: { contactId: c3, email: "none@example.com" },
    });
    await prisma.portalMatterAccess.updateMany({
      where: { identityId },
      data: { revokedAt: new Date() },
    });
    for (const e of [
      "nobody@example.com",
      "off@example.com",
      "none@example.com",
      "jane@example.com",
    ]) {
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
    expect(rows[0].emailHash).toBe(hmacSecret("jane@example.com"));
    // Keyed: a plain SHA-256 of a guessed email does not match the stored row.
    expect(rows[0].emailHash).not.toBe(
      createHash("sha256").update("jane@example.com").digest("hex"),
    );
  });

  test("4th request for one email in 15 min sends nothing; response unchanged", async () => {
    for (let i = 0; i < 3; i++) {
      await requestPortalLink({ status: "idle" }, form("jane@example.com"));
    }
    expect(cap.sent).toHaveLength(3);
    expect(await requestPortalLink({ status: "idle" }, form("jane@example.com"))).toEqual(SENT);
    expect(cap.sent).toHaveLength(3);
    expect(await prisma.portalLinkRequest.count()).toBe(3);
  });

  test("21st request from one IP in 15 min sends nothing; rows hold hashes only", async () => {
    for (let i = 0; i < 20; i++) {
      await requestPortalLink({ status: "idle" }, form(`x${i}@example.com`));
    }
    expect(await prisma.portalLinkRequest.count()).toBe(20);
    expect(await requestPortalLink({ status: "idle" }, form("jane@example.com"))).toEqual(SENT);
    expect(cap.sent).toHaveLength(0);
    // Over-limit requests insert no row, so the table can't be grown
    // unboundedly by a script.
    expect(await prisma.portalLinkRequest.count()).toBe(20);
    const row = await prisma.portalLinkRequest.findFirst({
      where: { emailHash: hmacSecret("x0@example.com") },
    });
    expect(row?.ipHash).toBe(hmacSecret("203.0.113.7"));
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
  test("valid token sets the cookie and returns ok without redirecting", async () => {
    const raw = await issueToken(identityId, "login");
    expect(await verifyPortalLink({ status: "idle" }, tokenForm(raw))).toEqual({ status: "ok" });
    expect(redirect).not.toHaveBeenCalled();
    expect(jar.get(PORTAL_COOKIE)).toBeTruthy();
    expect(await prisma.portalSession.count({ where: { identityId } })).toBe(1);
    expect(await prisma.activityLog.count({ where: { title: "Signed in to portal" } })).toBe(1);
  });

  test("cookie maxAge is the session's remaining absolute lifetime (30 days)", async () => {
    const raw = await issueToken(identityId, "login");
    await verifyPortalLink({ status: "idle" }, tokenForm(raw));
    const call = setCalls.find((c) => c.name === PORTAL_COOKIE && c.value);
    const opts = call?.opts as { maxAge?: number; httpOnly?: boolean };
    expect(opts.httpOnly).toBe(true);
    const thirtyDays = 30 * 24 * 60 * 60;
    expect(opts.maxAge).toBeLessThanOrEqual(thirtyDays);
    expect(opts.maxAge).toBeGreaterThan(thirtyDays - 60);
  });

  test("used/expired token returns invalid and sets no cookie", async () => {
    const raw = await issueToken(identityId, "login");
    expect(await verifyPortalLink({ status: "idle" }, tokenForm(raw))).toEqual({ status: "ok" });
    jar.clear();
    expect(await verifyPortalLink({ status: "idle" }, tokenForm(raw))).toEqual({
      status: "invalid",
    });
    expect(jar.size).toBe(0);
    expect(await prisma.activityLog.count({ where: { title: "Portal link rejected" } })).toBe(1);
    expect(await verifyPortalLink({ status: "idle" }, tokenForm("garbage"))).toEqual({
      status: "invalid",
    });
    expect(await prisma.activityLog.count({ where: { title: "Portal link rejected" } })).toBe(1);
  });

  test("portal off or no live access after consume: invalid, no session", async () => {
    await prisma.firm.update({ where: { id: firmId }, data: { portalEnabled: false } });
    let raw = await issueToken(identityId, "login");
    expect(await verifyPortalLink({ status: "idle" }, tokenForm(raw))).toEqual({
      status: "invalid",
    });
    await prisma.firm.update({ where: { id: firmId }, data: { portalEnabled: true } });
    await prisma.portalMatterAccess.updateMany({ data: { revokedAt: new Date() } });
    raw = await issueToken(identityId, "login");
    expect(await verifyPortalLink({ status: "idle" }, tokenForm(raw))).toEqual({
      status: "invalid",
    });
    expect(await prisma.portalSession.count()).toBe(0);
    expect(jar.size).toBe(0);
  });

  test("send failure is recorded on the audit row", async () => {
    cap.restore();
    const { __setDriverForTests } = await import("@/lib/email/send");
    __setDriverForTests(async () => ({ ok: false, error: "boom" }));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await requestPortalLink({ status: "idle" }, form("jane@example.com"));
    const row = await prisma.activityLog.findFirst({ where: { title: "Portal link requested" } });
    expect(row?.detail).toContain("send failed");
    expect(JSON.stringify(err.mock.calls)).not.toContain("jane@example.com");
    err.mockRestore();
  });

  test("off the portal host: invalid, no cookie, token not consumed", async () => {
    const raw = await issueToken(identityId, "login");
    hostHeader = "app.example.com";
    expect(await verifyPortalLink({ status: "idle" }, tokenForm(raw))).toEqual({
      status: "invalid",
    });
    expect(jar.size).toBe(0);
    hostHeader = "portal.localhost:3000";
    expect(await verifyPortalLink({ status: "idle" }, tokenForm(raw))).toEqual({ status: "ok" });
  });
});

describe("devPortalSignIn", () => {
  const asForm = (id: string) => {
    const fd = new FormData();
    fd.set("identityId", id);
    return fd;
  };
  afterEach(() => vi.unstubAllEnvs());

  test("on portal.localhost: signs in, sets the cookie, audits as the dev shortcut", async () => {
    expect(await devPortalSignIn({ status: "idle" }, asForm(identityId))).toEqual({ status: "ok" });
    expect(redirect).not.toHaveBeenCalled();
    expect(jar.get(PORTAL_COOKIE)).toBeTruthy();
    expect(await prisma.portalSession.count({ where: { identityId } })).toBe(1);
    expect(
      await prisma.activityLog.count({ where: { title: "Signed in to portal (dev shortcut)" } }),
    ).toBe(1);
  });

  test("refused in production, even on portal.localhost", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(await devPortalSignIn({ status: "idle" }, asForm(identityId))).toEqual({
      status: "invalid",
    });
    expect(await prisma.portalSession.count()).toBe(0);
    expect(jar.size).toBe(0);
  });

  test("refused on the configured PORTAL_HOST and on the staff host", async () => {
    vi.stubEnv("PORTAL_HOST", "portal.example.com");
    for (const h of ["portal.example.com", "app.example.com", "localhost:3000"]) {
      hostHeader = h;
      expect(await devPortalSignIn({ status: "idle" }, asForm(identityId))).toEqual({
        status: "invalid",
      });
    }
    expect(await prisma.portalSession.count()).toBe(0);
  });

  test("refused when the portal is off, the identity is disabled, has no live access, or is unknown", async () => {
    await prisma.firm.update({ where: { id: firmId }, data: { portalEnabled: false } });
    expect(await devPortalSignIn({ status: "idle" }, asForm(identityId))).toEqual({
      status: "invalid",
    });
    await prisma.firm.update({ where: { id: firmId }, data: { portalEnabled: true } });

    await prisma.portalIdentity.update({
      where: { id: identityId },
      data: { disabledAt: new Date() },
    });
    expect(await devPortalSignIn({ status: "idle" }, asForm(identityId))).toEqual({
      status: "invalid",
    });
    await prisma.portalIdentity.update({ where: { id: identityId }, data: { disabledAt: null } });

    await prisma.portalMatterAccess.updateMany({ data: { revokedAt: new Date() } });
    expect(await devPortalSignIn({ status: "idle" }, asForm(identityId))).toEqual({
      status: "invalid",
    });

    expect(await devPortalSignIn({ status: "idle" }, asForm("nope"))).toEqual({
      status: "invalid",
    });
    expect(await prisma.portalSession.count()).toBe(0);
    expect(jar.size).toBe(0);
  });
});

describe("signOutPortal", () => {
  test("deletes the session row and clears the cookie", async () => {
    jar.set(PORTAL_COOKIE, await createSession(identityId));
    await signOutPortal();
    expect(redirect).not.toHaveBeenCalled();
    expect(jar.has(PORTAL_COOKIE)).toBe(false);
    expect(setCalls.at(-1)).toEqual({
      name: PORTAL_COOKIE,
      value: "",
      opts: { ...portalCookieOptions(), maxAge: 0 },
    });
    expect(await prisma.portalSession.count({ where: { identityId } })).toBe(0);
  });
});
