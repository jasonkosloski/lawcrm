/**
 * New records request composer. Collapsed to a dashed button; expands to
 * a form: custodian, type (or ad hoc), subject, description, date range
 * and owner. An ad hoc request names its own record type and takes a
 * manual response due date; a typed request derives the due date on send
 * from the type's statutory period.
 *
 * Dispatches from onSubmit so a server error keeps the typed input
 * (docs/UI_PATTERNS.md). Shown only when the viewer holds records.create.
 */

"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { createRecordsRequest } from "@/app/actions/records-requests";
import { useDialogActionState } from "@/hooks/use-dialog-action-state";
import {
  recordsRequestInitialState,
  type RecordsRequestFormState,
} from "@/lib/records-requests/form";
import type { RecordScope } from "@/lib/record-scope";
import { cn } from "@/lib/utils";
import { CustodianPicker } from "./custodian-picker";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { inputClass, textareaClass } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

export type TypeOption = { id: string; name: string };
export type UserOption = { id: string; name: string };

const ADHOC = "__adhoc";

const field = inputClass();
const label = "text-xs font-medium text-ink-2";

export function NewRequestComposer({
  scope,
  types,
  users,
  currentUserId,
  canCreateContact,
}: {
  scope: RecordScope;
  types: TypeOption[];
  users: UserOption[];
  currentUserId: string;
  canCreateContact: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [custodian, setCustodian] = useState<{ id: string; name: string } | null>(null);
  const [typeChoice, setTypeChoice] = useState(types[0]?.id ?? ADHOC);
  const [formKey, setFormKey] = useState(0);
  const [, startSubmit] = useTransition();

  const action = async (prev: RecordsRequestFormState, fd: FormData) => {
    const result = await createRecordsRequest(scope, prev, fd);
    if (result.status === "ok") {
      setExpanded(false);
      setCustodian(null);
      setTypeChoice(types[0]?.id ?? ADHOC);
      setFormKey((k) => k + 1);
    }
    return result;
  };
  const [state, formAction, isPending] = useDialogActionState<RecordsRequestFormState, FormData>(
    action,
    recordsRequestInitialState,
    expanded,
  );
  const errs = state.errors ?? {};
  const adHoc = typeChoice === ADHOC;

  if (!expanded) {
    return (
      <Button
        variant="outline"
        type="button"
        onClick={() => setExpanded(true)}
        className="flex gap-2 text-xs w-full border-dashed text-left"
      >
        <Plus size={13} />
        New records request
      </Button>
    );
  }

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startSubmit(() => formAction(fd));
  };

  return (
    <form
      key={formKey}
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded-md border border-line bg-white p-3"
    >
      <input type="hidden" name="typeId" value={adHoc ? "" : typeChoice} />

      <CustodianPicker
        value={custodian}
        onChange={setCustodian}
        canCreateContact={canCreateContact}
        error={errs.custodianContactId?.[0]}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="rr-type" className={label}>
            Type
          </label>
          <NativeSelect
            id="rr-type"
            value={typeChoice}
            onChange={(e) => setTypeChoice(e.target.value)}
            className="w-full"
          >
            {types.map((t) => (
              <NativeSelectOption key={t.id} value={t.id}>
                {t.name}
              </NativeSelectOption>
            ))}
            <NativeSelectOption value={ADHOC}>Ad hoc (other)</NativeSelectOption>
          </NativeSelect>
          {errs.typeId && <span className="text-2xs text-warn">{errs.typeId[0]}</span>}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="rr-owner" className={label}>
            Owner
          </label>
          <NativeSelect
            id="rr-owner"
            name="ownerId"
            defaultValue={currentUserId}
            className="w-full"
          >
            <NativeSelectOption value="">Unassigned</NativeSelectOption>
            {users.map((u) => (
              <NativeSelectOption key={u.id} value={u.id}>
                {u.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </div>

      {adHoc && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="rr-adhoc" className={label}>
              Type of records
            </label>
            <input
              id="rr-adhoc"
              name="adHocTypeName"
              type="text"
              maxLength={200}
              placeholder="e.g. Employment file"
              className={field}
            />
            {errs.adHocTypeName && (
              <span className="text-2xs text-warn">{errs.adHocTypeName[0]}</span>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="rr-due" className={label}>
              Response due date
            </label>
            <input id="rr-due" name="responseDueDate" type="date" className={field} />
            {errs.responseDueDate && (
              <span className="text-2xs text-warn">{errs.responseDueDate[0]}</span>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor="rr-subject" className={label}>
          Subject
        </label>
        <input
          id="rr-subject"
          name="subject"
          type="text"
          required
          maxLength={300}
          placeholder="What are you asking for?"
          className={field}
        />
        {errs.subject && <span className="text-2xs text-warn">{errs.subject[0]}</span>}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="rr-desc" className={label}>
          Details
        </label>
        <textarea
          id="rr-desc"
          name="description"
          rows={2}
          maxLength={4000}
          className={cn(textareaClass(), "px-2")}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="rr-from" className={label}>
            Records from
          </label>
          <input id="rr-from" name="dateRangeStart" type="date" className={field} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="rr-to" className={label}>
            Records through
          </label>
          <input id="rr-to" name="dateRangeEnd" type="date" className={field} />
          {errs.dateRangeEnd && <span className="text-2xs text-warn">{errs.dateRangeEnd[0]}</span>}
        </div>
      </div>

      {errs._form && <div className="text-2xs text-warn">{errs._form[0]}</div>}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="h-8 px-3 text-xs text-ink-3 hover:text-ink"
        >
          Cancel
        </button>
        <Button size="sm" type="submit" disabled={isPending}>
          {isPending ? "Creating…" : "Create request"}
        </Button>
      </div>
    </form>
  );
}
