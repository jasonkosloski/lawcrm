/**
 * "Log call" button + dialog for the Messages view.
 *
 * Manual call capture — pick the contact (typeahead over the firm's
 * contact directory), direction, outcome, when, optional duration /
 * matter / summary. Submits to the `logCall` server action, which
 * files the call into the contact's messenger thread so it renders
 * inline with SMS / voicemail traffic.
 *
 * The dialog itself (`CallLogDialog`) is exported standalone and
 * dual-mode:
 *   - create (default) — the flow above. `fixedContact` pre-selects
 *     the contact (lead / contact detail entry points), `fixedMatter`
 *     pins the filing (matter Communication tab).
 *   - edit (`edit` prop set) — prefilled from an existing manual call
 *     item, submits to `updateCallLog`. Contact + phone are fixed
 *     (they're the thread's identity); everything else is editable.
 *     Mounted by ManualCallActions' kebab menu.
 *
 * Same composer idioms as PartyComposer (typeahead) and
 * LogTimeOnEntityDialog (useActionState + auto-close on ok).
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { Phone, UserCheck, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  DateTimeField,
  SelectField,
  TextField,
  TextareaField,
} from "@/components/matters/captures/primary-fields";
import { cn } from "@/lib/utils";
import { useDialogActionState } from "@/hooks/use-dialog-action-state";
import { useUserTimeZone } from "@/components/user-time-zone";
import { parseWallClock, toWallClockInput } from "@/lib/format-date";
import { logCall, updateCallLog } from "@/app/actions/calls";
import {
  CALL_DIRECTIONS,
  CALL_DIRECTION_LABELS,
  CALL_OUTCOMES,
  CALL_OUTCOME_LABELS,
  callLogInitialState,
  durationSecToMinutesInput,
  type CallLogFormState,
  type EditableCallLog,
} from "@/lib/call-log-form";
import type { ContactPickerOption } from "@/lib/queries/contacts";
import { inputClass } from "@/components/ui/field";

export type CallMatterOption = { id: string; name: string };

/** Subset of ContactPickerOption the composer actually renders —
 *  lets entry points (lead detail) pre-select a contact without
 *  fetching the full picker row. */
export type CallContactOption = Pick<
  ContactPickerOption,
  "id" | "name" | "organization" | "phone"
>;

export function LogCallButton({
  contacts,
  matters = [],
  fixedMatter,
  fixedContact,
}: {
  contacts: ContactPickerOption[];
  /** Open-matter options for the filing select. Ignored when
   *  `fixedMatter` is set. */
  matters?: CallMatterOption[];
  /** Matter-context mode (matter-detail Communication tab): the call
   *  files to this matter, no picker shown. */
  fixedMatter?: CallMatterOption;
  /** Contact-context mode (lead detail): pre-select this contact —
   *  still clearable in favor of the typeahead. */
  fixedContact?: CallContactOption;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5 shrink-0"
        onClick={() => setOpen(true)}
        aria-label="Log call"
      >
        <Phone size={12} />
        <span className="hidden sm:inline">Log call</span>
      </Button>

      <CallLogDialog
        open={open}
        onOpenChange={setOpen}
        contacts={contacts}
        matters={matters}
        fixedMatter={fixedMatter}
        fixedContact={fixedContact}
      />
    </>
  );
}

/** Fresh working copy for one open session of the dialog. */
function initialFields(
  edit: EditableCallLog | undefined,
  fixedContact: CallContactOption | undefined,
  tz: string
) {
  return {
    selected: fixedContact ?? null,
    phone: fixedContact?.phone ?? "",
    direction: edit?.direction ?? CALL_DIRECTIONS[0],
    outcome: edit?.outcome ?? CALL_OUTCOMES[0],
    occurredAt: toWallClockInput(edit ? edit.occurredAt : new Date(), tz),
    durationMin: edit ? durationSecToMinutesInput(edit.durationSec) : "",
    matterId: edit?.matterId ?? "",
    summary: edit?.summary ?? "",
  };
}

