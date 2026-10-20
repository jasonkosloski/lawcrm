/**
 * Thin wrapper over the Clerk Backend API for the Settings -> Team
 * admin actions. Every function swallows Clerk errors (logged) and
 * returns a result object, so callers can finish their DB work and
 * surface a warning instead of failing half-way.
 *
 * Methods verified against @clerk/backend types: invitations.
 * createInvitation, invitations.getInvitationList/revokeInvitation, users.banUser/unbanUser, sessions.getSessionList
 * (paginated { data, totalCount }), getSession, revokeSession.
 */

import "server-only";
import { clerkClient } from "@clerk/nextjs/server";
import { staffAppUrl } from "@/lib/staff-authorized-parties";

export type ClerkResult = { ok: true } | { ok: false; error: string };

export type StaffSessionInfo = {
  id: string;
  lastActiveAt: Date;
  browser: string | null;
  device: string | null;
  location: string | null;
  ipAddress: string | null;
};

const UNREACHABLE = "Couldn't reach the sign-in service.";
const PAGE = 100;

function fail(err: unknown): { ok: false; error: string } {
  console.error("[clerk-admin]", err);
  return { ok: false, error: UNREACHABLE };
}

/** Every active session id for a Clerk user, paging until exhausted. */
async function activeSessionIds(userId: string): Promise<string[]> {
  const client = await clerkClient();
  const ids: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, totalCount } = await client.sessions.getSessionList({
      userId,
      status: "active",
      limit: PAGE,
      offset,
    });
    for (const s of data) ids.push(s.id);
    if (data.length === 0 || offset + data.length >= totalCount) break;
  }
  return ids;
}

export async function inviteStaff(email: string): Promise<ClerkResult> {
  try {
    const base = staffAppUrl();
    if (!base) throw new Error("no staff app URL configured (STAFF_ORIGINS)");
    const client = await clerkClient();
    await client.invitations.createInvitation({
      emailAddress: email,
      redirectUrl: `${base}/login`,
      notify: true,
      ignoreExisting: true,
    });
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Revoke every pending invitation for an email (a member deactivated
 * before they ever signed in has no Clerk user to ban). `query` is a
 * fuzzy filter, so results are re-checked for an exact, case-insensitive
 * email match before anything is revoked.
 */
export async function revokeStaffInvitation(
  email: string
): Promise<ClerkResult> {
  try {
    const client = await clerkClient();
    const wanted = email.trim().toLowerCase();
    const { data } = await client.invitations.getInvitationList({
      query: wanted,
      status: "pending",
      limit: PAGE,
    });
    for (const inv of data) {
      if (inv.emailAddress.trim().toLowerCase() === wanted) {
        await client.invitations.revokeInvitation(inv.id);
      }
    }
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function revokeAllStaffSessions(
  clerkUserId: string
): Promise<ClerkResult> {
  try {
    const client = await clerkClient();
    for (const id of await activeSessionIds(clerkUserId)) {
      await client.sessions.revokeSession(id);
    }
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** Ban, THEN revoke sessions: a ban is not verified to end live sessions. */
export async function banStaff(clerkUserId: string): Promise<ClerkResult> {
  try {
    const client = await clerkClient();
    await client.users.banUser(clerkUserId);
  } catch (err) {
    return fail(err);
  }
  return revokeAllStaffSessions(clerkUserId);
}

export async function unbanStaff(clerkUserId: string): Promise<ClerkResult> {
  try {
    const client = await clerkClient();
    await client.users.unbanUser(clerkUserId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function listActiveStaffSessions(
  clerkUserId: string
): Promise<
  { ok: true; sessions: StaffSessionInfo[] } | { ok: false; error: string }
> {
  try {
    const client = await clerkClient();
    const sessions: StaffSessionInfo[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const { data, totalCount } = await client.sessions.getSessionList({
        userId: clerkUserId,
        status: "active",
        limit: PAGE,
        offset,
      });
      for (const s of data) {
        const a = s.latestActivity;
        const browser = a?.browserName
          ? [a.browserName, a.browserVersion].filter(Boolean).join(" ")
          : null;
        const location =
          [a?.city, a?.country].filter(Boolean).join(", ") || null;
        sessions.push({
          id: s.id,
          lastActiveAt: new Date(s.lastActiveAt),
          browser,
          device: a?.deviceType ?? null,
          location,
          ipAddress: a?.ipAddress ?? null,
        });
      }
      if (data.length === 0 || offset + data.length >= totalCount) break;
    }
    return { ok: true, sessions };
  } catch (err) {
    return fail(err);
  }
}

export async function revokeStaffSession(
  clerkUserId: string,
  sessionId: string
): Promise<ClerkResult> {
  try {
    const client = await clerkClient();
    const session = await client.sessions.getSession(sessionId);
    if (session.userId !== clerkUserId) {
      return { ok: false, error: "Not your session." };
    }
    await client.sessions.revokeSession(sessionId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/**
 * DEV ONLY (callers gate on isDevSignInAllowed): the Clerk user for a
 * seeded email, reusing an existing one before creating. Dev instances
 * accept backend-created users with no verification or password.
 */
export async function ensureDevClerkUser(
  email: string
): Promise<{ ok: true; clerkUserId: string } | { ok: false; error: string }> {
  try {
    const client = await clerkClient();
    const existing = await client.users.getUserList({
      emailAddress: [email],
      limit: 1,
    });
    if (existing.data[0]) return { ok: true, clerkUserId: existing.data[0].id };
    const created = await client.users.createUser({
      emailAddress: [email],
      skipPasswordRequirement: true,
    });
    return { ok: true, clerkUserId: created.id };
  } catch (err) {
    return fail(err);
  }
}

/** DEV ONLY: a 60-second one-time sign-in ticket for a Clerk user. */
export async function createDevSignInToken(
  clerkUserId: string
): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  try {
    const client = await clerkClient();
    const t = await client.signInTokens.createSignInToken({
      userId: clerkUserId,
      expiresInSeconds: 60,
    });
    return { ok: true, token: t.token };
  } catch (err) {
    return fail(err);
  }
}
