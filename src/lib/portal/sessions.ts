import "server-only";

import { prisma } from "@/lib/prisma";
import { hashSecret, newSecret } from "./secrets";

const DAY_MS = 24 * 60 * 60 * 1000;
const IDLE_MS = 7 * DAY_MS;
const ABSOLUTE_MS = 30 * DAY_MS;
const SLIDE_AFTER_MS = 60 * 1000;

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
  raw: string
): Promise<{ sessionId: string; identityId: string } | null> {
  const session = await prisma.portalSession.findUnique({
    where: { tokenHash: hashSecret(raw) },
    include: { identity: { select: { disabledAt: true } } },
  });
  const now = new Date();
  if (!session || session.expiresAt <= now || session.identity.disabledAt) {
    return null;
  }
  if (now.getTime() - session.lastSeenAt.getTime() > SLIDE_AFTER_MS) {
    const expiresAt = new Date(
      Math.min(
        now.getTime() + IDLE_MS,
        session.createdAt.getTime() + ABSOLUTE_MS
      )
    );
    await prisma.portalSession.update({
      where: { id: session.id },
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
