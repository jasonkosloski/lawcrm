/**
 * Mark-thread-read island.
 *
 * Invisible client component mounted inside the (server-rendered)
 * thread readers. Opening a thread IS reading it, so this fires the
 * channel's mark-as-read action once per thread open — the effect
 * keys on threadId, so switching threads within the same mounted
 * reader re-fires for the new thread.
 *
 * No StrictMode double-fire guard on purpose: the actions are
 * idempotent (they no-op server-side when already read), so a
 * duplicate dev-mode call is harmless.
 */

"use client";

import { useEffect } from "react";
import {
  markEmailThreadRead,
  markMessengerThreadRead,
} from "@/app/actions/thread-read";

export function MarkThreadRead({
  threadId,
  channel,
}: {
  threadId: string;
  channel: "email" | "messenger";
}) {
  useEffect(() => {
    const action =
      channel === "email" ? markEmailThreadRead : markMessengerThreadRead;
    // Fire-and-forget — a transient failure just means the badge
    // clears on the next open. Never block or error the reader.
    void action(threadId).catch(() => {});
  }, [threadId, channel]);

  return null;
}
