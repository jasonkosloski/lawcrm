import "server-only";

import { prisma } from "@/lib/prisma";
import { hashSecret, newSecret } from "./secrets";
import { DAY_MS } from "@/lib/format-date";

const IDLE_MS = 7 * DAY_MS;
export const ABSOLUTE_MS = 30 * DAY_MS;
const SLIDE_AFTER_MS = 60 * 1000;

/**
 * Cookie maxAge (seconds) for a session: its remaining absolute lifetime, so
 * the cookie survives browser restarts but never outlives the server cap.
 */
export function sessionCookieMaxAge(createdAt: Date, now: Date = new Date()): number {
  const ms = createdAt.getTime() + ABSOLUTE_MS - now.getTime();
  return Math.max(0, Math.floor(ms / 1000));
}

/** Create a session; returns the raw cookie value (only its hash is stored). */
export async function createSession(identityId: string): Promise<string> {
  const raw = newSecret();
  const now = new Date();
  await prisma.portalSession.create({
    data: {
      identityId,
      tokenHash: hashSecret(raw),
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + IDLE_MS),
    },
  });
  return raw;
}

/**
 * Resolve a cookie value to a live session. Null if unknown, expired, or the
 * identity is disabled. Slides expiry at most once per 60 s, never past
 * createdAt + 30 days.
 */
export async function resolveSession(
  raw: string,
): Promise<{ sessionId: string; identityId: string } | null> {
  const session = await prisma.portalSession.findUnique({
    where: { tokenHash: hashSecret(raw) },
    include: { identity: { select: { disabledAt: true } } },
  });
  const now = new Date();
  if (!session || session.expiresAt <= now || session.identity.disabledAt) {
    return null;
  }
  const slideBefore = new Date(now.getTime() - SLIDE_AFTER_MS);
  if (session.lastSeenAt < slideBefore) {
    const expiresAt = new Date(
      Math.min(now.getTime() + IDLE_MS, session.createdAt.getTime() + ABSOLUTE_MS),
    );
    // updateMany: a concurrent logout/revoke may have deleted the row since
    // the read; that must not throw. The count is deliberately ignored.
    await prisma.portalSession.updateMany({
      where: { id: session.id, lastSeenAt: { lt: slideBefore } },
      data: { lastSeenAt: now, expiresAt },
    });
  }
  return { sessionId: session.id, identityId: session.identityId };
}

export async function deleteSession(raw: string): Promise<void> {
  await prisma.portalSession.deleteMany({
    where: { tokenHash: hashSecret(raw) },
  });
}

export async function deleteSessionsFor(identityId: string): Promise<number> {
  const { count } = await prisma.portalSession.deleteMany({
    where: { identityId },
  });
  return count;
}
