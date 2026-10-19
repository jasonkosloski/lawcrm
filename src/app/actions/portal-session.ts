"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email/send";
import { logPortalEvent } from "@/lib/portal/audit";
import { PORTAL_COOKIE, portalCookieOptions } from "@/lib/portal/cookie";
import { loginEmail } from "@/lib/portal/emails";
import { requestIsOnPortalHost } from "@/lib/portal/host";
import { hashSecret } from "@/lib/portal/secrets";
import { createSession, deleteSession } from "@/lib/portal/sessions";
import { consumeToken, issueToken } from "@/lib/portal/tokens";

export type PortalLinkState = { status: "idle" | "sent" };
export type PortalVerifyState = { status: "idle" | "invalid" };

const WINDOW_MS = 15 * 60 * 1000;
const EMAIL_LIMIT = 3;
const IP_LIMIT = 20;

/** Absolute sign-in link. Env is read per call. */
export function portalLinkUrl(raw: string): string {
  const host = process.env.PORTAL_HOST?.trim();
  const base = host
    ? `https://${host}`
    : "http://portal.localhost:3000";
  return `${base}/auth/verify?token=${encodeURIComponent(raw)}`;
}

/**
 * Request a sign-in link. Always returns the same state for any input so
 * the form cannot be used to discover who has portal access.
 */
export async function requestPortalLink(
  _prev: PortalLinkState,
  fd: FormData
): Promise<PortalLinkState> {
  const uniform: PortalLinkState = { status: "sent" };
  if (!(await requestIsOnPortalHost())) return uniform;

  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  if (!email || email.length > 254 || !email.includes("@")) return uniform;

  const forwarded = (await headers()).get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || "unknown";
  const emailHash = hashSecret(email);
  const ipHash = hashSecret(ip);

  await prisma.portalLinkRequest.create({ data: { emailHash, ipHash } });
  const since = new Date(Date.now() - WINDOW_MS);
  const [byEmail, byIp] = await Promise.all([
    prisma.portalLinkRequest.count({
      where: { emailHash, createdAt: { gte: since } },
    }),
    prisma.portalLinkRequest.count({
      where: { ipHash, createdAt: { gte: since } },
    }),
  ]);
  if (byEmail > EMAIL_LIMIT || byIp > IP_LIMIT) return uniform;

  const firm = await prisma.firm.findFirst({ select: { portalEnabled: true } });
  if (!firm?.portalEnabled) return uniform;

  const identity = await prisma.portalIdentity.findFirst({
    where: {
      email,
      disabledAt: null,
      access: { some: { revokedAt: null } },
    },
    select: { id: true },
  });
  if (!identity) return uniform;

  const raw = await issueToken(identity.id, "login");
  const sent = await sendEmail({ to: email, ...loginEmail(portalLinkUrl(raw)) });
  if (!sent.ok) {
    console.error("[portal] link email failed", {
      identityId: identity.id,
      error: sent.error,
    });
  }
  await logPortalEvent({
    identityId: identity.id,
    title: "Portal link requested",
    detail: sent.ok ? undefined : "\u2014 send failed",
  });
  return uniform;
}

/** Exchange a sign-in link token for a session. */
export async function verifyPortalLink(
  _prev: PortalVerifyState,
  fd: FormData
): Promise<PortalVerifyState> {
  if (!(await requestIsOnPortalHost())) return { status: "invalid" };

  const raw = String(fd.get("token") ?? "");
  if (!raw) return { status: "invalid" };

  const result = await consumeToken(raw);
  if (!result) {
    const row = await prisma.portalLoginToken.findUnique({
      where: { tokenHash: hashSecret(raw) },
      select: { identityId: true },
    });
    if (row) {
      await logPortalEvent({
        identityId: row.identityId,
        title: "Portal link rejected",
      });
    }
    return { status: "invalid" };
  }

  // Fail closed like the request path: the portal may have been switched off
  // or access revoked since the link was issued. The token stays burned.
  const [firm, live] = await Promise.all([
    prisma.firm.findFirst({ select: { portalEnabled: true } }),
    prisma.portalMatterAccess.count({
      where: { identityId: result.identityId, revokedAt: null },
    }),
  ]);
  if (!firm?.portalEnabled || live === 0) return { status: "invalid" };

  const session = await createSession(result.identityId);
  (await cookies()).set(PORTAL_COOKIE, session, portalCookieOptions());
  await logPortalEvent({
    identityId: result.identityId,
    title: "Signed in to portal",
  });
  redirect("/");
}

export async function signOutPortal(): Promise<void> {
  const jar = await cookies();
  const raw = jar.get(PORTAL_COOKIE)?.value;
  if (raw) {
    const row = await prisma.portalSession.findUnique({
      where: { tokenHash: hashSecret(raw) },
      select: { identityId: true },
    });
    await deleteSession(raw);
    if (row) {
      await logPortalEvent({
        identityId: row.identityId,
        title: "Signed out of portal",
      });
    }
  }
  // Full options: a bare delete omits Secure, which browsers reject for __Host- names.
  jar.set(PORTAL_COOKIE, "", { ...portalCookieOptions(), maxAge: 0 });
  redirect("/login");
}
