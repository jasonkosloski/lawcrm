/**
 * Edit Matter Form
 *
 * Simpler than NewMatterForm — skips the auto-name pattern, typeahead
 * client creation, and pin toggle (those apply to initial creation).
 * Pre-filled from the existing matter; submission hits the
 * `updateMatter` server action which writes the diff, syncs the lead
 * team assignment, and redirects back to the matter detail.
 *
 * SOL: an auto-derived deadline is shown as a live "Auto-computed"
 * hint under the Deadline date field (which stays empty so the server
 * recomputes); a real manual override is pre-filled.
 */

"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { updateMatter } from "@/app/actions/matters";
import { CascadeConfirm } from "@/components/automations/cascade-confirm";
import {
  computeSolDate,
  formatStatutePeriod,
  type SolPeriod,
} from "@/lib/sol";
import {
  dateOnlyKey,
  formatDateOnly,
  parseDateOnly,
} from "@/lib/format-date";
import { FEE_OPTIONS } from "@/lib/fee-structure-constants";
import {
  BILLING_MODES,
  BILLING_MODE_LABEL,
} from "@/lib/billing-mode-constants";
import {
  updateMatterInitialState,
  type UpdateMatterState,
} from "@/lib/new-matter-constants";
import {
  Field,
  Row,
  Section,
  inputCls,
} from "./form-primitives";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

export type MatterForEdit = {
  id: string;
  name: string;
  caseNumber: string | null;
  practiceAreaId: string;
  stageId: string;
  feeStructure: string;
  billingMode: string;
  court: string | null;
  clientId: string | null;
  opposingParty: string | null;
  opposingFirm: string | null;
  description: string | null;
  leadUserId: string | null;
  incidentDate: Date | null;
  statuteOfLimitationsDate: Date | null;
  statuteOfLimitationsNotes: string | null;
};

export type EditAreaOption = {
  id: string;
  name: string;
  hasStatuteOfLimitations: boolean;
  /** Total-days statute period; drives the auto-computed hint shown
   *  under the Deadline date input. */
  statutePeriod: SolPeriod | null;
  statuteSourceCitation: string | null;
  stages: Array<{
    id: string;
    name: string;
    order: number;
    isTerminal: boolean;
  }>;
};

export type EditMatterFormOptions = {
  areas: EditAreaOption[];
  /** `inactive` marks the matter's current client when that contact
   *  has since been deactivated — kept in the list so a save never
   *  detaches them. */
  clients: Array<{
    id: string;
    name: string;
    organization: string | null;
    inactive?: boolean;
  }>;
  /** Lead picker: active users plus the matter's current lead even when
   *  deactivated (`inactive`). */
  users: Array<{
    id: string;
    name: string;
    jobTitle: string;
    inactive?: boolean;
  }>;
};

