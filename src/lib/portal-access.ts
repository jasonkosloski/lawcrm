import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requestIsOnPortalHost } from "@/lib/portal/host";
import { PORTAL_COOKIE } from "@/lib/portal/cookie";
import { resolveSession } from "@/lib/portal/sessions";

export type PortalIdentityContext = {
  identityId: string;
  contactId: string;
  email: string;
};

/**
 * The signed-in portal identity, or null. Null when there is no portal
 * cookie (a staff Auth.js cookie is never consulted), the session is dead,
 * the identity is disabled, or the firm has the portal switched off. The
 * app is single-tenant; no firm row counts as disabled.
 *
 * Wrapped in React `cache()` so the portal layout and page share one lookup
 * per request (cache is request-scoped; nothing leaks across requests).
 */
export const getPortalIdentity = cache(
  async function getPortalIdentity(): Promise<PortalIdentityContext | null> {
    if (!(await requestIsOnPortalHost())) return null;
    const raw = (await cookies()).get(PORTAL_COOKIE)?.value;
    if (!raw) return null;

    const firm = await prisma.firm.findFirst({
      select: { portalEnabled: true },
    });
    if (!firm?.portalEnabled) return null;

    const session = await resolveSession(raw);
    if (!session) return null;

    const identity = await prisma.portalIdentity.findUnique({
      where: { id: session.identityId },
      select: { id: true, contactId: true, email: true },
    });
    if (!identity) return null;
    return {
      identityId: identity.id,
      contactId: identity.contactId,
      email: identity.email,
    };
  }
);

/**
 * PAGE guard only. Throws a redirect to the portal login; never wrap in
 * try/catch. Do not call it from a server action: Next renders an action's
 * redirect target in the same request without going back through the proxy
 * rewrite, so the client would get the STAFF page for that path (see the
 * note in src/app/actions/portal-session.ts). Actions use getPortalIdentity()
 * and return a result instead.
 */
export async function requirePortalIdentity(): Promise<PortalIdentityContext> {
  const identity = await getPortalIdentity();
  if (!identity) redirect("/login");
  return identity;
}

/** notFound() unless the identity holds live (unrevoked) access to the matter. */
export async function assertPortalMatterAccess(
  identityId: string,
  matterId: string
): Promise<void> {
  const row = await prisma.portalMatterAccess.findFirst({
    where: { identityId, matterId, revokedAt: null },
    select: { id: true },
  });
  if (!row) notFound();
}

/** Matter filter for portal list queries: live access only. */
export function portalMatterWhere(identityId: string): Prisma.MatterWhereInput {
  return { portalAccess: { some: { identityId, revokedAt: null } } };
}
