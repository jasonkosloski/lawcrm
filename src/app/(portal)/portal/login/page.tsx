/** Portal sign-in: request an emailed link. Reachable signed out by design. */

import { Card } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { LoginForm } from "./login-form";

export default async function PortalLoginPage() {
  const firm = await prisma.firm.findFirst({ select: { portalEnabled: true } });

  return (
    <Card className="mx-auto max-w-sm gap-3 px-4 py-5">
      <h1 className="text-lg font-semibold">Sign in</h1>
      {firm?.portalEnabled ? (
        <LoginForm />
      ) : (
        <p className="text-sm text-ink-3">
          The client portal is not available right now.
        </p>
      )}
    </Card>
  );
}
