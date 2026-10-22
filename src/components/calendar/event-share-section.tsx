/**
 * "Share with client" control in the event detail modal. Staff pick
 * the title (and optional note) the client sees on the portal; the
 * event's own title/description never go out. canShare
 * (portal.share_events) gates the buttons; the Shared badge shows to
 * anyone the page let see this section (portal.view). The server
 * actions re-check permission and matter access.
 */

"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  shareEventWithClient,
  stopSharingEvent,
  updateEventShare,
} from "@/app/actions/portal-status";
import { notifyError } from "@/lib/feedback";
import type { EventShare } from "@/lib/queries/portal-status";

export function EventShareSection({
  eventId,
  eventTitle,
  canShare,
  share,
}: {
  eventId: string;
  eventTitle: string;
  canShare: boolean;
  share: EventShare | null;
}) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!share && !canShare) return null;

  const stop = () => {
    setNotice(null);
    startTransition(async () => {
      const res = await stopSharingEvent(eventId);
      if (!res.ok) notifyError(res.error);
    });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {share ? (
          <>
            <span className="rounded-full border border-line bg-paper-2 px-2 py-0.5 text-2xs font-medium text-ink-2">
              Shared
            </span>
            <span className="min-w-0 break-words text-xs text-ink-2">
              {share.clientTitle}
            </span>
            {canShare && (
              <span className="ml-auto flex gap-1">
                <Button size="sm" variant="outline" disabled={pending} onClick={() => setOpen(true)}>
                  Edit share
                </Button>
                <Button size="sm" variant="outline" disabled={pending} onClick={stop}>
                  Stop sharing
                </Button>
              </span>
            )}
          </>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            Share with client…
          </Button>
        )}
      </div>
      {notice && (
        <div role="status" className="text-2xs text-warn">
          {notice}
        </div>
      )}
      {open && (
        <ShareDialog
          eventId={eventId}
          eventTitle={eventTitle}
          share={share}
          onClose={() => setOpen(false)}
          onWarning={setNotice}
        />
      )}
    </div>
  );
}

function ShareDialog({
  eventId,
  eventTitle,
  share,
  onClose,
  onWarning,
}: {
  eventId: string;
  eventTitle: string;
  share: EventShare | null;
  onClose: () => void;
  onWarning: (message: string | null) => void;
}) {
  const [clientTitle, setClientTitle] = useState(share?.clientTitle ?? eventTitle);
  const [clientNote, setClientNote] = useState(share?.clientNote ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    onWarning(null);
    startTransition(async () => {
      const input = { clientTitle, clientNote: clientNote.trim() || undefined };
      const res = share
        ? await updateEventShare(eventId, input)
        : await shareEventWithClient(eventId, input);
      if (res.ok) {
        onWarning(res.warning ?? null);
        onClose();
      } else setError(res.error);
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{share ? "Edit share" : "Share with client"}</DialogTitle>
          <DialogDescription>
            The client sees this title and note in the portal, not the
            event&apos;s own details.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex flex-col gap-3"
        >
          <label className="flex flex-col gap-1 text-xs text-ink-2">
            Title
            <input
              value={clientTitle}
              onChange={(e) => setClientTitle(e.target.value)}
              maxLength={200}
              className="h-8 rounded-md border border-line bg-paper px-2 text-xs text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-2">
            Note (optional)
            <textarea
              value={clientNote}
              onChange={(e) => setClientNote(e.target.value)}
              rows={3}
              maxLength={2000}
              className="rounded-md border border-line bg-paper px-2 py-1 text-xs text-ink"
            />
          </label>
          {error && (
            <div role="alert" className="text-2xs text-warn">
              {error}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button type="submit" disabled={pending || !clientTitle.trim()}>
              {pending ? "Saving…" : share ? "Save" : "Share"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
