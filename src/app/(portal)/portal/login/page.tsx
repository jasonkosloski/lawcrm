/** Portal sign-in: request an emailed link. Reachable signed out by design. */

import { prisma } from "@/lib/prisma";
import { requestAllowsDevPortalSignIn } from "@/lib/portal/host";
import { AuthPanel } from "../auth-panel";
import { PortalOff } from "../portal-off";
import { DevSignIn, type DevPortalUser } from "./dev-sign-in";
import { LoginForm } from "./login-form";

/** Invited clients who could sign in now, for the dev shortcut only. */
async function devPortalUsers(): Promise<DevPortalUser[]> {
  const rows = await prisma.portalIdentity.findMany({
    where: { disabledAt: null, access: { some: { revokedAt: null } } },
    select: {
      id: true,
      email: true,
      contact: { select: { name: true } },
      _count: { select: { access: { where: { revokedAt: null } } } },
    },
    orderBy: { email: "asc" },
  });
  return rows.map((r) => ({
    identityId: r.id,
    name: r.contact.name,
    email: r.email,
    matterCount: r._count.access,
  }));
}

export default async function PortalLoginPage() {
  const firm = await prisma.firm.findFirst({ select: { portalEnabled: true } });

  if (!firm?.portalEnabled) {
    return (
      <AuthPanel title="Sign in">
        <PortalOff />
      </AuthPanel>
    );
  }

  const devUsers = (await requestAllowsDevPortalSignIn()) ? await devPortalUsers() : null;

  return (
    <AuthPanel
      title="Sign in"
      description="Enter the email address your legal team invited. We’ll email you a secure link to sign in. There’s no password to remember."
    >
      <LoginForm />
      {devUsers ? <DevSignIn users={devUsers} /> : null}
    </AuthPanel>
  );
}