export function CallLogDialog({
  open,
  onOpenChange,
  contacts = [],
  matters = [],
  fixedMatter,
  fixedContact,
  edit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contacts?: ContactPickerOption[];
  matters?: CallMatterOption[];
  fixedMatter?: CallMatterOption;
  fixedContact?: CallContactOption;
  /** Edit mode - prefill from this manual call item and submit to
   *  `updateCallLog` instead of `logCall`. */
  edit?: EditableCallLog;
}) {
  // The dialog stays MOUNTED across opens (LogCallButton and
  // ManualCallActions render it unconditionally), so the action
  // state outlives each open. useDialogActionState masks a previous
  // session's result and re-fires the close effect for every fresh
  // submission, keyed on the state OBJECT - a bare `state.status`
  // dependency stays "ok" forever after the first success, leaving
  // the dialog open on the second save and inviting a duplicate.
  //
  // Mode is fixed per mount (the kebab menu mounts an edit dialog,
  // the buttons mount create dialogs), so picking the action once
  // is safe.
  const [state, formAction, isPending] = useDialogActionState<
    CallLogFormState,
    FormData
  >(edit ? updateCallLog : logCall, callLogInitialState, open);

  useEffect(() => {
    if (state.status === "ok") onOpenChange(false);
  }, [state, onOpenChange]);

  // Each open gets a fresh form body (keyed remount): working copies
  // seed from the edited item / "now" via lazy initializers instead
  // of an effect, and a quick reopen during the close animation
  // can't resurrect the previous session's typed values.
  const [prevOpen, setPrevOpen] = useState(false);
  const [session, setSession] = useState(0);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setSession((n) => n + 1);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <CallLogFormBody
          key={session}
          state={state}
          formAction={formAction}
          isPending={isPending}
          onOpenChange={onOpenChange}
          contacts={contacts}
          matters={matters}
          fixedMatter={fixedMatter}
          fixedContact={fixedContact}
          edit={edit}
        />
      </DialogContent>
    </Dialog>
  );
}

