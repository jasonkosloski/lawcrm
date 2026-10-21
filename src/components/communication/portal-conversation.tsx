/**
 * Portal channel of the matter Communication tab: the staff view of the
 * client-portal conversation (oldest first) plus a plain-text composer.
 * The page renders it only for portal.view_messages holders; the composer
 * follows portal.send_messages (`canSend`). The actions re-check both.
 *
 * Opening the channel is reading it, so an invisible island marks the
 * thread read once on mount. Message times are instants: shown in the
 * viewer's profile zone (ADR-012). Bodies are plain text, never HTML.
 */

"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  markStaffPortalThreadRead,
  sendStaffPortalMessage,
} from "@/app/actions/portal-messages";
import { formatDate } from "@/lib/format-date";
import type { getPortalConversation } from "@/lib/queries/portal-messages";

const MAX_BODY = 5000;

type Conversation = NonNullable<Awaited<ReturnType<typeof getPortalConversation>>>;

function MarkPortalThreadRead({ matterId }: { matterId: string }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    // Fire-and-forget: a transient failure just leaves the badge for next open.
    void markStaffPortalThreadRead(matterId).catch(() => {});
  }, [matterId]);
  return null;
}

export function PortalConversation({
  matterId,
  conversation,
  canSend,
  tz,
}: {
  matterId: string;
  conversation: Conversation;
  canSend: boolean;
  tz: string;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const send = () => {
    const body = draft.trim();
    if (!body || pending) return;
    setError(null);
    setWarning(null);
    startTransition(async () => {
      const res = await sendStaffPortalMessage(matterId, body);
      if (res.ok) {
        setDraft("");
        if (res.warning) setWarning(res.warning);
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-3">
      <MarkPortalThreadRead matterId={matterId} />
      {!conversation.hasLiveAccess && (
        <p className="text-xs text-ink-3">
          No one has portal access on this matter yet.
        </p>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3">
        {conversation.messages.length === 0 ? (
          <p className="text-sm text-ink-3">No portal messages yet.</p>
        ) : (
          conversation.messages.map((m) => (
            <div key={m.id} className="rounded-md border border-line bg-white p-3">
              <div className="flex items-baseline gap-2 text-xs text-ink-3">
                <span data-testid="portal-author" className="font-medium text-ink">
                  {m.authorName}
                </span>
                {m.fromClient && (
                  <span className="rounded bg-paper-2 px-1.5 text-2xs">Client</span>
                )}
                <span>{formatDate(m.createdAt, "datetime", tz)}</span>
              </div>
              <p className="mt-1 text-sm text-ink whitespace-pre-line break-words">
                {m.body}
              </p>
            </div>
          ))
        )}
      </div>
      {canSend && (
        <div className="flex flex-col gap-2">
          <textarea
            aria-label="Message to client"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={MAX_BODY}
            rows={3}
            placeholder="Write a message to the client…"
            className="w-full rounded-md border border-line bg-white p-2 text-sm"
          />
          {error && (
            <p role="alert" className="text-xs text-red-600">
              {error}
            </p>
          )}
          {warning && (
            <p role="status" className="text-xs text-ink-3">
              {warning}
            </p>
          )}
          <div className="flex justify-end">
            <Button type="button" onClick={send} disabled={pending || !draft.trim()}>
              Send
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
