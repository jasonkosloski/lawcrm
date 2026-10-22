"use server";

import { revalidatePath } from "next/cache";
import { getPortalIdentity } from "@/lib/portal-access";
import { prisma } from "@/lib/prisma";
import { createNotifications } from "@/lib/notifications";
import { canAccessMatter } from "@/lib/matter-access";
import { userHasPermission } from "@/lib/permission-check";
import { logPortalEvent } from "@/lib/portal/audit";
import { livePortalMatterWhere } from "@/lib/portal/status";
import {
  advanceReadState,
  parseMessageBody,
  recordPortalMessage,
} from "@/lib/portal/message-store";

type Result = { ok: true } | { ok: false; error: string };

const HOUR_MS = 60 * 60 * 1000;
const RATE_LIMIT = 30;
const NOT_SIGNED_IN = "Not signed in.";
const CANT_SEND = "You can't send messages on this matter.";
const TOO_FAST = "You're sending messages too quickly. Try again later.";

export async function sendPortalMessage(matterId: string, body: string): Promise<Result> {
  const identity = await getPortalIdentity();
  if (!identity) return { ok: false, error: NOT_SIGNED_IN };

  const where = await livePortalMatterWhere(identity.identityId);
  const matter = where
    ? await prisma.matter.findFirst({
        where: { id: matterId, isArchived: false, ...where },
        select: { id: true, name: true },
      })
    : null;
  if (!matter) return { ok: false, error: CANT_SEND };

  const parsed = parseMessageBody(body);
  if (!parsed.ok) return parsed;

  const recent = await prisma.portalMessage.count({
    where: {
      thread: { matterId },
      authorKind: "client",
      authorIdentityId: identity.identityId,
      createdAt: { gt: new Date(Date.now() - HOUR_MS) },
    },
  });
  if (recent >= RATE_LIMIT) return { ok: false, error: TOO_FAST };

  await recordPortalMessage(matterId, parsed.body, {
    kind: "client",
    identityId: identity.identityId,
  });

  await notifyTeam(matterId, matter.name, identity.contactId);
  await logPortalEvent({
    identityId: identity.identityId,
    matterId,
    title: "Sent a portal message",
  });

  try {
    revalidatePath(`/portal/matters/${matterId}`);
    revalidatePath(`/matters/${matterId}/communication`);
  } catch (err) {
    console.warn("[portal-messages] revalidate failed", err);
  }
  return { ok: true };
}

/** Never throws: the message is already saved. */
async function notifyTeam(matterId: string, matterName: string, contactId: string): Promise<void> {
  try {
    const [members, contact] = await Promise.all([
      prisma.matterTeamMember.findMany({
        where: { matterId, removedAt: null, user: { isActive: true } },
        select: { userId: true },
      }),
      prisma.contact.findUnique({
        where: { id: contactId },
        select: { name: true },
      }),
    ]);
    const recipients: string[] = [];
    for (const { userId } of members) {
      if (!(await userHasPermission(userId, "portal.view_messages"))) continue;
      if (!(await canAccessMatter(userId, matterId))) continue;
      // Once per burst: an unread notification already points at this matter.
      const pending = await prisma.notification.findFirst({
        where: { userId, matterId, type: "portal_message", readAt: null },
        select: { id: true },
      });
      if (pending) continue;
      recipients.push(userId);
    }
    await createNotifications(recipients, {
      type: "portal_message",
      title: `${contact?.name ?? "A client"} sent a message`,
      body: matterName,
      link: `/matters/${matterId}/communication?channel=portal`,
      matterId,
    });
  } catch (err) {
    console.warn("[portal-messages] notify failed", err);
  }
}

export async function markPortalMessagesRead(matterId: string): Promise<void> {
  const identity = await getPortalIdentity();
  if (!identity) return;
  const where = await livePortalMatterWhere(identity.identityId);
  if (!where) return;
  const matter = await prisma.matter.findFirst({
    where: { id: matterId, ...where },
    select: { id: true },
  });
  if (!matter) return;
  const thread = await prisma.portalThread.findUnique({
    where: { matterId },
    select: { id: true, lastMessageAt: true },
  });
  if (!thread) return;
  const state = await prisma.portalReadState.findUnique({
    where: {
      threadId_identityId: { threadId: thread.id, identityId: identity.identityId },
    },
    select: { lastReadAt: true },
  });
  if (state && state.lastReadAt >= thread.lastMessageAt) return;
  await advanceReadState(thread.id, { identityId: identity.identityId }, thread.lastMessageAt);
  revalidatePath("/portal");
}
