/**
 * Portal error boundary. Plain and portal-styled: no staff links or copy,
 * and no error message or digest shown to clients (it is logged to the
 * browser console only). `retry()` re-fetches the segment (Next 16).
 */

"use client";

import { useEffect } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PortalMessage } from "./portal-message";

export default function PortalError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    console.error("Portal error boundary caught:", error);
  }, [error]);

  return (
    <PortalMessage
      icon={TriangleAlert}
      title="Something went wrong"
      description="This page didn’t load. Try again, and if it keeps happening, contact your legal team."
    >
      <Button size="lg" className="h-10 px-4" onClick={() => retry()}>
        Try again
      </Button>
      <Button
        size="lg"
        variant="outline"
        className="h-10 px-4"
        render={<Link href="/" />}
      >
        Go to my matters
      </Button>
    </PortalMessage>
  );
}
