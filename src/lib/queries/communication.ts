/**
 * Communication Queries
 *
 * Server-only data access for the unified-inbox /communication page.
 * Email-first today; SMS queries will slot in alongside when the
 * integration lands (see SCHEMA_NOTES open question on Email* vs.
 * polymorphic Communication*).
 */

import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";

export type CommunicationFilter = "all" | "unread" | "starred" | "unfiled";

export type ThreadListRow = {
  id: string;
  subject: string;
  snippet: string | null;
  isRead: boolean;
  isStarred: boolean;
  hasAttachments: boolean;
  messageCount: number;
  lastMessageAt: Date;
  /** First sender in the thread — typically "who's emailing me". */
  fromDisplay: string;
  matter: { id: string; name: string; color: string } | null;
};

export async function listThreads(
  filter: CommunicationFilter = "all"
): Promise<ThreadListRow[]> {
  const userId = await getCurrentUserId();

  // `where` builds from the filter, but always scoped to the current
  // user's accounts.
  const where: Record<string, unknown> = {
    account: { userId },
  };
  if (filter === "unread") where.isRead = false;
  if (filter === "starred") where.isStarred = true;
  if (filter === "unfiled") where.matterId = null;

  const threads = await prisma.emailThread.findMany({
    where,
    include: {
      matter: { select: { id: true, name: true, color: true } },
      messages: {
        orderBy: { sentAt: "asc" },
        take: 1,
        select: { fromName: true, fromEmail: true },
      },
    },
    orderBy: { lastMessageAt: "desc" },
  });

  return threads.map((t) => ({
    id: t.id,
    subject: t.subject,
    snippet: t.snippet,
    isRead: t.isRead,
    isStarred: t.isStarred,
    hasAttachments: t.hasAttachments,
    messageCount: t.messageCount,
    lastMessageAt: t.lastMessageAt,
    fromDisplay:
      t.messages[0]?.fromName ?? t.messages[0]?.fromEmail ?? "Unknown",
    matter: t.matter,
  }));
}

export type ThreadMessageView = {
  id: string;
  fromName: string;
  fromEmail: string;
  toRecipients: Array<{ name?: string; email: string }>;
  ccRecipients: Array<{ name?: string; email: string }>;
  body: string;
  sentAt: Date;
  isPrivileged: boolean;
  attachments: Array<{
    id: string;
    filename: string;
    contentType: string | null;
    fileSize: number | null;
  }>;
};

export type ThreadDetail = {
  id: string;
  subject: string;
  matter: { id: string; name: string; color: string; area: string } | null;
  labels: string[];
  messageCount: number;
  lastMessageAt: Date;
  messages: ThreadMessageView[];
};

function parseRecipients(raw: string | null): Array<{ name?: string; email: string }> {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter(
      (e): e is { name?: string; email: string } =>
        e && typeof e === "object" && typeof e.email === "string"
    );
  } catch {
    return [];
  }
}

export async function getThreadById(id: string): Promise<ThreadDetail | null> {
  const userId = await getCurrentUserId();
  const thread = await prisma.emailThread.findFirst({
    where: { id, account: { userId } },
    include: {
      matter: {
        select: {
          id: true,
          name: true,
          color: true,
          practiceArea: { select: { name: true } },
        },
      },
      labels: true,
      messages: {
        include: { attachments: true },
        orderBy: { sentAt: "asc" },
      },
    },
  });
  if (!thread) return null;
  return {
    id: thread.id,
    subject: thread.subject,
    matter: thread.matter
      ? {
          id: thread.matter.id,
          name: thread.matter.name,
          color: thread.matter.color,
          area: thread.matter.practiceArea.name,
        }
      : null,
    labels: thread.labels.map((l) => l.label),
    messageCount: thread.messageCount,
    lastMessageAt: thread.lastMessageAt,
    messages: thread.messages.map((m) => ({
      id: m.id,
      fromName: m.fromName,
      fromEmail: m.fromEmail,
      toRecipients: parseRecipients(m.toRecipients),
      ccRecipients: parseRecipients(m.ccRecipients),
      body: m.body,
      sentAt: m.sentAt,
      isPrivileged: m.isPrivileged,
      attachments: m.attachments.map((a) => ({
        id: a.id,
        filename: a.filename,
        contentType: a.contentType,
        fileSize: a.fileSize,
      })),
    })),
  };
}

