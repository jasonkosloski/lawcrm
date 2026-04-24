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
import { useActionState } from "react";
import { cn } from "@/lib/utils";
import { updateMatter } from "@/app/actions/matters";
import {
  updateMatterInitialState,
  type UpdateMatterState,
} from "@/lib/new-matter-constants";

const AREAS = [
  "§1983",
  "Housing/FHA",
  "Employment/CADA",
  "Criminal",
  "Class",
  "ADA",
  "Education/IDEA",
] as const;

const STAGES = [
  "Intake",
  "Pre-suit",
  "Retained",
  "Discovery",
  "Dispositive",
  "Pretrial",
  "Cert",
  "Trial/Settle",
  "Settled",
  "Closed",
] as const;

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
  area: string;
  stage: string;
  feeStructure: string;
  court: string | null;
  clientId: string | null;
  opposingParty: string | null;
  opposingFirm: string | null;
  description: string | null;
  leadUserId: string | null;
};

export type EditMatterFormOptions = {
  clients: Array<{ id: string; name: string; organization: string | null }>;
  users: Array<{ id: string; name: string; role: string }>;
};

export function EditMatterForm({
  matter,
  options,
}: {
  matter: MatterForEdit;
  options: EditMatterFormOptions;
}) {
  // Bind matterId into the server action so the form's action prop
  // can stay `(prev, formData) => state`.
  const boundAction = updateMatter.bind(null, matter.id);
  const [state, formAction, isPending] = useActionState<
    UpdateMatterState,
    FormData
  >(boundAction, updateMatterInitialState);

  // On validation error, echo back the user's submitted values so
  // nothing typed gets lost. On first render, use the matter's
  // current values.
  const vals = state.values ?? {};
  const errs = state.errors ?? {};
  const init = {
    name: vals.name ?? matter.name,
    area: vals.area ?? matter.area,
    stage: vals.stage ?? matter.stage,
    feeStructure: vals.feeStructure ?? matter.feeStructure,
    caseNumber: vals.caseNumber ?? matter.caseNumber ?? "",
    court: vals.court ?? matter.court ?? "",
    clientId: vals.clientId ?? matter.clientId ?? "",
    opposingParty: vals.opposingParty ?? matter.opposingParty ?? "",
    opposingFirm: vals.opposingFirm ?? matter.opposingFirm ?? "",
    leadUserId:
      vals.leadUserId ?? matter.leadUserId ?? options.users[0]?.id ?? "",
    description: vals.description ?? matter.description ?? "",
  };

  return (
    <form action={formAction} className="flex flex-col gap-6">
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
          <Field label="Practice area" name="area" required error={errs.area}>
            <select
              id="area"
              name="area"
              defaultValue={init.area}
              required
              className={selectCls(!!errs.area)}
            >
              {AREAS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Stage" name="stage" error={errs.stage}>
            <select
              id="stage"
              name="stage"
              defaultValue={init.stage}
              className={selectCls(!!errs.stage)}
            >
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {s}
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
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Lead attorney"
            name="leadUserId"
            required
            error={errs.leadUserId}
          >
            <select
              id="leadUserId"
              name="leadUserId"
              defaultValue={init.leadUserId}
              required
              className={selectCls(!!errs.leadUserId)}
            >
              {options.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {u.role}
                </option>
              ))}
            </select>
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
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
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
