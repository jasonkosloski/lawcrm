"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { signOutPortal } from "@/app/actions/portal-session";
import { Button } from "@/components/ui/button";

/**
 * Signs out, then does a full navigation so the request passes through the
 * portal proxy rewrite (a server action redirect would not; see
 * portal-session.ts). Styled for the navy portal header.
 */
export function SignOutButton() {
  const [pending, setPending] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      aria-label="Sign out"
      className="h-8 border-white/25 bg-transparent px-3 text-white hover:bg-white/10 hover:text-white focus-visible:ring-white/40"
      onClick={async () => {
        setPending(true);
        try {
          await signOutPortal();
        } finally {
          // Intentional full navigation (goes through the proxy rewrite).
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.assign("/login");
        }
      }}
    >
      <LogOut data-icon="inline-start" aria-hidden="true" />
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  );
}
