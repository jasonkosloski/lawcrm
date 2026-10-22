/**
 * Emailed-link landing page. Renders a button only: the token is consumed
 * by the form POST, never on render, so mail scanners that prefetch the
 * link cannot burn it. Reachable signed out by design.
 */

import { prisma } from "@/lib/prisma";
import { AuthPanel } from "../../auth-panel";
import { LoginForm } from "../../login/login-form";
import { PortalOff } from "../../portal-off";
import { VerifyForm } from "./verify-form";
import { firstParam } from "@/lib/search-params";

export default async function PortalVerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const firm = await prisma.firm.findFirst({ select: { portalEnabled: true } });
  const sp = await searchParams;
  const token = firstParam(sp.token);

  if (!firm?.portalEnabled) {
    return (
      <AuthPanel title="Sign in">
        <PortalOff />
      </AuthPanel>
    );
  }

  if (!token) {
    return (
      <AuthPanel
        title="Link expired"
        description="This link has expired or was already used."
      >
        <LoginForm submitLabel="Send a new link" />
      </AuthPanel>
    );
  }

  return (
    <AuthPanel title="Sign in">
      <VerifyForm token={token} />
    </AuthPanel>
  );
}
