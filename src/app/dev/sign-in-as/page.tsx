/**
 * /dev/sign-in-as — DEV ONLY impersonation for local testing of other
 * seeded roles. 404s unless `isDevSignInAllowed()` (non-production,
 * Clerk test key, not Vercel). The proxy also only treats it as public
 * under that same check, and `devSignInAs` re-checks it.
 *
 * Deliberately NOT behind `requireUser()`: it is how you sign in
 * (outside the page-guards scan, like /login and /no-access). The
 * guard below is its only gate, and it must stay the first statement.
 */

import { notFound } from "next/navigation";
import { DevSignInList } from "@/components/auth/dev-sign-in-list";
import { StaffClerkProvider } from "@/components/auth/staff-clerk-provider";
import { isDevSignInAllowed } from "@/lib/dev-sign-in";
import { prisma } from "@/lib/prisma";

export default async function DevSignInAsPage() {
  if (!isDevSignInAllowed()) notFound();

  const users = await prisma.user.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true, jobTitle: true },
  });

  return (
    <div className="min-h-dvh flex items-center justify-center bg-paper-2 px-4 py-10">
      <div className="w-full max-w-md">
        <h1 className="text-lg font-semibold text-ink">Dev: sign in as</h1>
        <p className="text-2xs font-medium text-ink-3 mt-1 mb-6">
          Local development only
        </p>
        <StaffClerkProvider>
          <DevSignInList users={users} />
        </StaffClerkProvider>
      </div>
    </div>
  );
}
