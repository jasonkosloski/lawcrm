/**
 * /no-access — a Clerk user who is not an active firm member.
 *
 * Deliberately NOT behind `requireUser()`: its audience is signed-in
 * users with no `User` row, so that guard would bounce them here in a
 * loop (allowlisted in src/app/page-guards.test.ts). It reads no data;
 * it resolves the staff identity itself and sends members home and
 * signed-out visitors to /login.
 */

import { redirect } from "next/navigation";
import { StaffClerkProvider } from "@/components/auth/staff-clerk-provider";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { getStaffAuth } from "@/lib/staff-auth";

export default async function NoAccessPage() {
  const staff = await getStaffAuth();
  if (staff.status === "ok") redirect("/");
  if (staff.status === "signed_out") redirect("/login");

  return (
    <div className="min-h-dvh flex items-center justify-center bg-paper-2 px-4 py-10">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-lg font-semibold text-ink">No access to LitGox</h1>
        <p className="text-sm text-ink-3 mt-3 mb-6">
          You&apos;re signed in with Google, but this account isn&apos;t set up as a firm member.
          Ask an administrator to invite you.
        </p>
        <StaffClerkProvider>
          <SignOutButton />
        </StaffClerkProvider>
      </div>
    </div>
  );
}