export function EditMatterForm({
  matter,
  options,
  canChangeLead = false,
}: {
  matter: MatterForEdit;
  options: EditMatterFormOptions;
  /** Changing the lead attorney is a team change (matters.manage_team,
   *  enforced by `updateMatter`). Without it the field is locked and
   *  the current lead is posted back unchanged. */
  canChangeLead?: boolean;
}) {
  // Bind matterId into the server action so the form's action prop
  // can stay `(prev, formData) => state`.
  const boundAction = updateMatter.bind(null, matter.id);
  const [state, formAction, isPending] = useActionState<
    UpdateMatterState,
    FormData
  >(boundAction, updateMatterInitialState);
  // Submit through onSubmit + startTransition instead of
  // `<form action={formAction}>`: React 19 resets the form after any
  // function action, which would revert every <select> to its mount
  // value after a validation error — so the corrected resubmit would
  // save the wrong area / stage / fee / client / lead. Without an
  // `action` prop there is no automatic reset and the user's picks stay.
  const [, startTransition] = useTransition();
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as
      | HTMLElement
      | null;
    const fd = new FormData(e.currentTarget, submitter);
    setSubmittedIncident(incidentDateInput);
    startTransition(() => formAction(fd));
  };
  // "Other deadlines will change" (ADR-040): shown for the incident
  // date it was computed for; editing the date again, or Go back,
  // dismisses the stale list (the next Save asks afresh).
  const [submittedIncident, setSubmittedIncident] = useState<string | null>(null);
  const [dismissedConfirm, setDismissedConfirm] = useState<UpdateMatterState | null>(null);

  // On validation error, echo back the user's submitted values so
  // nothing typed gets lost. On first render, use the matter's
  // current values.
  const vals = state.values ?? {};
  const errs = state.errors ?? {};
  const dateInputValue = (d: Date | null): string =>
    d ? dateOnlyKey(d) : "";
  // The stored SOL date is either auto-derived (it equals incident +
  // the stored area's period) or a manual override. Only a real
  // override is pre-filled into the "Deadline date" input; an
  // auto-derived date is shown as a live preview instead, so changing
  // the incident date or area recomputes it on save. (Mirrors the
  // server's rule in resolveEditedSolDate.)
  const storedArea = options.areas.find((a) => a.id === matter.practiceAreaId);
  const storedAuto = computeSolDate(
    matter.incidentDate,
    storedArea?.statutePeriod
  );
  const storedIsAuto =
    !matter.statuteOfLimitationsDate ||
    (!!storedAuto &&
      dateOnlyKey(storedAuto) === dateOnlyKey(matter.statuteOfLimitationsDate));
  const storedOverrideValue = storedIsAuto
    ? ""
    : dateInputValue(matter.statuteOfLimitationsDate);
  const init = {
    name: vals.name ?? matter.name,
    feeStructure: vals.feeStructure ?? matter.feeStructure,
    billingMode: vals.billingMode ?? matter.billingMode,
    caseNumber: vals.caseNumber ?? matter.caseNumber ?? "",
    court: vals.court ?? matter.court ?? "",
    clientId: vals.clientId ?? matter.clientId ?? "",
    opposingParty: vals.opposingParty ?? matter.opposingParty ?? "",
    opposingFirm: vals.opposingFirm ?? matter.opposingFirm ?? "",
    // No fallback to the first user: a matter with no (or a missing)
    // lead shows the placeholder and posts nothing rather than
    // silently picking someone.
    leadUserId: vals.leadUserId ?? matter.leadUserId ?? "",
    description: vals.description ?? matter.description ?? "",
    incidentDate:
      vals.incidentDate ?? dateInputValue(matter.incidentDate),
    statuteOfLimitationsDate:
      vals.statuteOfLimitationsDate ?? storedOverrideValue,
    statuteOfLimitationsNotes:
      vals.statuteOfLimitationsNotes ??
      matter.statuteOfLimitationsNotes ??
      "",
  };

  // ── Practice area + stage (cascading) ────────────────────────────────
  const initialAreaId = vals.practiceAreaId ?? matter.practiceAreaId;
  const initialArea = options.areas.find((a) => a.id === initialAreaId);
  const initialStageId =
    vals.stageId ??
    (initialArea?.stages.some((s) => s.id === matter.stageId)
      ? matter.stageId
      : initialArea?.stages[0]?.id ?? "");

  const [practiceAreaId, setPracticeAreaId] = useState<string>(initialAreaId);
  const [stageId, setStageId] = useState<string>(initialStageId);

  // Lead and client are controlled so a change made elsewhere on the page
  // (the Team card promotes a new lead; the matter is re-linked) shows up
  // here. An uncontrolled select keeps its mount-time DOM value, so the
  // next Save would post the stale lead and silently undo the team change.
  // "Reset when a prop changes": remember the prop, adopt the new value
  // during render when it differs.
  const [leadUserId, setLeadUserId] = useState<string>(init.leadUserId);
  const [seenLeadProp, setSeenLeadProp] = useState(matter.leadUserId);
  if (seenLeadProp !== matter.leadUserId) {
    setSeenLeadProp(matter.leadUserId);
    setLeadUserId(matter.leadUserId ?? "");
  }
  const [clientId, setClientId] = useState<string>(init.clientId);
  const [seenClientProp, setSeenClientProp] = useState(matter.clientId);
  if (seenClientProp !== matter.clientId) {
    setSeenClientProp(matter.clientId);
    setClientId(matter.clientId ?? "");
  }

  const [incidentDateInput, setIncidentDateInput] = useState<string>(
    init.incidentDate
  );
  const [solOverride, setSolOverride] = useState<string>(
    init.statuteOfLimitationsDate
  );

  const selectedArea = options.areas.find((a) => a.id === practiceAreaId);
  // Live "what auto-compute will produce" from the incident input and
  // the currently selected area.
  const parsedIncident = incidentDateInput
    ? parseDateOnly(incidentDateInput)
    : null;
  const autoPreview = computeSolDate(
    parsedIncident,
    selectedArea?.statutePeriod
  );
  const previewLabel = autoPreview ? formatDateOnly(autoPreview) : null;
  const stageOptions = selectedArea?.stages ?? [];

  const handleAreaChange = (nextAreaId: string) => {
    setPracticeAreaId(nextAreaId);
    const nextArea = options.areas.find((a) => a.id === nextAreaId);
    const stageBelongs = nextArea?.stages.some((s) => s.id === stageId);
    if (!stageBelongs) setStageId(nextArea?.stages[0]?.id ?? "");
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <Section title="Core">
        <Field label="Matter name" name="name" required error={errs.name}>
          <input
            id="name"
            name="name"
            type="text"
            defaultValue={init.name}
            required
            className={inputCls(!!errs.name)}
          />
        </Field>

        <Row>
          <Field
            label="Practice area"
            name="practiceAreaId"
            required
            error={errs.practiceAreaId}
          >
            <NativeSelect
              className="w-full"
              id="practiceAreaId"
              name="practiceAreaId"
              value={practiceAreaId}
              onChange={(e) => handleAreaChange(e.target.value)}
              required
              aria-invalid={!!errs.practiceAreaId || undefined}
            >
              {options.areas.map((a) => (
                <NativeSelectOption key={a.id} value={a.id}>
                  {a.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>

          <Field label="Stage" name="stageId" error={errs.stageId}>
            <NativeSelect
              className="w-full"
              id="stageId"
              name="stageId"
              value={stageId}
              onChange={(e) => setStageId(e.target.value)}
              aria-invalid={!!errs.stageId || undefined}
            >
              {stageOptions.length === 0 && (
                <NativeSelectOption value="" disabled>
                  No stages for this area
                </NativeSelectOption>
              )}
              {stageOptions.map((s) => (
                <NativeSelectOption key={s.id} value={s.id}>
                  {s.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        </Row>

        <Row>
          <Field label="Case number" name="caseNumber" error={errs.caseNumber}>
            <input
              id="caseNumber"
              name="caseNumber"
              type="text"
              defaultValue={init.caseNumber}
              className={inputCls(!!errs.caseNumber)}
              placeholder="2026-CV-00481"
            />
          </Field>

          <Field
            label="Fee structure"
            name="feeStructure"
            error={errs.feeStructure}
          >
            <NativeSelect
              className="w-full"
              id="feeStructure"
              name="feeStructure"
              defaultValue={init.feeStructure}
              aria-invalid={!!errs.feeStructure || undefined}
            >
              {FEE_OPTIONS.map((f) => (
                <NativeSelectOption key={f.value} value={f.value}>
                  {f.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        </Row>

        <Row>
          <Field
            label="Billing mode"
            name="billingMode"
            error={errs.billingMode}
            hint="Which workflow the Billing tab uses. Inherited from the practice area on create; override per-matter when this case bills differently (e.g. a §1988-eligible contingency case switching to fee-petition mode)."
          >
            <NativeSelect
              className="w-full"
              id="billingMode"
              name="billingMode"
              defaultValue={init.billingMode}
              aria-invalid={!!errs.billingMode || undefined}
            >
              {BILLING_MODES.map((m) => (
                <NativeSelectOption key={m} value={m}>
                  {BILLING_MODE_LABEL[m]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        </Row>
      </Section>

      <Section title="People">
        <Row>
          <Field
            label="Client"
            name="clientId"
            error={errs.clientId}
            hint="Swap to a different existing contact, or clear to detach."
          >
            <NativeSelect
              className="w-full"
              id="clientId"
              name="clientId"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              aria-invalid={!!errs.clientId || undefined}
            >
              <NativeSelectOption value="">— No client —</NativeSelectOption>
              {options.clients.map((c) => (
                <NativeSelectOption key={c.id} value={c.id}>
                  {c.name}
                  {c.organization ? ` · ${c.organization}` : ""}
                  {c.inactive ? " (inactive)" : ""}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>

          <Field
            label="Lead attorney"
            name="leadUserId"
            required={canChangeLead}
            error={errs.leadUserId}
            hint={
              canChangeLead
                ? undefined
                : "Changing the lead attorney requires permission to manage the case team."
            }
          >
            <NativeSelect
              className="w-full"
              id="leadUserId"
              name={canChangeLead ? "leadUserId" : undefined}
              value={leadUserId}
              onChange={(e) => setLeadUserId(e.target.value)}
              required={canChangeLead}
              disabled={!canChangeLead}
              aria-invalid={!!errs.leadUserId || undefined}
            >
              {leadUserId === "" && (
                <NativeSelectOption value="">Choose a lead…</NativeSelectOption>
              )}
              {options.users.map((u) => (
                <NativeSelectOption key={u.id} value={u.id}>
                  {u.name} · {u.jobTitle}
                  {u.inactive ? " (inactive)" : ""}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {/* A disabled select isn't submitted — post the current
                lead back so the save leaves it unchanged. */}
            {!canChangeLead && (
              <input
                type="hidden"
                name="leadUserId"
                value={matter.leadUserId ?? ""}
              />
            )}
          </Field>
        </Row>

        <Row>
          <Field
            label="Opposing party"
            name="opposingParty"
            error={errs.opposingParty}
          >
            <input
              id="opposingParty"
              name="opposingParty"
              type="text"
              defaultValue={init.opposingParty}
              className={inputCls(!!errs.opposingParty)}
            />
          </Field>

          <Field
            label="Opposing firm"
            name="opposingFirm"
            error={errs.opposingFirm}
          >
            <input
              id="opposingFirm"
              name="opposingFirm"
              type="text"
              defaultValue={init.opposingFirm}
              className={inputCls(!!errs.opposingFirm)}
            />
          </Field>
        </Row>
      </Section>

      <Section title="Details">
        <Field label="Court" name="court" error={errs.court}>
          <input
            id="court"
            name="court"
            type="text"
            defaultValue={init.court}
            className={inputCls(!!errs.court)}
            placeholder="D. Colorado · Hon. L. Martinez"
          />
        </Field>

        <Field label="Summary" name="description" error={errs.description}>
          <textarea
            id="description"
            name="description"
            defaultValue={init.description}
            rows={5}
            className={cn(
              inputCls(!!errs.description),
              "py-2 resize-y min-h-24 font-sans"
            )}
          />
        </Field>
      </Section>

      {/* Statute of limitations — only when the chosen practice area
          tracks SOL. The satisfied flag lives on the Overview card,
          not here — edits to the deadline happen in one place, the
          satisfied toggle in another.
          When the area has a configured statute period and you set
          incidentDate without an explicit Deadline date, the action
          auto-computes the SOL from incident + period. The hint
          line spells out what that period will be. */}
      {selectedArea?.hasStatuteOfLimitations && (
        <Section title="Statute of limitations">
          <Row>
            <Field
              label="Incident / accrual date"
              name="incidentDate"
              error={errs.incidentDate}
              hint={
                selectedArea.statutePeriod
                  ? `Period: ${formatStatutePeriod(selectedArea.statutePeriod)}${selectedArea.statuteSourceCitation ? ` · ${selectedArea.statuteSourceCitation}` : ""}. Leave Deadline date blank to auto-compute.`
                  : "When known, drives the SOL deadline once the firm configures a statute period for this area."
              }
            >
              <input
                id="incidentDate"
                name="incidentDate"
                type="date"
                value={incidentDateInput}
                onChange={(e) => setIncidentDateInput(e.target.value)}
                className={inputCls(!!errs.incidentDate)}
              />
            </Field>
            <Field
              label="Deadline date"
              name="statuteOfLimitationsDate"
              error={errs.statuteOfLimitationsDate}
              hint={
                solOverride
                  ? "Manual override — kept as typed; it won't follow the incident date or area."
                  : previewLabel
                    ? `Auto-computed: ${previewLabel}. Leave blank to keep following the incident date.`
                    : "Leave blank to auto-compute once an incident date and statute period are set."
              }
            >
              <input
                id="statuteOfLimitationsDate"
                name="statuteOfLimitationsDate"
                type="date"
                value={solOverride}
                onChange={(e) => setSolOverride(e.target.value)}
                className={inputCls(!!errs.statuteOfLimitationsDate)}
              />
              {solOverride && (
                <div className="flex items-center gap-2 text-2xs text-ink-3">
                  {previewLabel && <span>Auto value would be {previewLabel}.</span>}
                  <button
                    type="button"
                    onClick={() => setSolOverride("")}
                    className="underline hover:text-brand-700"
                  >
                    Reset to computed
                  </button>
                </div>
              )}
            </Field>
          </Row>
          <Row>
            <Field
              label="Notes"
              name="statuteOfLimitationsNotes"
              error={errs.statuteOfLimitationsNotes}
              hint="Tolling agreement, notice waiver, jurisdictional quirks…"
            >
              <input
                id="statuteOfLimitationsNotes"
                name="statuteOfLimitationsNotes"
                type="text"
                defaultValue={init.statuteOfLimitationsNotes}
                className={inputCls(!!errs.statuteOfLimitationsNotes)}
              />
            </Field>
          </Row>
        </Section>
      )}

      {!selectedArea?.hasStatuteOfLimitations &&
        (matter.statuteOfLimitationsDate || matter.incidentDate) && (
          <p className="text-2xs text-ink-3">
            This practice area doesn&apos;t track statute of limitations. The
            matter&apos;s incident date, SOL date, notes and SOL deadline are
            kept as they are.
          </p>
        )}

      {state.status === "confirm" &&
      state !== dismissedConfirm &&
      submittedIncident === incidentDateInput &&
      (state.cascade?.length ?? 0) > 0 ? (
        <CascadeConfirm
          key={JSON.stringify(state.cascade?.map((c) => c.deadlineId))}
          changes={state.cascade ?? []}
          changedLabel="the incident date"
          isPending={isPending}
          onCancel={() => setDismissedConfirm(state)}
        />
      ) : (
      <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
        <Link
          href={`/matters/${matter.id}`}
          className="inline-flex items-center h-8 px-3 rounded-md text-xs font-medium text-ink-2 border border-line bg-white hover:border-brand-300 hover:text-brand-700 transition-colors"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={isPending}
          className={cn(
            "inline-flex items-center h-8 px-3 rounded-md text-xs font-medium bg-brand-500 text-white",
            "hover:bg-brand-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          )}
        >
          {isPending ? "Saving…" : "Save changes"}
        </button>
      </div>
      )}
    </form>
  );
}
