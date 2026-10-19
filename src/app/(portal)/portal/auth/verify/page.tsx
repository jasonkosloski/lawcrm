/**
 * Emailed-link landing page. Renders a button only: the token is consumed
 * by the form POST, never on render, so mail scanners that prefetch the
 * link cannot burn it. Reachable signed out by design.
 */

import { Card } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { VerifyForm } from "./verify-form";

export default async function PortalVerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const firm = await prisma.firm.findFirst({ select: { portalEnabled: true } });
  const sp = await searchParams;
  const token = Array.isArray(sp.token) ? sp.token[0] : sp.token;

  return (
    <Card className="mx-auto max-w-sm gap-3 px-4 py-5">
      <h1 className="text-lg font-semibold">Sign in</h1>
      {!firm?.portalEnabled ? (
        <p className="text-sm text-ink-3">
          The client portal is not available right now.
        </p>
      ) : token ? (
        <VerifyForm token={token} />
      ) : (
        <p className="text-sm text-ink-3">
          This link has expired or was already used.
        </p>
      )}
    </Card>
  );
}
