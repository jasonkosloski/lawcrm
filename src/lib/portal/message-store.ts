import "server-only";

import { prisma } from "@/lib/prisma";

export const PORTAL_MESSAGE_MAX = 5000;

export function parseMessageBody(
  raw: unknown,
): { ok: true; body: string } | { ok: false; error: string } {
  const body = typeof raw === "string" ? raw.trim() : "";
  if (!body) return { ok: false, error: "Message can't be empty." };
  if (body.length > PORTAL_MESSAGE_MAX) {
    return {
      ok: false,
      error: `Message is too long (max ${PORTAL_MESSAGE_MAX.toLocaleString("en-US")} characters).`,
    };
  }
  return { ok: true, body };
}

export type PortalMessageAuthor =
  | { kind: "client"; identityId: string }
  | { kind: "staff"; userId: string };

type Reader = { userId: string } | { identityId: string };

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Move a reader's read marker forward (never back). Callers have already
 * gated access.  */
async function advanceReadStateIn(
  db: Tx | typeof prisma,
  threadId: string,
  reader: Reader,
  at: Date,
): Promise<void> {
  // Upsert on the compound unique whose column is set (the other half is
  // NULL), so concurrent first reads can't both insert.
  const where =
    "userId" in reader
      ? { threadId_userId: { threadId, userId: reader.userId } }
      : { threadId_identityId: { threadId, identityId: reader.identityId } };
  const who =
    "userId" in reader
      ? { userId: reader.userId }
      : { identityId: reader.identityId };
  const row = await db.portalReadState.upsert({
    where,
    create: { threadId, ...who, lastReadAt: at },
    update: {},
    select: { id: true },
  });
  // Guarded so a late/out-of-order call never moves the marker backwards.
  await db.portalReadState.updateMany({
    where: { id: row.id, lastReadAt: { lt: at } },
    data: { lastReadAt: at },
  });
}

export async function advanceReadState(
  threadId: string,
  reader: Reader,
  at: Date = new Date(),
): Promise<void> {
  await advanceReadStateIn(prisma, threadId, reader, at);
}

async function ensureThread(
  matterId: string,
  now: Date,
  fromClient: boolean,
): Promise<{ id: string }> {
  const existing = await prisma.portalThread.findUnique({
    where: { matterId },
    select: { id: true },
  });
  if (existing) return existing;
  try {
    return await prisma.portalThread.create({
      data: { matterId, lastMessageAt: now, lastFromClient: fromClient },
      select: { id: true },
    });
  } catch (e) {
    if ((e as { code?: string }).code !== "P2002") throw e;
    return prisma.portalThread.findUniqueOrThrow({
      where: { matterId },
      select: { id: true },
    });
  }
}

/**
 * Append a message to the matter's thread (creating it on first use) and
 * advance the sender's read marker, in one transaction. The caller has
 * already gated access. `now` exists only for tests.
 */
export async function recordPortalMessage(
  matterId: string,
  body: string,
  author: PortalMessageAuthor,
  now: Date = new Date(),
): Promise<{ messageId: string; threadId: string; createdAt: Date }> {
  const fromClient = author.kind === "client";
  // Thread creation is idempotent and done outside the transaction: a racing
  // first send loses with P2002, which would otherwise abort the whole tx.
  const thread = await ensureThread(matterId, now, fromClient);
  return prisma.$transaction(async (tx) => {
    const message = await tx.portalMessage.create({
      data: {
        threadId: thread.id,
        body,
        authorKind: author.kind,
        authorIdentityId: author.kind === "client" ? author.identityId : null,
        authorUserId: author.kind === "staff" ? author.userId : null,
        createdAt: now,
      },
      select: { id: true, createdAt: true },
    });
    // Guarded so concurrent or out-of-order sends never regress the thread.
    await tx.portalThread.updateMany({
      where: { id: thread.id, lastMessageAt: { lte: message.createdAt } },
      data: { lastMessageAt: message.createdAt, lastFromClient: fromClient },
    });
    await advanceReadStateIn(
      tx,
      thread.id,
      author.kind === "client"
        ? { identityId: author.identityId }
        : { userId: author.userId },
      message.createdAt,
    );
    return { messageId: message.id, threadId: thread.id, createdAt: message.createdAt };
  });
}
