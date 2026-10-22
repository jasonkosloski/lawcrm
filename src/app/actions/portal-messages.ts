/**
 * Staff actions for client portal messaging.
 *
 * Gate order: permission, then matter access (ADR-039) inline and outside
 * any try/catch so a walled user gets Next's not-found.
 */

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { assertMatterAccess } from "@/lib/matter-access";
import { requirePermissionResult } from "@/lib/permission-check";
import { logActivity } from "@/lib/activity-log";
import { sendEmail } from "@/lib/email/send";
import { portalMessageEmail } from "@/lib/portal/emails";
import { portalHomeUrl } from "@/lib/portal/link-url";
import {
  advanceReadState,
  parseMessageBody,
  recordPortalMessage,
} from "@/lib/portal/message-store";

type Result = { ok: true; warning?: string } | { ok: false; error: string };

const EMAIL_THROTTLE_MS = 15 * 60 * 1000;
const EMAIL_WARNING = "Message sent, but the client email didn't go out.";

/**
 * Emails each live portal client of the matter, at most once per
 * throttle window. Returns true when any delivery failed. Never throws.
 */
async function emailClientsThrottled(matterId: string, threadId: string): Promise<boolean> {
  let failed = false;
  try {
    const firm = await prisma.firm.findFirst({ select: { portalEnabled: true } });
    if (!firm?.portalEnabled) return false;
    const identities = await prisma.portalIdentity.findMany({
      where: { disabledAt: null, access: { some: { matterId, revokedAt: null } } },
      select: { id: true, email: true },
    });
    for (const identity of identities) {
      try {
        const state = await prisma.portalReadState.findUnique({
          where: { threadId_identityId: { threadId, identityId: identity.id } },
          select: { lastEmailedAt: true },
        });
        const last = state?.lastEmailedAt;
        if (last && Date.now() - last.getTime() < EMAIL_THROTTLE_MS) continue;
        const res = await sendEmail({
          to: identity.email,
          ...portalMessageEmail(portalHomeUrl()),
        });
        if (!res.ok) {
          failed = true;
          continue;
        }
        const sentAt = new Date();
        await prisma.portalReadState.upsert({
          where: { threadId_identityId: { threadId, identityId: identity.id } },
          create: {
            threadId,
            identityId: identity.id,
            lastReadAt: new Date(0),
            lastEmailedAt: sentAt,
          },
          update: { lastEmailedAt: sentAt },
        });
      } catch (err) {
        console.warn("[portal-messages] client email failed", err);
        failed = true;
      }
    }
  } catch (err) {
    console.warn("[portal-messages] client email failed", err);
    failed = true;
  }
  return failed;
}

export async function sendStaffPortalMessage(matterId: string, body: string): Promise<Result> {
  const gate = await requirePermissionResult("portal.send_messages");
  if (!gate.ok) return { ok: false, error: gate.error };
  await assertMatterAccess(matterId);

  const parsed = parseMessageBody(body);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const { threadId } = await recordPortalMessage(matterId, parsed.body, {
    kind: "staff",
    userId: gate.userId,
  });

  const emailFailed = await emailClientsThrottled(matterId, threadId);

  await logActivity({
    matterId,
    userId: gate.userId,
    type: "note",
    title: "Sent a client portal message",
  });
  revalidatePath(`/matters/${matterId}/communication`);
  revalidatePath("/communication");
  return emailFailed ? { ok: true, warning: EMAIL_WARNING } : { ok: true };
}

/**
 * Silent no-op without the view key, with no thread, or when nothing is
 * unread (no write, no revalidation, so a mount-time call can't loop).
 * Stamps the thread's lastMessageAt, not now, so a message that arrived
 * after render stays unread.
 */
export async function markStaffPortalThreadRead(matterId: string): Promise<void> {
  const gate = await requirePermissionResult("portal.view_messages");
  if (!gate.ok) return;
  await assertMatterAccess(matterId);
  const thread = await prisma.portalThread.findUnique({
    where: { matterId },
    select: { id: true, lastMessageAt: true },
  });
  if (!thread) return;
  const state = await prisma.portalReadState.findUnique({
    where: { threadId_userId: { threadId: thread.id, userId: gate.userId } },
    select: { lastReadAt: true },
  });
  if (state && state.lastReadAt >= thread.lastMessageAt) return;
  await advanceReadState(thread.id, { userId: gate.userId }, thread.lastMessageAt);
  // Reading the thread re-arms the "once per burst" notification.
  await prisma.notification.updateMany({
    where: { userId: gate.userId, matterId, type: "portal_message", readAt: null },
    data: { readAt: new Date() },
  });
  revalidatePath(`/matters/${matterId}/communication`);
  revalidatePath("/communication");
}
