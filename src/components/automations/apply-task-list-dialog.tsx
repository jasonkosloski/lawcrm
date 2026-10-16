/**
 * "Apply task list" — matter Tasks tab (ADR-019).
 *
 * Pick a firm task list; its items become tasks on this matter
 * (assigned to the lead attorney or left unassigned per item, due
 * dates offset from today). Already applied → confirm "Apply again".
 * Rendered only for holders of tasks.create (the action rechecks).
 */

"use client";

import { useState, useTransition } from "react";
import { ListChecks, TriangleAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { applyTaskListToMatter } from "@/app/actions/automations";
import type { ApplyTaskListResult } from "@/lib/automation-form";

export type ApplicableTaskList = {
  id: string;
  name: string;
  itemTitles: string[];
};

export function ApplyTaskListDialog({
  matterId,
  lists,
}: {
  matterId: string;
  lists: ApplicableTaskList[];
}) {
  const [open, setOpen] = useState(false);
  const [listId, setListId] = useState("");
  const [result, setResult] = useState<ApplyTaskListResult | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (force = false) => {
    startTransition(async () => {
      const res = await applyTaskListToMatter(matterId, listId, { force });
      if (res.status === "ok") {
        setOpen(false);
        return;
      }
      setResult(res);
    });
  };

  const selected = lists.find((l) => l.id === listId);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setListId(lists[0]?.id ?? "");
          setResult(null);
          setOpen(true);
        }}
        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium bg-white text-ink-2 border border-line hover:border-brand-300 hover:text-brand-700 transition-colors"
      >
        <ListChecks size={13} />
        Apply task list
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Apply a task list</DialogTitle>
            <DialogDescription>
              Adds every task in the list to this matter.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <select
              value={listId}
              onChange={(e) => {
                setListId(e.target.value);
                setResult(null);
              }}
              aria-label="Task list"
              className="h-8 px-2 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30"
            >
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.itemTitles.length})
                </option>
              ))}
            </select>
            {selected && (
              <ul className="text-2xs text-ink-3 list-disc pl-4 flex flex-col gap-0.5 max-h-40 overflow-y-auto">
                {selected.itemTitles.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            )}
            {result?.status === "duplicate" && (
              <Notice>
                &ldquo;{result.name}&rdquo; was already applied to this matter.
                Apply it again to add another copy of every task?
              </Notice>
            )}
            {result?.status === "error" && <Notice>{result.error}</Notice>}
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={pending || !listId}
              onClick={() => submit(result?.status === "duplicate")}
            >
              {pending
                ? "Applying…"
                : result?.status === "duplicate"
                  ? "Apply again"
                  : "Apply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-warn-soft border border-warn-border text-2xs text-warn">
      <TriangleAlert size={12} className="shrink-0 mt-px" />
      <span>{children}</span>
    </div>
  );
}
