import "server-only";

import { prisma } from "@/lib/prisma";
import { hashSecret, newSecret } from "./secrets";

const LIFETIME_MS = {
  login: 15 * 60 * 1000,
  invite: 7 * 24 * 60 * 60 * 1000,
} as const;

/**
 * Issue a single-use token. Any other unused token for the identity (either
 * purpose) is marked used first, so only the newest link works.
 * Returns the raw token; only its hash is stored.
 */
export async function issueToken(identityId: string, purpose: "login" | "invite"): Promise<string> {
  const raw = newSecret();
  const now = new Date();
  await prisma.$transaction([
    prisma.portalLoginToken.updateMany({
      where: { identityId, usedAt: null },
      data: { usedAt: now },
    }),
    prisma.portalLoginToken.create({
      data: {
        identityId,
        tokenHash: hashSecret(raw),
        purpose,
        expiresAt: new Date(now.getTime() + LIFETIME_MS[purpose]),
      },
    }),
  ]);
  return raw;
}

/**
 * Consume a token. One conditional update decides the winner, so two
 * concurrent callers can never both succeed.
 */
export async function consumeToken(raw: string): Promise<{ identityId: string } | null> {
  const tokenHash = hashSecret(raw);
  const now = new Date();
  const { count } = await prisma.portalLoginToken.updateMany({
    where: {
      tokenHash,
      usedAt: null,
      expiresAt: { gt: now },
      identity: { disabledAt: null },
    },
    data: { usedAt: now },
  });
  if (count !== 1) return null;
  const row = await prisma.portalLoginToken.findUnique({
    where: { tokenHash },
    select: { identityId: true },
  });
  return row ? { identityId: row.identityId } : null;
}
