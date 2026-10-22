/**
 * Create / edit a task list — Settings → Automations (ADR-019).
 *
 * Name + an ordered item editor (add / remove / reorder). Each item:
 * title, optional details, priority, who gets it (the matter's lead
 * attorney or nobody), and an optional "due N days after applied".
 * Items post as one JSON field; the action validates every row.
 */

"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2, TriangleAlert } from "lucide-react";
import { useDialogActionState } from "@/hooks/use-dialog-action-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { createTaskList, updateTaskList } from "@/app/actions/automations";
import {
  automationInitialState,
  type AutomationFormState,
  type TaskListItemInput,
} from "@/lib/automation-form";
import { TASK_PRIORITIES, TASK_PRIORITY_LABEL } from "@/lib/constants/priority";
import type { TaskListRow } from "@/lib/queries/automations";
import { inputClass, labelClass } from "@/components/ui/field";

type DraftItem = {
  key: number;
  title: string;
  description: string;
  priority: (typeof TASK_PRIORITIES)[number];
  assignTo: "lead" | "unassigned";
  /** "" = no due date. */
  due: string;
};

let nextKey = 1;
const blankItem = (): DraftItem => ({
  key: nextKey++,
  title: "",
  description: "",
  priority: "normal",
  assignTo: "lead",
  due: "",
});

export function TaskListDialog({
  open,
  onOpenChange,
  list,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = create. */
  list: TaskListRow | null;
}) {
  const action = list ? updateTaskList.bind(null, list.id) : createTaskList;
  const [state, formAction, isPending] = useDialogActionState<AutomationFormState, FormData>(
    action,
    automationInitialState,
    open
  );

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [items, setItems] = useState<DraftItem[]>([]);

  // Starts "closed" so a dialog first rendered already open seeds too.
  const [prev, setPrev] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });
  if (open !== prev.open || (list?.id ?? null) !== prev.id) {
    setPrev({ open, id: list?.id ?? null });
    if (open) {
      setName(list?.name ?? "");
      setDescription(list?.description ?? "");
      setItems(
        list && list.items.length > 0
          ? list.items.map((i) => ({
              key: nextKey++,
              title: i.title,
              description: i.description ?? "",
              priority: (TASK_PRIORITIES as readonly string[]).includes(i.priority)
                ? (i.priority as DraftItem["priority"])
                : "normal",
              assignTo: i.assignTo === "lead" ? "lead" : "unassigned",
              due: i.dueOffsetDays === null ? "" : String(i.dueOffsetDays),
            }))
          : [blankItem()]
      );
    }
  }

  useEffect(() => {
    if (state.status === "ok") onOpenChange(false);
  }, [state, onOpenChange]);

  const update = (key: number, patch: Partial<DraftItem>) =>
    setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const move = (index: number, delta: -1 | 1) =>
    setItems((xs) => {
      const to = index + delta;
      if (to < 0 || to >= xs.length) return xs;
      const copy = [...xs];
      [copy[index], copy[to]] = [copy[to], copy[index]];
      return copy;
    });

  const payload: TaskListItemInput[] = items
    .filter((i) => i.title.trim() !== "")
    .map((i) => ({
      title: i.title.trim(),
      description: i.description.trim() || null,
      priority: i.priority,
      assignTo: i.assignTo,
      dueOffsetDays: i.due === "" ? null : Number.parseInt(i.due, 10),
    }));

  const errs = state.errors ?? {};

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{list ? "Edit task list" : "New task list"}</DialogTitle>
          <DialogDescription>
            Applying the list adds every task to the matter. Edits affect
            future applications only.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="items" value={JSON.stringify(payload)} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Name</span>
              <input name="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} placeholder="§1983 intake checklist" className={inputClass()} />
              {errs.name?.[0] && <span className="text-2xs text-warn">{errs.name[0]}</span>}
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Description (optional)</span>
              <input name="description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} className={inputClass()} />
            </label>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="hidden sm:grid grid-cols-[1fr_96px_120px_88px_76px] gap-2 px-1">
              <span className={labelClass}>Task</span>
              <span className={labelClass}>Priority</span>
              <span className={labelClass}>Assign to</span>
              <span className={labelClass}>Due (days)</span>
              <span />
            </div>
            <div className="flex flex-col gap-2 max-h-[45vh] overflow-y-auto pr-1">
              {items.map((item, idx) => (
                <div key={item.key} className="flex flex-col gap-1 p-1.5 rounded-md border border-line bg-paper">
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_96px_120px_88px_76px] gap-2 items-center">
                    <input aria-label="Task title" value={item.title} onChange={(e) => update(item.key, { title: e.target.value })} maxLength={200} placeholder={`Task ${idx + 1}`} className={inputClass()} />
                    <NativeSelect aria-label="Priority" value={item.priority} onChange={(e) => update(item.key, { priority: e.target.value as DraftItem["priority"] })} className="w-full">
                      {TASK_PRIORITIES.map((p) => <NativeSelectOption key={p} value={p}>{TASK_PRIORITY_LABEL[p]}</NativeSelectOption>)}
                    </NativeSelect>
                    <NativeSelect aria-label="Assign to" value={item.assignTo} onChange={(e) => update(item.key, { assignTo: e.target.value as DraftItem["assignTo"] })} className="w-full">
                      <NativeSelectOption value="lead">Lead attorney</NativeSelectOption>
                      <NativeSelectOption value="unassigned">Unassigned</NativeSelectOption>
                    </NativeSelect>
                    <input aria-label="Due days after applied" type="number" min={0} max={3650} value={item.due} onChange={(e) => update(item.key, { due: e.target.value })} placeholder="none" className={inputClass()} />
                    <div className="flex items-center gap-0.5 justify-end">
                      <IconBtn label="Move up" onClick={() => move(idx, -1)} disabled={idx === 0}><ArrowUp size={13} /></IconBtn>
                      <IconBtn label="Move down" onClick={() => move(idx, 1)} disabled={idx === items.length - 1}><ArrowDown size={13} /></IconBtn>
                      <IconBtn label="Remove task" onClick={() => setItems((xs) => xs.filter((x) => x.key !== item.key))} disabled={items.length === 1}><Trash2 size={13} /></IconBtn>
                    </div>
                  </div>
                  <input aria-label="Task details" value={item.description} onChange={(e) => update(item.key, { description: e.target.value })} maxLength={4000} placeholder="Details (optional)" className={`${inputClass()} h-7 text-2xs`} />
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setItems((xs) => [...xs, blankItem()])} className="self-start inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-xs text-brand-700 hover:bg-brand-soft">
              <Plus size={13} /> Add task
            </button>
            <span className="text-3xs text-ink-4">
              Due dates count from the day the list is applied. Leave blank for no due date.
            </span>
          </div>

          {(errs.items?.[0] || errs._form?.[0]) && (
            <div className="flex items-center gap-2 text-2xs text-warn">
              <TriangleAlert size={12} /> {errs.items?.[0] ?? errs._form?.[0]}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" size="sm" disabled={isPending || payload.length === 0}>
              {isPending ? "Saving…" : list ? "Save list" : "Create list"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function IconBtn({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center justify-center w-6 h-6 rounded text-ink-4 hover:bg-paper-2 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
