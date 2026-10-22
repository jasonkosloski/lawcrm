/**
 * Drafts above the /matters/new form: Resume, and Delete (creator or
 * Admin) behind the app dialog - never window.confirm.
 */

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteMatterDraft } from "@/app/actions/matter-drafts";
import type { MatterDraftListItem } from "@/lib/queries/matter-drafts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function MatterDraftsList({
  drafts,
  timeZone,
  openDraftId,
}: {
  drafts: MatterDraftListItem[];
  timeZone?: string;
  /** The draft currently open in the form, if any. */
  openDraftId?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<MatterDraftListItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (drafts.length === 0) return null;

  const savedAt = (d: Date) =>
    new Date(d).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      ...(timeZone ? { timeZone } : {}),
    });

  const confirmDelete = () => {
    const target = confirming;
    if (!target) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteMatterDraft(target.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setConfirming(null);
      // Deleting the draft that is open leaves the form pointing at
      // nothing: go back to a blank one.
      if (target.id === openDraftId) router.replace("/matters/new");
      else router.refresh();
    });
  };

  return (
    <section aria-label="Matter drafts" className="mb-5">
      <h2 className="text-2xs font-mono uppercase tracking-wider text-ink-4 mb-2">Drafts</h2>
      <ul className="flex flex-col divide-y divide-line rounded-md border border-line bg-white">
        {drafts.map((d) => (
          <li key={d.id} className="flex items-center gap-3 px-3 py-2 text-xs">
            <div className="flex-1 min-w-0">
              <div className="font-medium text-ink truncate">{d.clientLabel}</div>
              <div className="text-2xs text-ink-4 truncate">
                {[
                  d.practiceAreaName,
                  `Saved ${savedAt(d.updatedAt)}`,
                  `Started by ${d.createdByName}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
              {d.deletesInDays !== null && (
                <div className="text-2xs text-warn">
                  Deletes in {d.deletesInDays} day{d.deletesInDays === 1 ? "" : "s"}
                </div>
              )}
            </div>
            {/* A plain anchor on purpose: Resume is a full navigation so
                the form re-seeds from the saved draft instead of reusing
                the open form's state. */}
            <a
              href={`/matters/new?draft=${encodeURIComponent(d.id)}`}
              className="inline-flex items-center h-7 px-2.5 rounded-md border border-line text-ink-2 hover:border-brand-300 hover:text-brand-700"
            >
              Resume
            </a>
            {d.canDelete && (
              <Button
                variant="ghost"
                size="xs"
                type="button"
                onClick={() => {
                  setError(null);
                  setConfirming(d);
                }}
                className="text-warn hover:underline"
              >
                Delete
              </Button>
            )}
          </li>
        ))}
      </ul>

      <Dialog
        open={confirming !== null}
        onOpenChange={(o) => {
          if (!o && !pending) setConfirming(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this draft?</DialogTitle>
            <DialogDescription>
              {confirming
                ? `"${confirming.clientLabel}" and any files attached to it will be deleted. This can't be undone.`
                : null}
            </DialogDescription>
          </DialogHeader>
          {error && <div className="text-xs text-warn">{error}</div>}
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={pending} onClick={confirmDelete}>
              {pending ? "Deleting…" : "Delete draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
