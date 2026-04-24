/**
 * New Matter Form
 *
 * First-pass create form. Uses native form elements + a server action
 * so the submission flow is straightforward: FormData → Zod → create
 * row + team assignment → redirect to the matter detail.
 *
 * Error display is driven by `useActionState` — the server action
 * returns per-field errors on validation failure and the form
 * re-renders with the previous values preserved.
 */

"use client";

import Link from "next/link";
import { useActionState } from "react";
import { cn } from "@/lib/utils";
import {
  createMatter,
  createMatterInitialState,
  type CreateMatterState,
} from "@/app/actions/matters";

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

export type NewMatterFormOptions = {
  clients: Array<{ id: string; name: string; organization: string | null }>;
  users: Array<{ id: string; name: string; role: string; initials: string }>;
  currentUserId: string;
};

export function NewMatterForm({ options }: { options: NewMatterFormOptions }) {
  const [state, formAction, isPending] = useActionState<
    CreateMatterState,
    FormData
  >(createMatter, createMatterInitialState);

  const vals = state.values ?? {};
  const errs = state.errors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {/* ── Core ────────────────────────────────────────────────── */}
      <Section title="Core">
        <Field
          label="Matter name"
          name="name"
          required
          error={errs.name}
          hint="e.g. 'Alvarez v. City of Aurora et al.'"
        >
          <input
            id="name"
            name="name"
            type="text"
            defaultValue={vals.name ?? ""}
            required
            className={inputCls(!!errs.name)}
            placeholder="Alvarez v. City of Aurora et al."
          />
        </Field>

        <Row>
          <Field
            label="Practice area"
            name="area"
            required
            error={errs.area}
          >
            <select
              id="area"
              name="area"
              defaultValue={vals.area ?? ""}
              required
              className={selectCls(!!errs.area)}
            >
              <option value="" disabled>
                Select area…
              </option>
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
              defaultValue={vals.stage ?? "Intake"}
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
              defaultValue={vals.caseNumber ?? ""}
              className={inputCls(!!errs.caseNumber)}
              placeholder="2026-CV-00481"
            />
          </Field>

          <Field label="Fee structure" name="feeStructure" error={errs.feeStructure}>
            <select
              id="feeStructure"
              name="feeStructure"
              defaultValue={vals.feeStructure ?? "contingent"}
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

      {/* ── People ──────────────────────────────────────────────── */}
      <Section title="People">
        <Row>
          <Field
            label="Client"
            name="clientId"
            error={errs.clientId}
            hint="Pick an existing contact or leave blank to add later."
          >
            <select
              id="clientId"
              name="clientId"
              defaultValue={vals.clientId ?? ""}
              className={selectCls(!!errs.clientId)}
            >
              <option value="">— No client yet —</option>
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
              defaultValue={vals.leadUserId ?? options.currentUserId}
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
          <Field label="Opposing party" name="opposingParty" error={errs.opposingParty}>
            <input
              id="opposingParty"
              name="opposingParty"
              type="text"
              defaultValue={vals.opposingParty ?? ""}
              className={inputCls(!!errs.opposingParty)}
              placeholder="City of Aurora, Officer J. Doe"
            />
          </Field>

          <Field label="Opposing firm" name="opposingFirm" error={errs.opposingFirm}>
            <input
              id="opposingFirm"
              name="opposingFirm"
              type="text"
              defaultValue={vals.opposingFirm ?? ""}
              className={inputCls(!!errs.opposingFirm)}
              placeholder="Aurora City Attorney's Office"
            />
          </Field>
        </Row>
      </Section>

      {/* ── Court + description ─────────────────────────────────── */}
      <Section title="Details">
        <Field label="Court" name="court" error={errs.court}>
          <input
            id="court"
            name="court"
            type="text"
            defaultValue={vals.court ?? ""}
            className={inputCls(!!errs.court)}
            placeholder="D. Colorado · Hon. L. Martinez"
          />
        </Field>

        <Field label="Summary" name="description" error={errs.description}>
          <textarea
            id="description"
            name="description"
            defaultValue={vals.description ?? ""}
            rows={4}
            className={cn(
              inputCls(!!errs.description),
              "py-2 resize-y min-h-20 font-sans"
            )}
            placeholder="Brief case summary — what the claim is, what's at stake."
          />
        </Field>

        <label className="flex items-center gap-2 text-xs text-ink-2 cursor-pointer select-none">
          <input
            type="checkbox"
            name="pinForMe"
            defaultChecked={vals.pinForMe === "on"}
            className="w-3.5 h-3.5 rounded border-line"
          />
          Pin to my sidebar
        </label>
      </Section>

      {/* ── Submit ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
        <Link
          href="/matters"
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
          {isPending ? "Creating…" : "Create matter"}
        </button>
      </div>
    </form>
  );
}

// ── Layout helpers ─────────────────────────────────────────────────────

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
