/**
 * Client status card (matter Overview, beside the Portal card).
 * Staff post "where things stand" updates the client reads in the
 * portal. The page renders this only for holders of portal.view; Post
 * follows portal.add_updates, Edit portal.edit_updates and Delete
 * portal.delete_updates. The server actions re-check all of it.
 *
 * postedAt / editedAt are instants: shown in the viewer's profile
 * zone (ADR-012).
 */

"use client";

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
import {
  deleteStatusUpdate,
  editStatusUpdate,
  postStatusUpdate,
} from "@/app/actions/portal-status";
import { formatDate } from "@/lib/format-date";
import { confirmAction, notifyError } from "@/lib/feedback";
import type {
  ClientStatusCardData,
  ClientStatusUpdateRow,
} from "@/lib/queries/portal-status";

type Editing = { mode: "new" } | { mode: "edit"; update: ClientStatusUpdateRow };

export function ClientStatusCard({
  matterId,
  data,
  canAdd,
  canEdit,
  canDelete,
  tz,
}: {
  matterId: string;
  data: ClientStatusCardData;
  canAdd: boolean;
  canEdit: boolean;
  canDelete: boolean;
  tz?: string;
}) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [showEarlier, setShowEarlier] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [latest, ...earlier] = data.updates;

  // Opening a dialog starts a new action: drop any leftover warning.
  const openDialog = (next: Editing) => {
    setNotice(null);
    setEditing(next);
  };

  const remove = async (u: ClientStatusUpdateRow) => {
    if (
      !(await confirmAction({
        title: "Delete this update?",
        description: "The client will no longer see it in the portal.",
        confirmLabel: "Delete update",
        destructive: true,
      }))
    ) {
      return;
    }
    setNotice(null);
    startTransition(async () => {
      const res = await deleteStatusUpdate(u.id);
      if (!res.ok) notifyError(res.error);
    });
  };

  const renderUpdate = (u: ClientStatusUpdateRow) => (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-ink">{u.stageLabel}</div>
        <div className="mt-0.5 whitespace-pre-line break-words text-xs text-ink-2">
          {u.body}
        </div>
        <div className="mt-0.5 text-2xs text-ink-4">
          {formatDate(u.postedAt, "medium", tz)} · {u.postedByName}
          {u.editedAt && " · edited"}
        </div>
      </div>
      {(canEdit || canDelete) && (
        <div className="flex flex-wrap justify-end gap-1">
          {canEdit && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => openDialog({ mode: "edit", update: u })}
            >
              Edit
            </Button>
          )}
          {canDelete && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => remove(u)}
            >
              Delete
            </Button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">Client status</CardTitle>
          {canAdd && (
            <Button size="sm" variant="outline" onClick={() => openDialog({ mode: "new" })}>
              Post update
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {!data.hasLiveAccess && (
          <div className="mb-2 text-2xs text-ink-4">
            No one has portal access on this matter yet.
          </div>
        )}
        {notice && (
          <div role="status" className="mb-2 text-2xs text-warn">
            {notice}
          </div>
        )}
        {!latest ? (
          <div className="py-2 text-xs text-ink-4">No status updates posted.</div>
        ) : (
          <>
            {renderUpdate(latest)}
            {earlier.length > 0 && (
              <div className="mt-2">
                <button
                  type="button"
                  aria-expanded={showEarlier}
                  onClick={() => setShowEarlier((v) => !v)}
                  className="text-2xs text-brand-700 hover:underline"
                >
                  {showEarlier ? "Hide earlier" : `${earlier.length} earlier`}
                </button>
                {showEarlier && (
                  <ul className="mt-1 flex flex-col divide-y divide-line">
                    {earlier.map((u) => (
                      <li key={u.id} className="py-2 last:pb-0">
                        {renderUpdate(u)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
      {editing && (
        <StatusDialog
          matterId={matterId}
          editing={editing}
          defaultLabel={latest?.stageLabel ?? ""}
          onClose={() => setEditing(null)}
          onWarning={setNotice}
        />
      )}
    </Card>
  );
}

function StatusDialog({
  matterId,
  editing,
  defaultLabel,
  onClose,
  onWarning,
}: {
  matterId: string;
  editing: Editing;
  defaultLabel: string;
  onClose: () => void;
  onWarning: (message: string | null) => void;
}) {
  const existing = editing.mode === "edit" ? editing.update : null;
  const [stageLabel, setStageLabel] = useState(existing?.stageLabel ?? defaultLabel);
  const [body, setBody] = useState(existing?.body ?? "");
  const [emailClient, setEmailClient] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const res = existing
        ? await editStatusUpdate(existing.id, { stageLabel, body })
        : await postStatusUpdate(matterId, { stageLabel, body, emailClient });
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
          <DialogTitle>{existing ? "Edit update" : "Post update"}</DialogTitle>
          <DialogDescription>
            The client sees this in the portal as where things stand.
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
            Stage
            <input
              value={stageLabel}
              onChange={(e) => setStageLabel(e.target.value)}
              maxLength={60}
              className="h-8 rounded-md border border-line bg-paper px-2 text-xs text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-2">
            What&apos;s next
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              maxLength={4000}
              className="rounded-md border border-line bg-paper px-2 py-1 text-xs text-ink"
            />
          </label>
          {!existing && (
            <label className="flex items-center gap-2 text-xs text-ink-2">
              <input
                type="checkbox"
                checked={emailClient}
                onChange={(e) => setEmailClient(e.target.checked)}
              />
              Email the client about this update
            </label>
          )}
          {error && (
            <div role="alert" className="text-2xs text-warn">
              {error}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button
              type="submit"
              disabled={pending || !stageLabel.trim() || !body.trim()}
            >
              {pending ? "Saving…" : existing ? "Save" : "Post update"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
