/** Portal sign-in: request an emailed link. Reachable signed out by design. */

import { prisma } from "@/lib/prisma";
import { AuthPanel } from "../auth-panel";
import { PortalOff } from "../portal-off";
import { LoginForm } from "./login-form";

export default async function PortalLoginPage() {
  const firm = await prisma.firm.findFirst({ select: { portalEnabled: true } });

  if (!firm?.portalEnabled) {
    return (
      <AuthPanel title="Sign in">
        <PortalOff />
      </AuthPanel>
    );
  }

  return (
    <AuthPanel
      title="Sign in"
      description="Enter the email address your legal team invited. We’ll email you a secure link to sign in. There’s no password to remember."
    >
      <LoginForm />
    </AuthPanel>
  );
}
