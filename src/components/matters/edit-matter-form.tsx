/**
 * Edit Matter Form
 *
 * Simpler than NewMatterForm — skips the auto-name pattern, typeahead
 * client creation, and pin toggle (those apply to initial creation).
 * Pre-filled from the existing matter; submission hits the
 * `updateMatter` server action which writes the diff, syncs the lead
 * team assignment, and redirects back to the matter detail.
 */

"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { updateMatter } from "@/app/actions/matters";
import {
  computeSolDate,
  formatStatutePeriod,
  parseSolDateInput,
  solDayKey,
} from "@/lib/sol";
import {
  BILLING_MODES,
  BILLING_MODE_LABEL,
} from "@/lib/billing-mode-constants";
import {
  updateMatterInitialState,
  type UpdateMatterState,
} from "@/lib/new-matter-constants";

const FEE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "contingent", label: "Contingent" },
  { value: "hourly", label: "Hourly" },
  { value: "flat", label: "Flat fee" },
  { value: "hybrid", label: "Hybrid" },
  { value: "pro_bono", label: "Pro bono" },
];

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
  /** Total-days statute period; drives the auto-compute preview
   *  shown below the incident-date input. */
  statutePeriodDays: number | null;
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
    startTransition(() => formAction(fd));
  };

  // On validation error, echo back the user's submitted values so
  // nothing typed gets lost. On first render, use the matter's
  // current values.
  const vals = state.values ?? {};
  const errs = state.errors ?? {};
  const dateInputValue = (d: Date | null): string =>
    d ? d.toISOString().slice(0, 10) : "";
  // The stored SOL date is either auto-derived (it equals incident +
  // the stored area's period) or a manual override. Only a real
  // override is pre-filled into the "Deadline date" input; an
  // auto-derived date is shown as a live preview instead, so changing
  // the incident date or area recomputes it on save. (Mirrors the
  // server's rule in resolveEditedSolDate.)
  const storedArea = options.areas.find((a) => a.id === matter.practiceAreaId);
  const storedAuto = computeSolDate(
    matter.incidentDate,
    storedArea?.statutePeriodDays
  );
  const storedIsAuto =
    !matter.statuteOfLimitationsDate ||
    (!!storedAuto &&
      solDayKey(storedAuto) === solDayKey(matter.statuteOfLimitationsDate));
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
    ? parseSolDateInput(incidentDateInput)
    : null;
  const autoPreview = computeSolDate(
    parsedIncident,
    selectedArea?.statutePeriodDays
  );
  const previewLabel = autoPreview
    ? autoPreview.toLocaleDateString("en-US", {
        timeZone: "UTC",
        dateStyle: "medium",
      })
    : null;
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
            <select
              id="practiceAreaId"
              name="practiceAreaId"
              value={practiceAreaId}
              onChange={(e) => handleAreaChange(e.target.value)}
              required
              className={selectCls(!!errs.practiceAreaId)}
            >
              {options.areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Stage" name="stageId" error={errs.stageId}>
            <select
              id="stageId"
              name="stageId"
              value={stageId}
              onChange={(e) => setStageId(e.target.value)}
              className={selectCls(!!errs.stageId)}
            >
              {stageOptions.length === 0 && (
                <option value="" disabled>
                  No stages for this area
                </option>
              )}
              {stageOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
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
            <select
              id="feeStructure"
              name="feeStructure"
              defaultValue={init.feeStructure}
              className={selectCls(!!errs.feeStructure)}
            >
              {FEE_OPTIONS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </Field>
        </Row>

        <Row>
          <Field
            label="Billing mode"
            name="billingMode"
            error={errs.billingMode}
            hint="Which workflow the Billing tab uses. Inherited from the practice area on create; override per-matter when this case bills differently (e.g. a §1988-eligible contingency case switching to fee-petition mode)."
          >
            <select
              id="billingMode"
              name="billingMode"
              defaultValue={init.billingMode}
              className={selectCls(!!errs.billingMode)}
            >
              {BILLING_MODES.map((m) => (
                <option key={m} value={m}>
                  {BILLING_MODE_LABEL[m]}
                </option>
              ))}
            </select>
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
            <select
              id="clientId"
              name="clientId"
              defaultValue={init.clientId}
              className={selectCls(!!errs.clientId)}
            >
              <option value="">— No client —</option>
              {options.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.organization ? ` · ${c.organization}` : ""}
                  {c.inactive ? " (inactive)" : ""}
                </option>
              ))}
            </select>
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
            <select
              id="leadUserId"
              name={canChangeLead ? "leadUserId" : undefined}
              defaultValue={init.leadUserId}
              required={canChangeLead}
              disabled={!canChangeLead}
              className={selectCls(!!errs.leadUserId)}
            >
              {init.leadUserId === "" && (
                <option value="">Choose a lead…</option>
              )}
              {options.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {u.jobTitle}
                  {u.inactive ? " (inactive)" : ""}
                </option>
              ))}
            </select>
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
                selectedArea.statutePeriodDays
                  ? `Period: ${formatStatutePeriod(selectedArea.statutePeriodDays)}${selectedArea.statuteSourceCitation ? ` · ${selectedArea.statuteSourceCitation}` : ""}. Leave Deadline date blank to auto-compute.`
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
    </form>
  );
}

// ── Layout helpers (shared shape with NewMatterForm) ───────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-2xs font-mono uppercase tracking-wider text-ink-4">
        {title}
      </h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>;
}

function Field({
  label,
  name,
  required,
  error,
  hint,
  children,
}: {
  label: string;
  name: string;
  required?: boolean;
  error?: string[];
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={name} className="text-xs font-medium text-ink-2">
        {label}
        {required && <span className="text-warn ml-0.5">*</span>}
      </label>
      {children}
      {error && error.length > 0 && (
        <div className="text-2xs text-warn">{error[0]}</div>
      )}
      {hint && !error?.length && (
        <div className="text-2xs text-ink-4">{hint}</div>
      )}
    </div>
  );
}

const inputCls = (hasError: boolean): string =>
  cn(
    "h-8 px-2.5 rounded-md border bg-white text-xs text-ink",
    "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
    "placeholder:text-ink-4",
    hasError ? "border-warn" : "border-line"
  );

const selectCls = (hasError: boolean): string =>
  cn(
    "h-8 px-2 rounded-md border bg-white text-xs text-ink",
    "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
    hasError ? "border-warn" : "border-line"
  );
