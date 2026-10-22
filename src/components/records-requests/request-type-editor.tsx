/**
 * Request-type list + create/edit dialog + archive/reorder controls
 * for /settings/records-types.
 */

"use client";

import { useEffect, useState, useTransition } from "react";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Pencil, Plus } from "lucide-react";
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
import { Card, CardContent } from "@/components/ui/card";
import {
  createRecordsRequestType,
  moveRecordsRequestType,
  setRecordsRequestTypeActive,
  updateRecordsRequestType,
} from "@/app/actions/records-request-types";
import { recordsRequestInitialState } from "@/lib/records-requests/form";
import type { RecordsRequestTypeRow } from "@/lib/queries/records-requests";
import { inputClass, labelClass } from "@/components/ui/field";

type TemplateOption = { id: string; name: string };

function periodLabel(t: RecordsRequestTypeRow): string {
  if (t.responseAmount == null) return "No statutory period";
  const unit = t.responseUnit === "BUSINESS_DAYS" ? "business" : "calendar";
  return `${t.responseAmount} ${unit} days`;
}

export function RequestTypeEditor({
  types,
  templates,
}: {
  types: RecordsRequestTypeRow[];
  templates: TemplateOption[];
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RecordsRequestTypeRow | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const active = types.filter((t) => t.isActive);
  const archived = types.filter((t) => !t.isActive);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok && res.error) setError(res.error);
    });
  };

  const row = (t: RecordsRequestTypeRow, idx?: number) => (
    <div
      key={t.id}
      className={
        "flex items-center gap-3 px-3 py-2.5 rounded-md border border-line bg-white" +
        (t.isActive ? "" : " opacity-70")
      }
    >
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-ink truncate">{t.name}</div>
        <div className="text-2xs text-ink-4 truncate">
          {periodLabel(t)} · chase every {t.followUpDays}d
          {t.defaultTemplateName ? ` · ${t.defaultTemplateName}` : ""}
        </div>
      </div>
      <div className="flex items-center gap-0.5">
        {t.isActive && idx !== undefined && (
          <>
            <button
              type="button"
              aria-label="Move up"
              title="Move up"
              disabled={pending || idx === 0}
              onClick={() => run(() => moveRecordsRequestType(t.id, "up"))}
              className="inline-flex items-center justify-center w-7 h-7 rounded-md text-ink-3 hover:text-brand-700 hover:bg-brand-soft disabled:opacity-60"
            >
              <ArrowUp size={13} />
            </button>
            <button
              type="button"
              aria-label="Move down"
              title="Move down"
              disabled={pending || idx === active.length - 1}
              onClick={() => run(() => moveRecordsRequestType(t.id, "down"))}
              className="inline-flex items-center justify-center w-7 h-7 rounded-md text-ink-3 hover:text-brand-700 hover:bg-brand-soft disabled:opacity-60"
            >
              <ArrowDown size={13} />
            </button>
          </>
        )}
        <button
          type="button"
          aria-label={`Edit ${t.name}`}
          title="Edit"
          onClick={() => {
            setEditing(t);
            setOpen(true);
          }}
          className="inline-flex items-center justify-center w-7 h-7 rounded-md text-ink-3 hover:text-brand-700 hover:bg-brand-soft"
        >
          <Pencil size={13} />
        </button>
        <button
          type="button"
          aria-label={t.isActive ? `Archive ${t.name}` : `Restore ${t.name}`}
          title={t.isActive ? "Archive" : "Restore"}
          disabled={pending}
          onClick={() => run(() => setRecordsRequestTypeActive(t.id, !t.isActive))}
          className="inline-flex items-center justify-center w-7 h-7 rounded-md text-ink-3 hover:text-brand-700 hover:bg-brand-soft disabled:opacity-60"
        >
          {t.isActive ? <Archive size={13} /> : <ArchiveRestore size={13} />}
        </button>
      </div>
    </div>
  );

  return (
    <>
      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <Plus size={14} /> Add request type
        </Button>
      </div>

      {error && (
        <div role="alert" className="text-2xs text-warn">
          {error}
        </div>
      )}

      <section className="flex flex-col gap-2">
        <div className="text-2xs font-medium text-ink-3">Active ({active.length})</div>
        {active.length === 0 ? (
          <Card>
            <CardContent className="px-4 py-6 text-xs text-ink-4">
              No active request types. Add one to get started.
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-1.5">{active.map((t, i) => row(t, i))}</div>
        )}
      </section>

      {archived.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="text-2xs font-medium text-ink-3">Archived ({archived.length})</div>
          <div className="flex flex-col gap-1.5">{archived.map((t) => row(t))}</div>
        </section>
      )}

      <TypeDialog open={open} onOpenChange={setOpen} type={editing} templates={templates} />
    </>
  );
}

