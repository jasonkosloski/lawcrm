"use client";

import { useState } from "react";
import { signOutPortal } from "@/app/actions/portal-session";
import { Button } from "@/components/ui/button";

/**
 * Signs out, then does a full navigation so the request passes through the
 * portal proxy rewrite (a server action redirect would not; see
 * portal-session.ts).
 */
export function SignOutButton() {
  const [pending, setPending] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
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
      Sign out
    </Button>
  );
}
