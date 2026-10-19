/**
 * Portal error boundary. Plain and portal-styled: no staff links or copy,
 * and no error message or digest shown to clients (it is logged to the
 * browser console only). `retry()` re-fetches the segment (Next 16).
 */

"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

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
    <div className="py-10 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-ink-3">
        We could not load this page. Please try again.
      </p>
      <Button className="mt-4" onClick={() => retry()}>
        Try again
      </Button>
    </div>
  );
}
