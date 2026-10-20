"use client";

import { useClerk } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";

/**
 * Ends the Clerk session and lands on /login. Must render under a
 * ClerkProvider (the root layout provides it).
 */
export function SignOutButton({ className }: { className?: string }) {
  const { signOut } = useClerk();
  return (
    <Button
      type="button"
      variant="outline"
      className={className}
      onClick={() => signOut({ redirectUrl: "/login" })}
    >
      Sign out
    </Button>
  );
}
