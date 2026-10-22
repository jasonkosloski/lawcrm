import "server-only";

/**
 * Staff identity resolver. Clerk proves WHO signed in (a verified
 * Google identity); this module decides whether that identity is a
 * firm member by mapping it to a `User` row. Every guard
 * (`getSession`, `getCurrentUserId`, route handlers) goes through it.
 *
 * Linking is by verified primary email, once: the first time a Clerk
 * user signs in, an ACTIVE `User` with that email and no
 * `clerkUserId` yet gets the Clerk id written onto it. The write is a
 * single conditional `updateMany` (`clerkUserId IS NULL`), so two
 * Clerk identities racing for one row cannot both win, and an
 * already-linked row is never re-pointed. After that the Clerk id is
 * the identity; the email is never consulted again.
 *
 * Fails closed: anything unexpected (Clerk API error, unverified
 * email, inactive user) is `no_access`, never `ok`.
 */

import { cache } from "react";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { requestIsOnPortalHost } from "@/lib/portal/host";
import { staffAuthorizedParties } from "@/lib/staff-authorized-parties";
import { AUTH_EVENT_TITLES, logAuthEvent } from "@/lib/auth-events";

/** Minimum gap between `no_access` audit rows for one Clerk user. */
const NO_ACCESS_LOG_WINDOW_MS = 15 * 60 * 1000;

export type StaffAuth =
  | { status: "signed_out" }
  | { status: "no_access"; clerkUserId: string }
  | { status: "ok"; userId: string; clerkUserId: string; sessionId: string };

/** The user's verified primary email, lowercased; null if none. */
async function verifiedPrimaryEmail(clerkUserId: string): Promise<string | null> {
  const client = await clerkClient();
  const user = await client.users.getUser(clerkUserId);
  const primary = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId);
  if (!primary || primary.verification?.status !== "verified") return null;
  return primary.emailAddress.trim().toLowerCase();
}

/**
 * Map a Clerk identity to a firm user, linking on first sign-in.
 * Exported for tests; callers use `getStaffAuth`.
 */
export async function resolveStaffUser(clerkUserId: string, sessionId: string): Promise<StaffAuth> {
  const noAccess: StaffAuth = { status: "no_access", clerkUserId };
  const ok = (userId: string): StaffAuth => ({
    status: "ok",
    userId,
    clerkUserId,
    sessionId,
  });

  const linked = await prisma.user.findUnique({
    where: { clerkUserId },
    select: { id: true, isActive: true },
  });
  if (linked) return linked.isActive ? ok(linked.id) : noAccess;

  let email: string | null;
  try {
    email = await verifiedPrimaryEmail(clerkUserId);
  } catch (err) {
    console.error("[staff-auth] Clerk lookup failed; denying access", err);
    return noAccess;
  }
  if (!email) return noAccess;

  const emailMatch = { equals: email, mode: "insensitive" as const };
  const { count } = await prisma.user.updateMany({
    where: { email: emailMatch, isActive: true, clerkUserId: null },
    data: { clerkUserId },
  });

  if (count === 1) {
    const user = await prisma.user.findUnique({
      where: { clerkUserId },
      select: { id: true, isActive: true },
    });
    if (user?.isActive) {
      await logAuthEvent({
        userId: user.id,
        kind: "account_linked",
        reason: `Clerk ${clerkUserId}`,
      });
      return ok(user.id);
    }
    return noAccess;
  }

  // Lost the race to ourselves (a concurrent request for the SAME
  // Clerk id linked it first): the row is ours, so this is fine.
  const now = await prisma.user.findUnique({
    where: { clerkUserId },
    select: { id: true, isActive: true },
  });
  if (now) return now.isActive ? ok(now.id) : noAccess;

  const row = await prisma.user.findFirst({
    where: { email: emailMatch },
    select: { id: true },
  });
  // Every request from an unlinkable Clerk user lands here, so the
  // audit row is deduped: at most one per Clerk id per window. The
  // "Clerk user <id>:" prefix of `detail` is the match key.
  const tag = `Clerk user ${clerkUserId}:`;
  const recent = await prisma.activityLog.findFirst({
    where: {
      type: "auth",
      title: AUTH_EVENT_TITLES.no_access,
      detail: { startsWith: tag },
      timestamp: { gt: new Date(Date.now() - NO_ACCESS_LOG_WINDOW_MS) },
    },
    select: { id: true },
  });
  if (!recent) {
    await logAuthEvent({
      userId: row?.id ?? null,
      kind: "no_access",
      reason: row
        ? `${tag} row unavailable (inactive or linked elsewhere)`
        : `${tag} no firm user for ${email}`,
    });
  }
  return noAccess;
}

type ClerkIdentity = { userId: string | null; sessionId: string | null };

async function fromIdentity(id: ClerkIdentity | null): Promise<StaffAuth> {
  if (!id?.userId || !id.sessionId) return { status: "signed_out" };
  return resolveStaffUser(id.userId, id.sessionId);
}

/**
 * Who is making this request. Cached per request, so `no_access` is
 * logged at most once per render. The portal-host check comes first:
 * Clerk's `auth()` throws when its middleware did not run (the portal
 * host is excluded from it), and portal visitors are never staff.
 */
export const getStaffAuth = cache(async (): Promise<StaffAuth> => {
  if (await requestIsOnPortalHost()) return { status: "signed_out" };
  return fromIdentity(await auth());
});

/**
 * Same resolution for routes the Clerk middleware matcher excludes
 * (so the proxy never buffers their body): authenticate the request
 * directly instead of reading middleware state.
 */
export async function getStaffAuthFromRequest(req: Request): Promise<StaffAuth> {
  if (await requestIsOnPortalHost()) return { status: "signed_out" };
  const client = await clerkClient();
  const state = await client.authenticateRequest(req, {
    acceptsToken: "session_token",
    // Same origins clerkMiddleware verifies against (src/proxy.ts).
    authorizedParties: staffAuthorizedParties(),
  });
  return fromIdentity(state.toAuth());
}
