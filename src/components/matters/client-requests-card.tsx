/**
 * Client requests card (matter Overview, beside the Portal card).
 * Staff ask the client for documents; the client uploads against a
 * request in the portal; staff accept the upload or send it back with
 * a note. The page renders this only for holders of portal.view; New
 * follows portal.add_requests, Edit/Accept/Send back/Cancel follow
 * portal.edit_requests and Delete follows portal.delete_requests. The
 * server actions re-check all of it.
 *
 * Due dates are date-only calendar dates (ADR-012): shown with
 * formatDateOnly, edited as YYYY-MM-DD.
 */

"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DateOnlyField } from "@/components/calendar/date-only-field";
import {
  acceptDocumentRequest,
  cancelDocumentRequest,
  createDocumentRequest,
  deleteDocumentRequest,
  sendBackDocumentRequest,
  updateDocumentRequest,
} from "@/app/actions/portal-documents";
import { dateOnlyKey, formatDateOnly } from "@/lib/format-date";
import { confirmAction, notifyError } from "@/lib/feedback";
import type { DocumentRequestRow } from "@/lib/queries/document-requests";

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  submitted: "Submitted",
  complete: "Complete",
  cancelled: "Cancelled",
};

type Editing = { mode: "new" } | { mode: "edit"; request: DocumentRequestRow };

export function ClientRequestsCard({
  matterId,
  requests,
  hasLiveAccess,
  canAdd,
  canEdit,
  canDelete,
}: {
  matterId: string;
  requests: DocumentRequestRow[];
  hasLiveAccess: boolean;
  canAdd: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [sendBackFor, setSendBackFor] = useState<DocumentRequestRow | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) notifyError(res.error);
    });

  const cancel = async (r: DocumentRequestRow) => {
    if (
      !(await confirmAction({
        title: `Cancel "${r.title}"?`,
        description: "The client will no longer see this request in the portal.",
        confirmLabel: "Cancel request",
        destructive: true,
      }))
    ) {
      return;
    }
    run(() => cancelDocumentRequest(r.id));
  };

  const remove = async (r: DocumentRequestRow) => {
    if (
      !(await confirmAction({
        title: `Delete "${r.title}"?`,
        description: "This can't be undone.",
        confirmLabel: "Delete request",
        destructive: true,
      }))
    ) {
      return;
    }
    run(() => deleteDocumentRequest(r.id));
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">Client requests</CardTitle>
          {canAdd && (
            <Button size="sm" variant="outline" onClick={() => setEditing({ mode: "new" })}>
              New request
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {!hasLiveAccess && (
          <div className="mb-2 text-2xs text-ink-4">
            No one has portal access on this matter yet.
          </div>
        )}
        {requests.length === 0 ? (
          <div className="py-2 text-xs text-ink-4">No document requests.</div>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {requests.map((r) => {
              const live = r.status === "open" || r.status === "submitted";
              return (
                <li key={r.id} className="py-2 first:pt-0 last:pb-0">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-ink">{r.title}</div>
                      <div className="text-2xs text-ink-3">
                        {STATUS_LABEL[r.status] ?? r.status}
                        {r.dueDate && ` · Due ${formatDateOnly(r.dueDate, "medium")}`}
                      </div>
                      {r.returnNote && r.status === "open" && (
                        <div className="text-2xs text-ink-4">
                          Sent back: {r.returnNote}
                        </div>
                      )}
                      {r.documents.length > 0 && (
                        <ul className="mt-1 flex flex-col gap-0.5">
                          {r.documents.map((d) => (
                            <li key={d.id} className="text-2xs">
                              <Link
                                href={`/matters/${matterId}/documents/${d.id}`}
                                className="text-brand-700 hover:underline"
                              >
                                {d.name}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="flex flex-wrap justify-end gap-1">
                      {canEdit && r.status === "submitted" && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={pending}
                            onClick={() => run(() => acceptDocumentRequest(r.id))}
                          >
                            Accept
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={pending}
                            onClick={() => setSendBackFor(r)}
                          >
                            Send back
                          </Button>
                        </>
                      )}
                      {canEdit && r.status === "open" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => setEditing({ mode: "edit", request: r })}
                        >
                          Edit
                        </Button>
                      )}
                      {canEdit && live && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => cancel(r)}
                        >
                          Cancel request
                        </Button>
                      )}
                      {canDelete && r.documents.length === 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => remove(r)}
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
      {editing && (
        <RequestDialog
          matterId={matterId}
          editing={editing}
          onClose={() => setEditing(null)}
        />
      )}
      {sendBackFor && (
        <SendBackDialog request={sendBackFor} onClose={() => setSendBackFor(null)} />
      )}
    </Card>
  );
}

function RequestDialog({
  matterId,
  editing,
  onClose,
}: {
  matterId: string;
  editing: Editing;
  onClose: () => void;
}) {
  const existing = editing.mode === "edit" ? editing.request : null;
  const [title, setTitle] = useState(existing?.title ?? "");
  const [instructions, setInstructions] = useState(existing?.instructions ?? "");
  const [dueDate, setDueDate] = useState(existing?.dueDate ? dateOnlyKey(existing.dueDate) : "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const input = { title, instructions, dueDate };
      const res = existing
        ? await updateDocumentRequest(existing.id, input)
        : await createDocumentRequest(matterId, input);
      if (res.ok) onClose();
      else setError(res.error);
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit request" : "Request documents"}</DialogTitle>
          <DialogDescription>
            The client sees this in the portal and can upload files against it.
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
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              className="h-8 rounded-md border border-line bg-paper px-2 text-xs text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-2">
            Instructions (optional)
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={3}
              className="rounded-md border border-line bg-paper px-2 py-1 text-xs text-ink"
            />
          </label>
          <DateOnlyField
            name="dueDate"
            label="Due date (optional)"
            value={dueDate}
            onChange={setDueDate}
            required={false}
          />
          {error && (
            <div role="alert" className="text-2xs text-warn">
              {error}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button type="submit" disabled={pending || !title.trim()}>
              {pending ? "Saving…" : existing ? "Save" : "Request documents"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SendBackDialog({
  request,
  onClose,
}: {
  request: DocumentRequestRow;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const res = await sendBackDocumentRequest(request.id, note);
      if (res.ok) onClose();
      else setError(res.error);
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send back &quot;{request.title}&quot;</DialogTitle>
          <DialogDescription>
            The request reopens in the portal with your note.
          </DialogDescription>
        </DialogHeader>
        <label className="flex flex-col gap-1 text-xs text-ink-2">
          Note to the client
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
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
          <Button disabled={pending || !note.trim()} onClick={submit}>
            {pending ? "Sending…" : "Send to client"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
