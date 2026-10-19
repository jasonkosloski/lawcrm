/**
 * New intake form — /intake/new.
 *
 * Person: type a name to search existing contacts; picking one links
 * the lead to that record (repeat callers stay one person). Otherwise
 * a new contact is created from name / email / phone — and if the
 * typed email already belongs to a contact, the form says so up front
 * (the server links to it, matching `createLead`).
 *
 * The rest is the inquiry: source, incident, summary. A conflict
 * check runs on save; the lead page shows the result.
 */

"use client";

import { useActionState, useMemo, useState } from "react";
import { Link2, TriangleAlert, UserRound, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { createLead } from "@/app/actions/leads";
import {
  newIntakeInitialState,
  type IntakeContactOption,
  type NewIntakeFormState,
} from "@/lib/new-intake-form";
import { LEAD_SOURCES, LEAD_SOURCE_LABEL } from "@/lib/constants/lead-stage";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

const MAX_SUGGESTIONS = 6;
const labelCls = "text-2xs font-mono uppercase tracking-wider text-ink-4";
const inputCls = (err?: boolean) =>
  cn(
    "h-9 px-3 rounded-md border bg-white text-xs text-ink placeholder:text-ink-4",
    "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
    err ? "border-warn" : "border-line"
  );

export function NewIntakeForm({ contacts }: { contacts: IntakeContactOption[] }) {
  const [state, formAction, isPending] = useActionState<NewIntakeFormState, FormData>(
    createLead,
    newIntakeInitialState
  );
  const v = state.values ?? {};
  const errs = state.errors ?? {};

  const [name, setName] = useState(v.name ?? "");
  const [email, setEmail] = useState(v.email ?? "");
  const [linked, setLinked] = useState<IntakeContactOption | null>(
    () => contacts.find((c) => c.id === v.contactId) ?? null
  );
  const [showSuggestions, setShowSuggestions] = useState(false);

  const suggestions = useMemo(() => {
    const q = name.trim().toLowerCase();
    if (linked || q.length < 2) return [];
    return contacts
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.email?.toLowerCase().includes(q) ?? false)
      )
      .slice(0, MAX_SUGGESTIONS);
  }, [name, contacts, linked]);

  // Mirrors the server's email match so the link is never a surprise.
  const emailMatch = useMemo(() => {
    const e = email.trim().toLowerCase();
    if (linked || !e) return null;
    return contacts.find((c) => c.email?.toLowerCase() === e) ?? null;
  }, [email, contacts, linked]);

  const link = (c: IntakeContactOption) => {
    setLinked(c);
    setName(c.name);
    setShowSuggestions(false);
  };
  const unlink = () => {
    setLinked(null);
    setName("");
  };

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="contactId" value={linked?.id ?? ""} />

      {/* ── Person ─────────────────────────────────────────── */}
      <Section title="Person">
        {linked ? (
          <div className="flex items-start gap-3 p-3 rounded-md border border-brand-200 bg-brand-soft">
            <Link2 size={14} className="text-brand-700 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0 text-xs">
              <div className="font-medium text-ink">{linked.name}</div>
              <div className="text-ink-3">
                Existing contact
                {[linked.email, linked.phone].filter(Boolean).length > 0 &&
                  ` · ${[linked.email, linked.phone].filter(Boolean).join(" · ")}`}
              </div>
            </div>
            <button
              type="button"
              onClick={unlink}
              className="inline-flex items-center gap-1 text-2xs text-brand-700 hover:underline shrink-0"
            >
              <X size={11} /> Not this person
            </button>
          </div>
        ) : (
          <>
            {/* Not a <Field>: a <label> wrapping the suggestion buttons
                would fold them into the input's accessible name. */}
            <div className="flex flex-col gap-1">
              <label htmlFor="intake-name" className={labelCls}>
                Name<span className="text-warn ml-1">*</span>
              </label>
              <div className="relative">
                <input
                  id="intake-name"
                  name="name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setShowSuggestions(true);
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  autoComplete="off"
                  maxLength={200}
                  placeholder="Start typing to find an existing contact"
                  className={cn(inputCls(!!errs.name), "w-full")}
                />
                {showSuggestions && suggestions.length > 0 && (
                  <ul
                    aria-label="Existing contacts"
                    className="absolute z-10 mt-1 w-full rounded-md border border-line bg-white shadow-md max-h-64 overflow-y-auto"
                  >
                    {suggestions.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => link(c)}
                          className="w-full text-left px-3 py-2 hover:bg-paper-2 flex items-center gap-2"
                        >
                          <UserRound size={13} className="text-ink-4 shrink-0" />
                          <span className="text-xs text-ink truncate">{c.name}</span>
                          <span className="text-2xs text-ink-4 truncate">
                            {[c.email, c.phone].filter(Boolean).join(" · ")}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {errs.name?.[0] && <span className="text-2xs text-warn">{errs.name[0]}</span>}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Email" error={errs.email?.[0]}>
                <input
                  name="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  maxLength={200}
                  className={inputCls(!!errs.email)}
                />
              </Field>
              <Field label="Phone" error={errs.phone?.[0]}>
                <input name="phone" type="tel" defaultValue={v.phone ?? ""} maxLength={40} placeholder="(555) 555-5555" className={inputCls(!!errs.phone)} />
              </Field>
            </div>
            {emailMatch && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-paper-2 border border-line text-2xs text-ink-3">
                <Link2 size={12} className="shrink-0 mt-px" />
                <span>
                  That email belongs to <strong className="text-ink">{emailMatch.name}</strong>
                  {" "}— this intake will be linked to that contact.{" "}
                  <button type="button" onClick={() => link(emailMatch)} className="text-brand-700 hover:underline">
                    Use their record
                  </button>
                </span>
              </div>
            )}
          </>
        )}
      </Section>

      {/* ── Inquiry ────────────────────────────────────────── */}
      <Section title="Inquiry">
        <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-3">
          <Field label="Source" error={errs.source?.[0]}>
            <NativeSelect name="source" defaultValue={v.source ?? "phone"} className="w-full" aria-invalid={!!errs.source || undefined}>
              <NativeSelectOption value="">Unknown</NativeSelectOption>
              {LEAD_SOURCES.map((s) => (
                <NativeSelectOption key={s} value={s}>{LEAD_SOURCE_LABEL[s] ?? s}</NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Source detail" error={errs.sourceDetail?.[0]}>
            <input name="sourceDetail" defaultValue={v.sourceDetail ?? ""} maxLength={200} placeholder="e.g. referred by …" className={inputCls(!!errs.sourceDetail)} />
          </Field>
        </div>
        <Field label="What happened" error={errs.summary?.[0]}>
          <textarea name="summary" defaultValue={v.summary ?? ""} rows={4} maxLength={4000} className={cn(inputCls(!!errs.summary), "h-auto py-2 leading-relaxed")} />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-3">
          <Field label="Date of incident" error={errs.dateOfIncident?.[0]}>
            <input name="dateOfIncident" type="date" defaultValue={v.dateOfIncident ?? ""} className={inputCls(!!errs.dateOfIncident)} />
          </Field>
          <Field label="Location" error={errs.location?.[0]}>
            <input name="location" defaultValue={v.location ?? ""} maxLength={200} className={inputCls(!!errs.location)} />
          </Field>
        </div>
        <Field label="Injuries / harm" error={errs.injuries?.[0]}>
          <input name="injuries" defaultValue={v.injuries ?? ""} maxLength={2000} className={inputCls(!!errs.injuries)} />
        </Field>
        <label className="flex items-center gap-2 text-xs text-ink-2">
          <input type="checkbox" name="priorCounsel" defaultChecked={v.priorCounsel === "on"} />
          Has spoken with or retained another attorney about this
        </label>
      </Section>

      {errs._form?.[0] && (
        <div className="flex items-center gap-2 text-xs text-warn">
          <TriangleAlert size={13} /> {errs._form[0]}
        </div>
      )}

      <div className="flex items-center gap-3 pt-2 border-t border-line">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center h-9 px-4 rounded-md text-sm font-medium bg-brand-500 text-white hover:bg-brand-600 transition-colors disabled:opacity-60"
        >
          {isPending ? "Saving…" : "Save intake"}
        </button>
        <span className="text-2xs text-ink-4">A conflict check runs automatically when you save.</span>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-3">{title}</h2>
      {children}
    </section>
  );
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className={labelCls}>
        {label}
        {required && <span className="text-warn ml-1">*</span>}
      </span>
      {children}
      {error && <span className="text-2xs text-warn">{error}</span>}
    </label>
  );
}
