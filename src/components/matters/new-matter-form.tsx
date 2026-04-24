/**
 * New Matter Form
 *
 * Create-matter flow. Default stance is "you're creating a new client"
 * — name / email / phone / organization fields are visible from the
 * start. As the user types the client name, a typeahead suggests
 * matching existing Contacts; clicking a suggestion links to that
 * existing row instead of creating a new one.
 *
 * Uses native form elements + a server action so the submission path
 * is straightforward: FormData → Zod → create Contact (if new) +
 * Matter + team assignment (+ optional pin) → redirect to detail.
 * Errors come back via `useActionState` and re-render the form with
 * previous values preserved.
 */

"use client";

import Link from "next/link";
import {
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { UserCheck, UserPlus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { createMatter } from "@/app/actions/matters";
import {
  createMatterInitialState,
  NEW_CLIENT_SENTINEL,
  type CreateMatterState,
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

type ClientOption = {
  id: string;
  name: string;
  organization: string | null;
};

export type NewMatterFormOptions = {
  clients: ClientOption[];
  users: Array<{ id: string; name: string; role: string; initials: string }>;
  currentUserId: string;
};

const MAX_SUGGESTIONS = 6;

export function NewMatterForm({ options }: { options: NewMatterFormOptions }) {
  const [state, formAction, isPending] = useActionState<
    CreateMatterState,
    FormData
  >(createMatter, createMatterInitialState);

  const vals = state.values ?? {};
  const errs = state.errors ?? {};

  // ── Client picker state ──────────────────────────────────────────────
  // Default mode is "new client" — the sub-fields are visible from the
  // start. If the user clicks a suggestion while typing, we switch to
  // "existing" mode (clientId = selected contact id). Clearing sends
  // them back to "new" with the typed name preserved.
  const initialSelectedId =
    vals.clientId && vals.clientId !== NEW_CLIENT_SENTINEL
      ? vals.clientId
      : null;
  const initialClientName = initialSelectedId
    ? (options.clients.find((c) => c.id === initialSelectedId)?.name ??
      "")
    : (vals.newClientName ?? "");

  const [clientName, setClientName] = useState<string>(initialClientName);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(
    initialSelectedId
  );
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const clientInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Filter existing clients against what the user has typed. Opens the
  // dropdown when the input has focus + non-empty value with matches.
  const suggestions = useMemo(() => {
    const q = clientName.trim().toLowerCase();
    if (!q) return [];
    return options.clients
      .filter((c) => {
        const inName = c.name.toLowerCase().includes(q);
        const inOrg = c.organization?.toLowerCase().includes(q) ?? false;
        return inName || inOrg;
      })
      .slice(0, MAX_SUGGESTIONS);
  }, [clientName, options.clients]);

  // Click-outside to close suggestions.
  useEffect(() => {
    if (!suggestionsOpen) return;
    const handler = (e: MouseEvent) => {
      const el = e.target as Node;
      if (
        clientInputRef.current?.contains(el) ||
        suggestionsRef.current?.contains(el)
      ) {
        return;
      }
      setSuggestionsOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [suggestionsOpen]);

  const pickExisting = (c: ClientOption) => {
    setSelectedClientId(c.id);
    setClientName(c.name);
    setSuggestionsOpen(false);
  };

  const clearExisting = () => {
    setSelectedClientId(null);
    setSuggestionsOpen(false);
    // Keep clientName — user might want to tweak it and create new.
    clientInputRef.current?.focus();
  };

  // Hidden clientId sent with form submission:
  // - existing id when a suggestion was picked
  // - sentinel when a name was typed (create new)
  // - empty string when no name typed at all (no client)
  const hiddenClientId = selectedClientId
    ? selectedClientId
    : clientName.trim().length > 0
      ? NEW_CLIENT_SENTINEL
      : "";

  const selectedClient = selectedClientId
    ? options.clients.find((c) => c.id === selectedClientId)
    : null;

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
        {/* Hidden field that the server action reads. Derived from
            whether the user picked an existing contact, typed a name,
            or left it blank. */}
        <input type="hidden" name="clientId" value={hiddenClientId} />

        <Row>
          {/* Client — typeahead */}
          <div className="flex flex-col gap-1 relative">
            <label
              htmlFor="newClientName"
              className="text-xs font-medium text-ink-2"
            >
              Client
            </label>

            {selectedClient ? (
              <div
                className="flex items-center gap-2 h-8 px-2.5 rounded-md border border-brand-200 bg-brand-soft/40 text-xs text-ink-2"
                aria-live="polite"
              >
                <UserCheck size={13} className="text-brand-700 shrink-0" />
                <span className="font-medium truncate flex-1">
                  {selectedClient.name}
                </span>
                {selectedClient.organization && (
                  <span className="text-2xs font-mono text-ink-4 truncate">
                    {selectedClient.organization}
                  </span>
                )}
                <button
                  type="button"
                  onClick={clearExisting}
                  aria-label="Unlink client"
                  className="p-0.5 rounded text-ink-3 hover:text-ink-2"
                >
                  <X size={12} />
                </button>
              </div>
            ) : (
              <>
                <input
                  ref={clientInputRef}
                  id="newClientName"
                  name="newClientName"
                  type="text"
                  autoComplete="off"
                  value={clientName}
                  onChange={(e) => {
                    setClientName(e.target.value);
                    setSuggestionsOpen(e.target.value.trim().length > 0);
                  }}
                  onFocus={() => {
                    if (clientName.trim().length > 0) setSuggestionsOpen(true);
                  }}
                  className={inputCls(
                    !!errs.newClientName || !!errs.clientId
                  )}
                  placeholder="Client name (type to search or create new)"
                />
                {suggestionsOpen && suggestions.length > 0 && (
                  <div
                    ref={suggestionsRef}
                    role="listbox"
                    className="absolute left-0 right-0 top-[calc(100%+2px)] z-20 rounded-md border border-line bg-white shadow-md py-1"
                  >
                    <div className="px-2.5 py-1 text-2xs font-mono uppercase tracking-wider text-ink-4">
                      Matching clients
                    </div>
                    {suggestions.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => pickExisting(c)}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left hover:bg-brand-tint"
                      >
                        <UserCheck
                          size={12}
                          className="text-ink-4 shrink-0"
                        />
                        <span className="font-medium text-ink">{c.name}</span>
                        {c.organization && (
                          <span className="text-2xs font-mono text-ink-4 truncate">
                            · {c.organization}
                          </span>
                        )}
                      </button>
                    ))}
                    <div className="border-t border-line mt-1 pt-1 px-2.5 pb-0.5 text-2xs text-ink-4 flex items-center gap-1">
                      <UserPlus size={11} />
                      Or keep typing to create
                      {clientName.trim() && (
                        <span className="text-ink-3 font-medium truncate">
                          {" “"}
                          {clientName.trim()}
                          {"”"}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}

            {errs.newClientName && errs.newClientName.length > 0 && (
              <div className="text-2xs text-warn">{errs.newClientName[0]}</div>
            )}
            {!selectedClient && !errs.newClientName?.length && (
              <div className="text-2xs text-ink-4">
                Start typing — we&apos;ll suggest existing clients, or
                create a new one on save.
              </div>
            )}
          </div>

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

        {/* New-client fields — visible whenever the user is NOT linked
            to an existing client (default). Name is the typeahead
            input above; these round out the contact record. */}
        {!selectedClient && (
          <div className="flex flex-col gap-3">
            <Row>
              <Field
                label="Client email"
                name="newClientEmail"
                error={errs.newClientEmail}
                hint="Email or phone required to reach the client."
              >
                <input
                  id="newClientEmail"
                  name="newClientEmail"
                  type="email"
                  defaultValue={vals.newClientEmail ?? ""}
                  className={inputCls(!!errs.newClientEmail)}
                  placeholder="maria.alvarez@example.com"
                />
              </Field>
              <Field
                label="Client phone"
                name="newClientPhone"
                error={errs.newClientPhone}
              >
                <input
                  id="newClientPhone"
                  name="newClientPhone"
                  type="tel"
                  defaultValue={vals.newClientPhone ?? ""}
                  className={inputCls(!!errs.newClientPhone)}
                  placeholder="(303) 555-0182"
                />
              </Field>
            </Row>
            <Field
              label="Client organization"
              name="newClientOrganization"
              error={errs.newClientOrganization}
              hint="Optional — for business or institutional clients."
            >
              <input
                id="newClientOrganization"
                name="newClientOrganization"
                type="text"
                defaultValue={vals.newClientOrganization ?? ""}
                className={inputCls(!!errs.newClientOrganization)}
              />
            </Field>
          </div>
        )}

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

      {/* ── Details ─────────────────────────────────────────────── */}
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
