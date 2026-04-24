/**
 * New Matter Form
 *
 * Create-matter flow with a "magical" auto-populated matter name.
 * Default stance is "you're creating a new client." As the user fills
 * in client name / case number / location, the Matter name builds
 * itself using the firm's pattern:
 *
 *     Last, First - Case Number - Location
 *
 * The pattern is hardcoded for now. Future: firm-admin-configurable
 * and per-practice-area overrides.
 *
 * Dirty-tracking: once the user types in the matter name input, we
 * stop overwriting their value. A "Reset to auto" link restores the
 * auto-generated name.
 *
 * Typeahead client picker: matches existing Contacts as the user
 * types. Picking one links to the contact. Case location is
 * intentionally NOT inferred from the client's city — the location
 * of the case (incident location / venue) is a separate concept from
 * where the client lives, so it stays a free-text field the user
 * fills in only when relevant.
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
import { Sparkles, UserCheck, UserPlus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { createMatter } from "@/app/actions/matters";
import {
  createMatterInitialState,
  NEW_CLIENT_SENTINEL,
  type CreateMatterState,
} from "@/lib/new-matter-constants";

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
  city: string | null;
  state: string | null;
};

export type AreaOption = {
  id: string;
  name: string;
  hasStatuteOfLimitations: boolean;
  stages: Array<{
    id: string;
    name: string;
    order: number;
    isTerminal: boolean;
  }>;
};

export type NewMatterFormOptions = {
  areas: AreaOption[];
  clients: ClientOption[];
  users: Array<{ id: string; name: string; role: string; initials: string }>;
  currentUserId: string;
};

const MAX_SUGGESTIONS = 6;

/** Split a full name into first + last on the last whitespace. Handles
 *  single-word names ("Madonna" → last only) and multi-part first names
 *  ("Mary Jane Watson" → first="Mary Jane", last="Watson"). */
function splitName(full: string): { firstName: string; lastName: string } {
  const trimmed = full.trim();
  if (!trimmed) return { firstName: "", lastName: "" };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { firstName: "", lastName: parts[0] };
  return {
    lastName: parts[parts.length - 1],
    firstName: parts.slice(0, -1).join(" "),
  };
}

/** Build the firm's matter-name pattern from the filled-in parts.
 *  Only joins non-empty segments with " - " so partial fills read
 *  naturally: "Alvarez, Maria - Aurora" rather than "Alvarez, Maria
 *  -  - Aurora". */
function buildAutoMatterName(parts: {
  firstName: string;
  lastName: string;
  caseNumber: string;
  location: string;
}): string {
  const segments: string[] = [];
  const f = parts.firstName.trim();
  const l = parts.lastName.trim();
  if (f && l) segments.push(`${l}, ${f}`);
  else if (l) segments.push(l);
  else if (f) segments.push(f);
  const c = parts.caseNumber.trim();
  if (c) segments.push(c);
  const loc = parts.location.trim();
  if (loc) segments.push(loc);
  return segments.join(" - ");
}

