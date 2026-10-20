/**
 * Thin wrapper over the Clerk Backend API for the Settings -> Team
 * admin actions. Every function swallows Clerk errors (logged) and
 * returns a result object, so callers can finish their DB work and
 * surface a warning instead of failing half-way.
 *
 * Methods verified against @clerk/backend types: invitations.
 * createInvitation, users.banUser/unbanUser, sessions.getSessionList
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
