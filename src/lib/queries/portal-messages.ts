import "server-only";

import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { assertMatterAccess, matterAccessWhere } from "@/lib/matter-access";
import { currentUserHasPermission } from "@/lib/permission-check";
import { pageWindow } from "@/lib/pagination";
import { matterHasLivePortalAccess } from "@/lib/queries/document-requests";

const PAGE_SIZE = 100;
const SNIPPET_CHARS = 120;

export type StaffPortalMessage = {
  id: string;
  body: string;
  createdAt: Date;
  fromClient: boolean;
  authorName: string;
};

/**
 * Staff view of a matter's portal conversation, oldest first. Same gate
 * order as getClientStatusCardData: matter wall first (throws notFound),
 * then portal.view_messages (null without it). A matter with no thread,
 * or a thread whose first message insert failed, is an empty conversation.
 * `unread` counts client messages newer than the viewer's own read marker.
 */
export async function getPortalConversation(
  matterId: string
): Promise<{
  messages: StaffPortalMessage[];
  hasLiveAccess: boolean;
  unread: number;
} | null> {
  const userId = await assertMatterAccess(matterId);
  if (!(await currentUserHasPermission("portal.view_messages"))) return null;

  const [thread, hasLiveAccess] = await Promise.all([
    prisma.portalThread.findUnique({
      where: { matterId },
      select: {
        messages: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            body: true,
            createdAt: true,
            authorKind: true,
            authorIdentity: { select: { contact: { select: { name: true } } } },
            authorUser: { select: { name: true } },
          },
        },
        readStates: {
          where: { userId },
          select: { lastReadAt: true },
        },
      },
    }),
    matterHasLivePortalAccess(matterId),
  ]);
  if (!thread) return { messages: [], hasLiveAccess, unread: 0 };

  const lastReadAt = thread.readStates[0]?.lastReadAt ?? null;
  let unread = 0;
  const messages = thread.messages.map((m): StaffPortalMessage => {
    const fromClient = m.authorKind === "client";
    if (fromClient && (!lastReadAt || m.createdAt > lastReadAt)) unread++;
    return {
      id: m.id,
      body: m.body,
      createdAt: m.createdAt,
      fromClient,
      authorName: fromClient
        ? (m.authorIdentity?.contact.name ?? "Client")
        : (m.authorUser?.name ?? "Staff"),
    };
  });
  return { messages, hasLiveAccess, unread };
}

export type PortalThreadRow = {
  matterId: string;
  matterName: string;
  awaitingReply: boolean;
  unread: number;
  snippet: string;
  lastMessageAt: Date;
};

type ThreadExtras = { id: string; snippet: string | null; unread: number };

/**
 * Portal threads on matters the viewer may see, awaiting-reply first then
 * newest, 100 per page. Threads with no messages are excluded (a failed
 * first send can leave one). Snippet and per-viewer unread for the page
 * come from one parameterized query, not one per thread.
 */
export async function listPortalThreadsForViewer(
  page: number
): Promise<{ rows: PortalThreadRow[]; total: number }> {
  if (!(await currentUserHasPermission("portal.view_messages"))) {
    return { rows: [], total: 0 };
  }
  const userId = await getCurrentUserId();
  const where = {
    messages: { some: {} },
    matter: await matterAccessWhere(userId),
  };

  const total = await prisma.portalThread.count({ where });
  const win = pageWindow(total, page, PAGE_SIZE);
  const threads = await prisma.portalThread.findMany({
    where,
    orderBy: [{ lastFromClient: "desc" }, { lastMessageAt: "desc" }, { id: "asc" }],
    skip: win.skip,
    take: win.take,
    select: {
      id: true,
      matterId: true,
      lastMessageAt: true,
      lastFromClient: true,
      matter: { select: { name: true } },
    },
  });
  if (threads.length === 0) return { rows: [], total };

  const ids = threads.map((t) => t.id);
  const extras = await prisma.$queryRaw<ThreadExtras[]>`
    SELECT
      t."id",
      (
        SELECT LEFT(m."body", ${SNIPPET_CHARS}::int)
        FROM "portal_messages" m
        WHERE m."threadId" = t."id"
        ORDER BY m."createdAt" DESC, m."id" DESC
        LIMIT 1
      ) AS "snippet",
      (
        SELECT COUNT(*)::int
        FROM "portal_messages" m
        WHERE m."threadId" = t."id"
          AND m."authorKind" = 'client'
          AND m."createdAt" > COALESCE(
            (
              SELECT rs."lastReadAt"
              FROM "portal_read_states" rs
              WHERE rs."threadId" = t."id" AND rs."userId" = ${userId}
            ),
            '-infinity'::timestamp
          )
      ) AS "unread"
    FROM "portal_threads" t
    WHERE t."id" = ANY(${ids}::text[])
  `;
  const byId = new Map(extras.map((e) => [e.id, e]));

  return {
    total,
    rows: threads.map((t) => ({
      matterId: t.matterId,
      matterName: t.matter.name,
      awaitingReply: t.lastFromClient,
      unread: byId.get(t.id)?.unread ?? 0,
      snippet: byId.get(t.id)?.snippet ?? "",
      lastMessageAt: t.lastMessageAt,
    })),
  };
}