export function NewMatterForm({ options }: { options: NewMatterFormOptions }) {
  const [state, formAction, isPending] = useActionState<
    CreateMatterState,
    FormData
  >(createMatter, createMatterInitialState);

  const vals = state.values ?? {};
  const errs = state.errors ?? {};

  // ── Client picker state ──────────────────────────────────────────────
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

  // ── Auto-name inputs (controlled) ────────────────────────────────────
  const [caseNumber, setCaseNumber] = useState<string>(vals.caseNumber ?? "");
  const [location, setLocation] = useState<string>("");

  // ── Matter name state + dirty tracking ───────────────────────────────
  // If the server action re-rendered us after a validation error,
  // treat the previously-submitted name as user-edited so we don't
  // blow it away on the next dependency change.
  const [matterName, setMatterName] = useState<string>(vals.name ?? "");
  const [isNameDirty, setIsNameDirty] = useState<boolean>(
    Boolean(vals.name)
  );

  // ── Practice area + stage (cascading) ────────────────────────────────
  // Seed from the previously-submitted values on validation error,
  // otherwise default to the first area + its first stage.
  const firstArea = options.areas[0];
  const initialAreaId =
    vals.practiceAreaId ?? firstArea?.id ?? "";
  const initialArea = options.areas.find((a) => a.id === initialAreaId);
  const initialStageId =
    vals.stageId ??
    initialArea?.stages[0]?.id ??
    "";

  const [practiceAreaId, setPracticeAreaId] = useState<string>(initialAreaId);
  const [stageId, setStageId] = useState<string>(initialStageId);

  const selectedArea = options.areas.find((a) => a.id === practiceAreaId);
  const stageOptions = selectedArea?.stages ?? [];

  const handleAreaChange = (nextAreaId: string) => {
    setPracticeAreaId(nextAreaId);
    // If the current stage isn't part of the new area, snap to that
    // area's first stage so the form never submits a mismatched pair.
    const nextArea = options.areas.find((a) => a.id === nextAreaId);
    const stageBelongs = nextArea?.stages.some((s) => s.id === stageId);
    if (!stageBelongs) setStageId(nextArea?.stages[0]?.id ?? "");
  };

  const autoName = useMemo(() => {
    const { firstName, lastName } = splitName(clientName);
    return buildAutoMatterName({
      firstName,
      lastName,
      caseNumber,
      location,
    });
  }, [clientName, caseNumber, location]);

  // Sync matter name from auto-generated value — but only when the
  // user hasn't taken ownership of the field.
  useEffect(() => {
    if (!isNameDirty) setMatterName(autoName);
  }, [autoName, isNameDirty]);

  // ── Client suggestions (typeahead) ───────────────────────────────────
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
    clientInputRef.current?.focus();
  };

  const resetNameToAuto = () => {
    setIsNameDirty(false);
    setMatterName(autoName);
  };

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
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <label
              htmlFor="name"
              className="text-xs font-medium text-ink-2 flex items-center gap-1.5"
            >
              Matter name
              <span className="text-warn">*</span>
              {!isNameDirty && matterName && (
                <span
                  className="inline-flex items-center gap-1 text-2xs font-mono text-brand-700 bg-brand-soft px-1.5 py-0.5 rounded-full border border-brand-200"
                  title="Auto-generated from Client + Case number + Location"
                >
                  <Sparkles size={10} />
                  auto
                </span>
              )}
            </label>
            {isNameDirty && (
              <button
                type="button"
                onClick={resetNameToAuto}
                className="text-2xs text-brand-700 hover:underline"
              >
                Reset to auto
              </button>
            )}
          </div>
          <input
            id="name"
            name="name"
            type="text"
            value={matterName}
            onChange={(e) => {
              setMatterName(e.target.value);
              setIsNameDirty(true);
            }}
            required
            className={inputCls(!!errs.name)}
            placeholder="Fill in the fields below — or type your own"
          />
          {errs.name && errs.name.length > 0 ? (
            <div className="text-2xs text-warn">{errs.name[0]}</div>
          ) : (
            <div className="text-2xs text-ink-4">
              Pattern:{" "}
              <span className="font-mono text-ink-3">
                Last, First - Case Number - Location
              </span>
            </div>
          )}
        </div>

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
              {options.areas.length === 0 && (
                <option value="" disabled>
                  No practice areas configured
                </option>
              )}
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
              value={caseNumber}
              onChange={(e) => setCaseNumber(e.target.value)}
              className={inputCls(!!errs.caseNumber)}
              placeholder="2026-CV-00481"
            />
          </Field>

          <Field
            label="Case location"
            name="location"
            hint="Optional — incident location or venue (e.g. 'Aurora'). Folds into the matter name if set."
          >
            <input
              id="location"
              name="location"
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className={inputCls(false)}
              placeholder="Aurora (optional)"
            />
          </Field>
        </Row>

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
      </Section>

      {/* ── People ──────────────────────────────────────────────── */}
      <Section title="People">
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
                  placeholder="Client name (First Last — type to search or create)"
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
                        {c.city && (
                          <span className="text-2xs font-mono text-ink-4 ml-auto shrink-0">
                            {c.city}
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

        {/* New-client fields — visible unless an existing client is linked. */}
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

      {/* Statute of limitations — only surfaces when the chosen
          practice area tracks SOL. Same data persists on create. */}
      {selectedArea?.hasStatuteOfLimitations && (
        <Section title="Statute of limitations">
          <Row>
            <Field
              label="Deadline date"
              name="statuteOfLimitationsDate"
              error={errs.statuteOfLimitationsDate}
              hint="The SOL deadline you need to track on this matter."
            >
              <input
                id="statuteOfLimitationsDate"
                name="statuteOfLimitationsDate"
                type="date"
                defaultValue={vals.statuteOfLimitationsDate ?? ""}
                className={inputCls(!!errs.statuteOfLimitationsDate)}
              />
            </Field>
            <Field
              label="Notes"
              name="statuteOfLimitationsNotes"
              error={errs.statuteOfLimitationsNotes}
              hint="CRS cite, tolling agreement…"
            >
              <input
                id="statuteOfLimitationsNotes"
                name="statuteOfLimitationsNotes"
                type="text"
                defaultValue={vals.statuteOfLimitationsNotes ?? ""}
                className={inputCls(!!errs.statuteOfLimitationsNotes)}
              />
            </Field>
          </Row>
        </Section>
      )}

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