function CallLogFormBody({
  state,
  formAction,
  isPending,
  onOpenChange,
  contacts,
  matters,
  fixedMatter,
  fixedContact,
  edit,
}: {
  state: CallLogFormState;
  formAction: (payload: FormData) => void;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  contacts: ContactPickerOption[];
  matters: CallMatterOption[];
  fixedMatter?: CallMatterOption;
  fixedContact?: CallContactOption;
  edit?: EditableCallLog;
}) {
  const tz = useUserTimeZone();
  const [init] = useState(() => initialFields(edit, fixedContact, tz));

  // Contact typeahead (create mode only)
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<CallContactOption | null>(
    init.selected
  );
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);

  // Call fields
  const [phone, setPhone] = useState(init.phone);
  const [direction, setDirection] = useState<string>(init.direction);
  const [outcome, setOutcome] = useState<string>(init.outcome);
  const [occurredAt, setOccurredAt] = useState(init.occurredAt);
  const [durationMin, setDurationMin] = useState(init.durationMin);
  const [matterId, setMatterId] = useState(init.matterId);
  const [summary, setSummary] = useState(init.summary);

  // The wall-clock the user sees, as the real instant it denotes in
  // their profile zone. Empty when the field is blank / invalid so
  // the server's "When did the call happen?" error surfaces.
  // Untouched in edit mode -> re-post the stored instant: the input is
  // minute-precision, so re-parsing it would silently drop the seconds.
  const occurredIso =
    edit && occurredAt === init.occurredAt
      ? edit.occurredAt.toISOString()
      : (parseWallClock(occurredAt, tz)?.toISOString() ?? "");

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return contacts
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.organization ?? "").toLowerCase().includes(q) ||
          (c.phone ?? "").replace(/\D/g, "").includes(q.replace(/\D/g, "") || " ")
      )
      .slice(0, 6);
  }, [query, contacts]);

  // Filing options - in edit mode, keep the item's current matter
  // selectable even when it's no longer in the open-matter list
  // (closed since), so opening + saving doesn't silently unfile.
  const matterOptions = useMemo(() => {
    const opts = [
      { value: "", label: "No matter (general)" },
      ...matters.map((m) => ({ value: m.id, label: m.name })),
    ];
    if (edit?.matterId && !matters.some((m) => m.id === edit.matterId)) {
      opts.splice(1, 0, {
        value: edit.matterId,
        label: edit.matterName ?? "Current matter",
      });
    }
    return opts;
  }, [matters, edit]);

  const errs = state.errors ?? {};
  const answered = outcome === "answered";

  return (
    <>
      <DialogHeader>
        <DialogTitle>{edit ? "Edit call log" : "Log a call"}</DialogTitle>
        <DialogDescription>
          {edit ? (
            <>
              Correct this logged call — outcome, timing, summary, or
              matter filing. The contact can&apos;t change; re-log the
              call if it was with someone else.
            </>
          ) : fixedMatter ? (
            <>
              Record a phone call that happened off-app — it files
              to <span className="text-ink-2">{fixedMatter.name}</span>.
            </>
          ) : (
            <>
              Record a phone call that happened off-app — it files
              into the contact&apos;s message thread.
            </>
          )}
        </DialogDescription>
      </DialogHeader>

      <form action={formAction} className="flex flex-col gap-3">
        {edit ? (
          <input type="hidden" name="itemId" value={edit.id} />
        ) : (
          <input type="hidden" name="contactId" value={selected?.id ?? ""} />
        )}
        {!edit && fixedMatter && (
          <input type="hidden" name="matterId" value={fixedMatter.id} />
        )}

        {/* Contact — fixed label chip in edit mode, typeahead
            otherwise (chip once picked). */}
        {edit ? (
          <div className="flex items-center gap-2 h-8 px-2.5 rounded-md border border-line bg-paper-2/50 text-xs text-ink-2">
            <UserCheck size={13} className="text-ink-3 shrink-0" />
            <span className="font-medium truncate flex-1">
              {edit.contactLabel}
            </span>
          </div>
        ) : selected ? (
          <div className="flex items-center gap-2 h-8 px-2.5 rounded-md border border-brand-200 bg-brand-soft/40 text-xs text-ink-2">
            <UserCheck size={13} className="text-brand-700 shrink-0" />
            <span className="font-medium truncate flex-1">
              {selected.name}
            </span>
            {selected.organization && (
              <span className="text-2xs font-mono text-ink-4 truncate">
                {selected.organization}
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                setSelected(null);
                setQuery("");
                setPhone("");
              }}
              aria-label="Clear selected contact"
              className="p-0.5 rounded text-ink-3 hover:text-ink-2"
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <div className="relative">
            <input
              type="text"
              autoComplete="off"
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSuggestionsOpen(e.target.value.trim().length > 0);
              }}
              onFocus={() => {
                if (query.trim().length > 0) setSuggestionsOpen(true);
              }}
              placeholder="Who was the call with? Type to search contacts"
              className={cn(inputClass(!!errs.contactId), "w-full")}
            />
            {errs.contactId && (
              <div className="text-2xs text-warn mt-0.5">
                {errs.contactId[0]}
              </div>
            )}
            {suggestionsOpen && suggestions.length > 0 && (
              <div
                role="listbox"
                className="absolute left-0 right-0 top-[calc(100%+2px)] z-20 rounded-md border border-line bg-white shadow-md py-1"
              >
                {suggestions.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setSelected(c);
                      setPhone(c.phone ?? "");
                      setSuggestionsOpen(false);
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left hover:bg-brand-tint"
                  >
                    <UserCheck size={12} className="text-ink-4 shrink-0" />
                    <span className="font-medium text-ink truncate">
                      {c.name}
                    </span>
                    <span className="text-2xs font-mono text-ink-4 truncate ml-auto">
                      {c.phone ?? "no phone"}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Phone belongs to the thread's identity — editable only
            when creating. */}
        {!edit && (
          <TextField
            name="phone"
            value={phone}
            onChange={setPhone}
            placeholder="Phone number"
            error={errs.phone?.[0]}
          />
        )}

        <div className="grid grid-cols-2 gap-2">
          <SelectField
            name="direction"
            value={direction}
            onChange={setDirection}
            options={CALL_DIRECTIONS.map((d) => ({
              value: d,
              label: CALL_DIRECTION_LABELS[d],
            }))}
          />
          <SelectField
            name="outcome"
            value={outcome}
            onChange={setOutcome}
            options={CALL_OUTCOMES.map((o) => ({
              value: o,
              label: CALL_OUTCOME_LABELS[o],
            }))}
          />
        </div>

        <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
          {/* The visible field is zone-less wall-clock text in the
              viewer's PROFILE zone; the server parses `occurredAt`,
              so post the real instant (ISO, explicit Z) from here
              rather than letting a zone-less string be read in the
              server's zone (UTC in production), which shifted the
              call by the UTC offset on every save. */}
          <input type="hidden" name="occurredAt" value={occurredIso} />
          <DateTimeField
            name="occurredAtLocal"
            value={occurredAt}
            onChange={setOccurredAt}
            label="When"
            error={errs.occurredAt?.[0]}
          />
          {answered && (
            <TextField
              name="durationMin"
              value={durationMin}
              onChange={setDurationMin}
              placeholder="Min"
              error={errs.durationMin?.[0]}
              className="w-20"
            />
          )}
        </div>

        {(edit || !fixedMatter) && (
          <SelectField
            name="matterId"
            value={matterId}
            onChange={setMatterId}
            options={matterOptions}
          />
        )}

        <TextareaField
          name="summary"
          value={summary}
          onChange={setSummary}
          placeholder="What was discussed? (optional)"
          rows={3}
          error={errs.summary?.[0]}
        />

        {/* Non-field failures (item vanished, provider-synced item
            slipped through) — surface verbatim. */}
        {errs.form && (
          <div className="text-2xs text-warn">{errs.form[0]}</div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={isPending || (!edit && !selected)}>
            {edit
              ? isPending
                ? "Saving…"
                : "Save changes"
              : isPending
                ? "Logging…"
                : "Log call"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
