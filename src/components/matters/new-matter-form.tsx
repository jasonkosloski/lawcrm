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
 * stop overwriting their value. While it is not dirty the displayed
 * name is derived from the other fields during render (no effect). A
 * "Reset to auto" link restores the auto-generated name.
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
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { Sparkles, UserCheck, UserPlus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { createMatter } from "@/app/actions/matters";
import { formatStatutePeriod, type SolPeriod } from "@/lib/sol";
import { FEE_OPTIONS } from "@/lib/fee-structure-constants";
import { autoMatterName } from "@/lib/matter-name";
import {
  Field,
  Row,
  Section,
  inputCls,
  selectCls,
} from "./form-primitives";
import {
  createMatterInitialState,
  NEW_CLIENT_SENTINEL,
  type CreateMatterState,
} from "@/lib/new-matter-constants";

type ClientOption = {
  id: string;
  name: string;
  organization: string | null;
  city: string | null;
};

export type AreaOption = {
  id: string;
  name: string;
  hasStatuteOfLimitations: boolean;
  /** Total-days statute period; drives the auto-compute hint
   *  shown below the incident-date input on the SOL section. */
  statutePeriod: SolPeriod | null;
  statuteSourceCitation: string | null;
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
  users: Array<{ id: string; name: string; jobTitle: string; initials: string }>;
  currentUserId: string;
};

const MAX_SUGGESTIONS = 6;

export function NewMatterForm({ options }: { options: NewMatterFormOptions }) {
  const [state, formAction, isPending] = useActionState<
    CreateMatterState,
    FormData
  >(createMatter, createMatterInitialState);
  // Submit via onSubmit + startTransition rather than
  // `<form action={formAction}>`: React 19 auto-resets the form after a
  // function action, reverting every <select> (area, stage, fee, lead)
  // to its mount value after a validation error — so the corrected
  // resubmit would create the matter with the wrong values.
  const [, startTransition] = useTransition();
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as
      | HTMLElement
      | null;
    const fd = new FormData(e.currentTarget, submitter);
    startTransition(() => formAction(fd));
  };

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
  // Highlighted suggestion for keyboard selection (-1 = none).
  const [activeIndex, setActiveIndex] = useState(-1);
  // Set when the user unlinks a picked client so the freshly mounted
  // text input takes focus (the unlink button that had it unmounts).
  const [focusClientInput, setFocusClientInput] = useState(false);
  const listboxId = useId();
  const clientInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // ── Auto-name inputs (controlled) ────────────────────────────────────
  // Both seed from the action-echoed values so nothing typed gets
  // lost across a validation-error round trip.
  const [caseNumber, setCaseNumber] = useState<string>(vals.caseNumber ?? "");
  const [location, setLocation] = useState<string>(vals.location ?? "");

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

  const selectedClient = selectedClientId
    ? options.clients.find((c) => c.id === selectedClientId)
    : null;

  // The auto name is pure derived state. Until the user takes ownership
  // of the field the input shows it directly — no effect, no stale
  // first render.
  const autoName = autoMatterName({
    clientName,
    // A picked contact whose organization is its own name is an
    // organization — never invert it into "Fund, Colorado Freedom".
    isOrganization:
      !!selectedClient && selectedClient.organization === selectedClient.name,
    caseNumber,
    location,
  });
  const displayedName = isNameDirty ? matterName : autoName;

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
    setActiveIndex(-1);
  };

  // Unlinking also clears the typed name: leaving the old name in the
  // box would turn it straight into a "create new client" with that
  // same name (a duplicate contact).
  const clearExisting = () => {
    setSelectedClientId(null);
    setClientName("");
    setSuggestionsOpen(false);
    setActiveIndex(-1);
    setFocusClientInput(true);
  };

  const resetNameToAuto = () => {
    setIsNameDirty(false);
  };

  const activeOption =
    suggestionsOpen && suggestions.length > 0
      ? Math.min(activeIndex, suggestions.length - 1)
      : -1;
  const optionId = (i: number) => `${listboxId}-opt-${i}`;

  // Combobox keyboard support. Enter never falls through to form
  // submit while the list is open: it picks the highlighted client, or
  // (nothing highlighted) just closes the list — otherwise Enter would
  // submit the typed name as a brand-new duplicate client.
  const onClientKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const listOpen = suggestionsOpen && suggestions.length > 0;
    if (e.key === "Escape") {
      if (suggestionsOpen) {
        e.preventDefault();
        setSuggestionsOpen(false);
        setActiveIndex(-1);
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (suggestions.length === 0) return;
      e.preventDefault();
      if (!suggestionsOpen) {
        setSuggestionsOpen(true);
        setActiveIndex(e.key === "ArrowDown" ? 0 : suggestions.length - 1);
        return;
      }
      const delta = e.key === "ArrowDown" ? 1 : -1;
      const from = activeOption;
      setActiveIndex(
        from === -1
          ? delta === 1
            ? 0
            : suggestions.length - 1
          : (from + delta + suggestions.length) % suggestions.length
      );
      return;
    }
    if (e.key === "Enter" && listOpen) {
      e.preventDefault();
      if (activeOption >= 0) pickExisting(suggestions[activeOption]);
      else setSuggestionsOpen(false);
    }
  };

  const hiddenClientId = selectedClientId
    ? selectedClientId
    : clientName.trim().length > 0
      ? NEW_CLIENT_SENTINEL
      : "";

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
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
              {!isNameDirty && displayedName && (
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
            value={displayedName}
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
                  autoFocus={focusClientInput}
                  role="combobox"
                  aria-expanded={suggestionsOpen && suggestions.length > 0}
                  aria-controls={listboxId}
                  aria-autocomplete="list"
                  aria-activedescendant={
                    activeOption >= 0 ? optionId(activeOption) : undefined
                  }
                  value={clientName}
                  onChange={(e) => {
                    setClientName(e.target.value);
                    setSuggestionsOpen(e.target.value.trim().length > 0);
                    setActiveIndex(-1);
                  }}
                  onKeyDown={onClientKeyDown}
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
                    id={listboxId}
                    role="listbox"
                    aria-label="Matching clients"
                    className="absolute left-0 right-0 top-[calc(100%+2px)] z-20 rounded-md border border-line bg-white shadow-md py-1"
                  >
                    <div className="px-2.5 py-1 text-2xs font-mono uppercase tracking-wider text-ink-4">
                      Matching clients
                    </div>
                    {suggestions.map((c, i) => (
                      <div
                        key={c.id}
                        id={optionId(i)}
                        role="option"
                        aria-selected={i === activeOption}
                        onClick={() => pickExisting(c)}
                        className={cn(
                          "w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left cursor-pointer hover:bg-brand-tint",
                          i === activeOption && "bg-brand-tint"
                        )}
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
                      </div>
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
                  {u.name} · {u.jobTitle}
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
          practice area tracks SOL. The action auto-computes the
          deadline from incidentDate + the area's configured
          statute period; explicit Deadline date wins so the user
          can override. */}
      {selectedArea?.hasStatuteOfLimitations && (
        <Section title="Statute of limitations">
          <Row>
            <Field
              label="Incident / accrual date"
              name="incidentDate"
              error={errs.incidentDate}
              hint={
                selectedArea.statutePeriod
                  ? `Period: ${formatStatutePeriod(selectedArea.statutePeriod)}${selectedArea.statuteSourceCitation ? ` · ${selectedArea.statuteSourceCitation}` : ""}. Leave Deadline blank to auto-compute.`
                  : "When known, drives the SOL deadline once the firm configures a statute period for this area."
              }
            >
              <input
                id="incidentDate"
                name="incidentDate"
                type="date"
                defaultValue={vals.incidentDate ?? ""}
                className={inputCls(!!errs.incidentDate)}
              />
            </Field>
            <Field
              label="Deadline date"
              name="statuteOfLimitationsDate"
              error={errs.statuteOfLimitationsDate}
              hint="Manual override — wins over auto-compute."
            >
              <input
                id="statuteOfLimitationsDate"
                name="statuteOfLimitationsDate"
                type="date"
                defaultValue={vals.statuteOfLimitationsDate ?? ""}
                className={inputCls(!!errs.statuteOfLimitationsDate)}
              />
            </Field>
          </Row>
          <Row>
            <Field
              label="Notes"
              name="statuteOfLimitationsNotes"
              error={errs.statuteOfLimitationsNotes}
              hint="Tolling agreement, jurisdictional quirks, prior CRS exposure…"
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
