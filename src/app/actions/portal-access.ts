/**
 * Staff actions for client-portal access: invite, revoke, disable.
 *
 * Matter-scoped actions assert matter access (ADR-039) before touching
 * anything, outside any try/catch, so a walled user gets Next's
 * not-found. Staff activity rows carry the staff userId and matterId.
 */

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { assertMatterAccess } from "@/lib/matter-access";
import { requirePermissionResult } from "@/lib/permission-check";
import { logActivity, logActivityTx } from "@/lib/activity-log";
import { issueToken } from "@/lib/portal/tokens";
import { deleteSessionsFor } from "@/lib/portal/sessions";
import { inviteEmail } from "@/lib/portal/emails";
import { portalLinkUrl } from "@/lib/portal/link-url";
import { sendEmail } from "@/lib/email/send";
import { isLenientEmail } from "@/lib/email-shape";
import { actorSeesAllPortalMatters } from "@/lib/portal/identity-scope";

type Result = { ok: true } | { ok: false; error: string };

const PORTAL_OFF = "The client portal is not available right now.";
const SEND_FAILED = "Couldn't send the invite email; try again.";

export async function invitePortalUser(
  matterId: string,
  contactId: string,
  email: string
): Promise<Result> {
  const gate = await requirePermissionResult("portal.invite");
  if (!gate.ok) return { ok: false, error: gate.error };
  // Outside any try/catch: denial is notFound().
  await assertMatterAccess(matterId);

  const normalized = (email ?? "").trim().toLowerCase();
  if (!normalized || normalized.length > 254 || !isLenientEmail(normalized)) {
    return { ok: false, error: "Enter a valid email address." };
  }

  const [user, matter, contact] = await Promise.all([
    prisma.user.findUnique({
      where: { id: gate.userId },
      select: { firm: { select: { name: true, portalEnabled: true } } },
    }),
    prisma.matter.findUnique({
      where: { id: matterId },
      select: { name: true, isArchived: true },
    }),
    prisma.contact.findUnique({
      where: { id: contactId },
      select: { id: true, name: true, mergedIntoId: true, isActive: true },
    }),
  ]);
  if (!user?.firm?.portalEnabled) return { ok: false, error: PORTAL_OFF };
  if (!matter) return { ok: false, error: "Matter not found." };
  if (!contact || contact.mergedIntoId) {
    return { ok: false, error: "Contact not found." };
  }
  if (matter.isArchived) return { ok: false, error: "This matter is archived." };
  if (!contact.isActive) return { ok: false, error: "This contact is inactive." };

  const existing = await prisma.portalIdentity.findUnique({
    where: { contactId },
    select: { id: true, email: true, disabledAt: true },
  });
  let emailChanged = false;
  if (existing) {
    emailChanged = existing.email !== normalized;
    if (
      (existing.disabledAt || emailChanged) &&
      !(await actorSeesAllPortalMatters(gate.userId, existing.id))
    ) {
      return {
        ok: false,
        error: existing.disabledAt
          ? "This person's portal access is disabled. Someone who can see all of their matters must re-enable it."
          : "This person already has portal access under a different email. Someone who can see all of their matters must change it.",
      };
    }
  }

  const now = new Date();
  const EMAIL_TAKEN = "Another portal user already uses this email.";
  let identityId: string;
  try {
    identityId = await prisma.$transaction(async (tx) => {
      const taken = await tx.portalIdentity.findFirst({
        where: { email: normalized, NOT: { contactId } },
        select: { id: true },
      });
      if (taken) throw new Error("EMAIL_TAKEN");
      // An explicit invite re-enables a disabled identity (checked above).
      const identity = await tx.portalIdentity.upsert({
        where: { contactId },
        create: { contactId, email: normalized },
        update: { email: normalized, disabledAt: null },
        select: { id: true },
      });
      await tx.portalMatterAccess.upsert({
        where: { identityId_matterId: { identityId: identity.id, matterId } },
        create: {
          identityId: identity.id,
          matterId,
          invitedById: gate.userId,
          invitedAt: now,
        },
        update: {
          revokedAt: null,
          revokedById: null,
          invitedById: gate.userId,
          invitedAt: now,
        },
      });
      await logActivityTx(tx, {
        matterId,
        userId: gate.userId,
        type: "auth",
        title: `Invited ${contact.name} to the client portal`,
      });
      return identity.id;
    });
  } catch (err) {
    if (
      (err instanceof Error && err.message === "EMAIL_TAKEN") ||
      (err as { code?: string })?.code === "P2002"
    ) {
      return { ok: false, error: EMAIL_TAKEN };
    }
    throw err;
  }
  if (emailChanged) await deleteSessionsFor(identityId);

  // issueToken uses its own client, so it runs right after commit. It
  // also kills the identity's earlier unused tokens.
  const raw = await issueToken(identityId, "invite");
  const msg = inviteEmail(portalLinkUrl(raw), user.firm.name, matter.name);
  const sent = await sendEmail({ to: normalized, ...msg });

  revalidatePath(`/matters/${matterId}`);
  if (!sent.ok) return { ok: false, error: SEND_FAILED };
  return { ok: true };
}

export async function revokePortalAccess(
  accessId: string
): Promise<{ ok: boolean; error?: string }> {
  const gate = await requirePermissionResult("portal.revoke");
  if (!gate.ok) return { ok: false, error: gate.error };

  const access = await prisma.portalMatterAccess.findUnique({
    where: { id: accessId },
    select: {
      id: true,
      matterId: true,
      identityId: true,
      identity: { select: { contact: { select: { name: true } } } },
    },
  });
  if (!access) return { ok: false, error: "Access not found." };
  await assertMatterAccess(access.matterId);

  const lastLive = await prisma.$transaction(async (tx) => {
    const { count } = await tx.portalMatterAccess.updateMany({
      where: { id: access.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedById: gate.userId },
    });
    if (count === 0) return null; // already revoked
    await logActivityTx(tx, {
      matterId: access.matterId,
      userId: gate.userId,
      type: "auth",
      title: `Revoked ${access.identity.contact.name}'s client portal access`,
    });
    const others = await tx.portalMatterAccess.count({
      where: { identityId: access.identityId, revokedAt: null },
    });
    return others === 0;
  });

  if (lastLive) await deleteSessionsFor(access.identityId);
  revalidatePath(`/matters/${access.matterId}`);
  return { ok: true };
}

export async function disablePortalIdentity(
  identityId: string
): Promise<{ ok: boolean; error?: string }> {
  const gate = await requirePermissionResult("portal.revoke");
  if (!gate.ok) return { ok: false, error: gate.error };

  const identity = await prisma.portalIdentity.findUnique({
    where: { id: identityId },
    select: { id: true, contact: { select: { name: true } } },
  });
  if (!identity) return { ok: false, error: "Portal login not found." };
  if (!(await actorSeesAllPortalMatters(gate.userId, identityId))) {
    return {
      ok: false,
      error:
        "You can only disable someone whose portal matters you can all see. Revoke access on this matter instead.",
    };
  }

  await prisma.portalIdentity.update({
    where: { id: identityId },
    data: { disabledAt: new Date() },
  });
  await deleteSessionsFor(identityId);
  await logActivity({
    matterId: null,
    userId: gate.userId,
    type: "auth",
    title: `Disabled ${identity.contact.name}'s client portal login`,
  });
  revalidatePath("/matters", "layout");
  return { ok: true };
}
