"use server";

import { cookies, headers } from "next/headers";

import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email/send";
import { logPortalEvent } from "@/lib/portal/audit";
import { PORTAL_COOKIE, portalCookieOptions } from "@/lib/portal/cookie";
import { portalLinkUrl } from "@/lib/portal/link-url";
import { loginEmail } from "@/lib/portal/emails";
import {
  requestAllowsDevPortalSignIn,
  requestIsOnPortalHost,
} from "@/lib/portal/host";
import { hashSecret, hmacSecret } from "@/lib/portal/secrets";
import {
  createSession,
  deleteSession,
  sessionCookieMaxAge,
} from "@/lib/portal/sessions";
import { consumeToken, issueToken } from "@/lib/portal/tokens";

export type PortalLinkState = { status: "idle" | "sent" };
/**
 * NOTE: portal server actions must never call redirect(). The portal host is
 * served by a proxy rewrite (/x -> /portal/x), but Next renders a server
 * action's redirect target in the same request WITHOUT going back through the
 * proxy, so redirect("/") would render the staff root. Actions return a
 * result and the client does a full navigation (window.location), which does
 * pass through the proxy. Do not "fix" this back to redirect().
 */
export type PortalVerifyState = { status: "idle" | "invalid" | "ok" };

const WINDOW_MS = 15 * 60 * 1000;
const EMAIL_LIMIT = 3;
const IP_LIMIT = 20;

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
  // Keyed: emails and IPs are guessable, so a plain hash would be reversible.
  const emailHash = hmacSecret(email);
  const ipHash = hmacSecret(ip);

  // Check the limits BEFORE recording this request: an over-limit caller
  // gets the uniform response and no new row, so a script can't grow the
  // table without bound (prune.ts clears expired rows).
  const since = new Date(Date.now() - WINDOW_MS);
  const [byEmail, byIp] = await Promise.all([
    prisma.portalLinkRequest.count({
      where: { emailHash, createdAt: { gte: since } },
    }),
    prisma.portalLinkRequest.count({
      where: { ipHash, createdAt: { gte: since } },
    }),
  ]);
  if (byEmail >= EMAIL_LIMIT || byIp >= IP_LIMIT) return uniform;
  await prisma.portalLinkRequest.create({ data: { emailHash, ipHash } });

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

  await startSession(result.identityId, "Signed in to portal");
  return { status: "ok" };
}

/**
 * Dev-only: sign in as an invited client without an emailed link. Refused
 * unless the request is on `portal.localhost` outside production. The same
 * portal-on, enabled and live-access checks as a real sign-in still apply.
 */
export async function devPortalSignIn(
  _prev: PortalVerifyState,
  fd: FormData
): Promise<PortalVerifyState> {
  if (!(await requestAllowsDevPortalSignIn())) return { status: "invalid" };

  const identityId = String(fd.get("identityId") ?? "");
  if (!identityId) return { status: "invalid" };

  const [firm, identity] = await Promise.all([
    prisma.firm.findFirst({ select: { portalEnabled: true } }),
    prisma.portalIdentity.findFirst({
      where: {
        id: identityId,
        disabledAt: null,
        access: { some: { revokedAt: null } },
      },
      select: { id: true },
    }),
  ]);
  if (!firm?.portalEnabled || !identity) return { status: "invalid" };

  await startSession(identity.id, "Signed in to portal (dev shortcut)");
  return { status: "ok" };
}

/** Create a session, set the persistent cookie, and audit the sign-in. */
async function startSession(identityId: string, title: string): Promise<void> {
  const session = await createSession(identityId);
  const row = await prisma.portalSession.findUniqueOrThrow({
    where: { tokenHash: hashSecret(session) },
    select: { createdAt: true },
  });
  // Persistent cookie capped at the session's absolute expiry.
  (await cookies()).set(PORTAL_COOKIE, session, {
    ...portalCookieOptions(),
    maxAge: sessionCookieMaxAge(row.createdAt),
  });
  await logPortalEvent({ identityId, title });
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
}