function TypeDialog({
  open,
  onOpenChange,
  type,
  templates,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  type: RecordsRequestTypeRow | null;
  templates: TemplateOption[];
}) {
  const action = type ? updateRecordsRequestType.bind(null, type.id) : createRecordsRequestType;
  const [state, formAction, isPending] = useDialogActionState(
    action,
    recordsRequestInitialState,
    open,
  );
  useEffect(() => {
    if (state.status === "ok") onOpenChange(false);
  }, [state, onOpenChange]);

  const v = state.values;
  const err = (k: string) => state.errors?.[k]?.[0];
  const errP = (k: string) =>
    err(k) ? (
      <p role="alert" className="text-2xs text-warn">
        {err(k)}
      </p>
    ) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{type ? "Edit request type" : "New request type"}</DialogTitle>
          <DialogDescription>
            The response period feeds the due date on each request; chase interval sets the rolling
            follow-up task.
          </DialogDescription>
        </DialogHeader>
        {/* Keyed so the uncontrolled defaults reset per row / open. */}
        <form
          key={`${type?.id ?? "new"}-${open}`}
          action={formAction}
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="rrt-name" className={labelClass}>
              Name <span className="text-warn">*</span>
            </label>
            <input
              id="rrt-name"
              name="name"
              required
              maxLength={80}
              defaultValue={v?.name ?? type?.name ?? ""}
              className={inputClass()}
            />
            {errP("name")}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="rrt-amount" className={labelClass}>
                Response period (days)
              </label>
              <input
                id="rrt-amount"
                name="responseAmount"
                inputMode="numeric"
                placeholder="none"
                defaultValue={v?.responseAmount ?? type?.responseAmount?.toString() ?? ""}
                className={inputClass()}
              />
              {errP("responseAmount")}
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="rrt-unit" className={labelClass}>
                Day type
              </label>
              <NativeSelect
                id="rrt-unit"
                name="responseUnit"
                defaultValue={v?.responseUnit ?? type?.responseUnit ?? ""}
                className="w-full"
              >
                <NativeSelectOption value="">—</NativeSelectOption>
                <NativeSelectOption value="CALENDAR_DAYS">Calendar days</NativeSelectOption>
                <NativeSelectOption value="BUSINESS_DAYS">Business days</NativeSelectOption>
              </NativeSelect>
              {errP("responseUnit")}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="rrt-follow" className={labelClass}>
              Chase every (days) <span className="text-warn">*</span>
            </label>
            <input
              id="rrt-follow"
              name="followUpDays"
              inputMode="numeric"
              required
              defaultValue={v?.followUpDays ?? type?.followUpDays?.toString() ?? "7"}
              className={inputClass()}
            />
            {errP("followUpDays")}
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="rrt-template" className={labelClass}>
              Default letter template
            </label>
            <NativeSelect
              id="rrt-template"
              name="defaultTemplateId"
              defaultValue={v?.defaultTemplateId ?? type?.defaultTemplateId ?? ""}
              className="w-full"
            >
              <NativeSelectOption value="">None</NativeSelectOption>
              {templates.map((t) => (
                <NativeSelectOption key={t.id} value={t.id}>
                  {t.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {errP("defaultTemplateId")}
          </div>
          {err("form") && (
            <p role="alert" className="text-2xs text-warn">
              {err("form")}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving…" : type ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