/** Threads whose `matterId` points at this matter — scoped to the
 *  current user's accounts. Used by the matter's Communication tab. */
export async function listThreadsForMatter(
  matterId: string
): Promise<ThreadListRow[]> {
  const userId = await getCurrentUserId();
  const threads = await prisma.emailThread.findMany({
    where: { matterId, account: { userId } },
    include: {
      matter: { select: { id: true, name: true, color: true } },
      messages: {
        orderBy: { sentAt: "asc" },
        take: 1,
        select: { fromName: true, fromEmail: true },
      },
    },
    orderBy: { lastMessageAt: "desc" },
  });
  return threads.map((t) => ({
    id: t.id,
    subject: t.subject,
    snippet: t.snippet,
    isRead: t.isRead,
    isStarred: t.isStarred,
    hasAttachments: t.hasAttachments,
    messageCount: t.messageCount,
    lastMessageAt: t.lastMessageAt,
    fromDisplay:
      t.messages[0]?.fromName ?? t.messages[0]?.fromEmail ?? "Unknown",
    matter: t.matter,
  }));
}

/** Threads that touch a given email address (sender OR recipient).
 *  Recipients are stored as JSON strings so the final filter runs in
 *  memory after fetching the candidate set.
 *
 *  Used by the lead Communication tab — since Leads don't have direct
 *  EmailThread links today, email address is the matching key. Schema
 *  may eventually gain a `Lead.threadId[]` relation (see SCHEMA_NOTES
 *  open questions) at which point this becomes a direct join. */
export async function listThreadsForEmail(
  email: string
): Promise<ThreadListRow[]> {
  if (!email) return [];
  const normalized = email.toLowerCase();
  const userId = await getCurrentUserId();

  // Quick candidate fetch: any thread with a message that sent to or
  // from the email (via substring hit on toRecipients/ccRecipients
  // JSON, or exact on fromEmail).
  const candidates = await prisma.emailThread.findMany({
    where: {
      account: { userId },
      messages: {
        some: {
          OR: [
            { fromEmail: { contains: normalized } },
            { toRecipients: { contains: normalized } },
            { ccRecipients: { contains: normalized } },
          ],
        },
      },
    },
    include: {
      matter: { select: { id: true, name: true, color: true } },
      messages: {
        orderBy: { sentAt: "asc" },
        select: {
          fromName: true,
          fromEmail: true,
          toRecipients: true,
          ccRecipients: true,
        },
      },
    },
    orderBy: { lastMessageAt: "desc" },
  });

  // Sharpen the match in memory so a substring collision doesn't
  // produce a false positive.
  const matches = candidates.filter((t) =>
    t.messages.some((m) => {
      if (m.fromEmail.toLowerCase() === normalized) return true;
      const to = parseRecipients(m.toRecipients);
      if (to.some((r) => r.email.toLowerCase() === normalized)) return true;
      const cc = parseRecipients(m.ccRecipients);
      return cc.some((r) => r.email.toLowerCase() === normalized);
    })
  );

  return matches.map((t) => ({
    id: t.id,
    subject: t.subject,
    snippet: t.snippet,
    isRead: t.isRead,
    isStarred: t.isStarred,
    hasAttachments: t.hasAttachments,
    messageCount: t.messageCount,
    lastMessageAt: t.lastMessageAt,
    fromDisplay:
      t.messages[0]?.fromName ?? t.messages[0]?.fromEmail ?? "Unknown",
    matter: t.matter,
  }));
}

export type CommunicationCounts = {
  all: number;
  unread: number;
  starred: number;
  unfiled: number;
};

export async function getCommunicationCounts(): Promise<CommunicationCounts> {
  const userId = await getCurrentUserId();
  const base = { account: { userId } };
  const [all, unread, starred, unfiled] = await Promise.all([
    prisma.emailThread.count({ where: base }),
    prisma.emailThread.count({ where: { ...base, isRead: false } }),
    prisma.emailThread.count({ where: { ...base, isStarred: true } }),
    prisma.emailThread.count({ where: { ...base, matterId: null } }),
  ]);
  return { all, unread, starred, unfiled };
}
