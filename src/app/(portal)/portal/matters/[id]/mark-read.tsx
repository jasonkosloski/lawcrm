"use client";

/** Invisible: marks the conversation read once per mount. */

import { useEffect, useRef } from "react";
import { markPortalMessagesRead } from "@/app/actions/portal-messages-client";

export function MarkMessagesRead({ matterId }: { matterId: string }) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    void markPortalMessagesRead(matterId);
  }, [matterId]);
  return null;
}
