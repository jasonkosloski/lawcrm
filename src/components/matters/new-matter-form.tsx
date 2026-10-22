/**
 * New Matter Form
 *
 * Create-matter flow with a "magical" auto-populated matter name.
 * Default stance is "you're creating a new client." As the user fills
 * in client / case number / venue / opposing party, the Matter name
 * builds itself from the effective template (the practice area's own,
 * else the firm's — see matter-name-template.ts).
 *
 * Dirty-tracking: once the user types in the matter name input, we
 * stop overwriting their value. While it is not dirty the displayed
 * name is derived from the other fields during render (no effect). A
 * "Reset to auto" link restores the auto-generated name.
 *
 * Typeahead client picker: matches existing Contacts as the user
 * types. Picking one links to the contact. Venue is a picked record,
 * never inferred from the client's city.
 */

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
import {
  BILLING_TYPE_OPTIONS,
  isBillingType,
  type BillingType,
} from "@/lib/billing-type";
import {
  effectiveTemplate,
  renderMatterName,
} from "@/lib/matter-name-template";
import {
  missingRequired,
  requiredFieldError,
  requiredKeysFor,
  REQUIRED_FIELD_INPUT_NAME,
  type RequiredMatterField,
} from "@/lib/matter-required-fields";
import type { VenueOption } from "@/lib/queries/venues";
import { VenueCombobox } from "./venue-combobox";
import {
  focusFirstInvalid,
  useRequiredHints,
  VenueField,
} from "./required-field-ui";
import {
  Row,
  Section,
} from "./form-primitives";
import {
  createMatterInitialState,
  NEW_CLIENT_SENTINEL,
  type CreateMatterState,
} from "@/lib/new-matter-constants";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ConflictReview } from "./conflict-review";
import { NewMatterTeamPicker, parseTeamSeats } from "./new-matter-team-picker";
import { EngagementSection, type EngagementChange } from "./engagement-section";
import { useDraftAutosave, type AutosaveStatus } from "./use-draft-autosave";
import type { DraftValues } from "@/app/actions/matter-drafts";
import { agreementGateErrors } from "@/lib/originating-doc";
import type { StorageDriver } from "@/lib/storage/storage-key";
import { Field, inputClass } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

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
  /** Per-area name template; null = the firm's. */
  matterNameTemplate: string | null;
  /** Keys from REQUIRED_MATTER_FIELDS the area insists on at creation. */
  requiredMatterFields: string[];
  /** Billing types the area offers, and the preselected one. */
  allowedBillingTypes: BillingType[];
  defaultBillingType: BillingType;
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
  /** Holds `matters.manage_team`: shows the extra team seats. */
  canManageTeam: boolean;
  venues: VenueOption[];
  /** Holds `venues.add`: lets the venue picker add inline. */
  canAddVenue: boolean;
  firmState: string;
  firmTemplate: string;
  timeZone: string;
};

/** A saved draft being resumed (`/matters/new?draft=<id>`). */
export type NewMatterDraft = {
  id: string;
  updatedAt: string;
  values: Record<string, string | string[]>;
  files: { id: string; name: string; isOriginating: boolean }[];
};

/** Originating-document ("Engagement") settings from the page. */
export type NewMatterEngagement = {
  /** The firm requires a signed originating document. */
  required: boolean;
  canUpload: boolean;
  /** Per practice area label; areas without one use `defaultLabel`. */
  labelsByArea: Record<string, string>;
  defaultLabel: string;
  /** The user's profile-zone today (YYYY-MM-DD) for the future-date check. */
  todayKey: string;
  storageDriver?: StorageDriver;
};

const DEFAULT_ENGAGEMENT: NewMatterEngagement = {
  required: false,
  canUpload: false,
  labelsByArea: {},
  defaultLabel: "Fee agreement",
  todayKey: "",
};

/** Carried by the draft row / files themselves, never saved as values. */
const NOT_DRAFT_VALUES = new Set([
  "draftId",
  "draftUpdatedAt",
  "originatingFileId",
  "originatingFileMark",
]);

function serializeForm(form: HTMLFormElement): DraftValues {
  const fd = new FormData(form);
  const out: DraftValues = {};
  for (const key of new Set(fd.keys())) {
    if (NOT_DRAFT_VALUES.has(key)) continue;
    const all = fd.getAll(key).filter((v): v is string => typeof v === "string");
    out[key] = all.length > 1 ? all : (all[0] ?? "");
  }
  return out;
}

const MAX_SUGGESTIONS = 6;

export function NewMatterForm({
  options,
  draft = null,
  engagement = DEFAULT_ENGAGEMENT,
}: {
  options: NewMatterFormOptions;
  draft?: NewMatterDraft | null;
  engagement?: NewMatterEngagement;
}) {
  const [state, formAction, isPending] = useActionState<
    CreateMatterState,
    FormData
  >(createMatter, createMatterInitialState);
  // Submit via onSubmit + startTransition rather than
  // `<form action={formAction}>`: React 19 auto-resets the form after a
  // function action, reverting any <select> not held in state
  // to its mount value after a validation error — so the corrected
  // resubmit would create the matter with the wrong values.
  const [, startTransition] = useTransition();
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const missing = checkRequired(new FormData(e.currentTarget));
    // Mirrors the server's originating-document gate (it stays the
    // authority); `today` is the user's profile-zone day.
    const gate = agreementGateErrors(
      {
        status: agreementStatus,
        signedDate: agreementSignedDate,
        hasOriginatingFile,
      },
      {
        required: engagement.required,
        label: engagementLabel,
        today: engagement.todayKey,
      }
    );
    if (missing.length > 0 || Object.keys(gate).length > 0) {
      const next: Record<string, string[]> = {};
      for (const k of missing) {
        next[REQUIRED_FIELD_INPUT_NAME[k]] = [requiredFieldError];
      }
      for (const [k, msg] of Object.entries(gate)) next[k] = [msg];
      setClientErrs(next);
      if (missing.length > 0 && formRef.current) {
        focusFirstInvalid(formRef.current, missing);
      }
      return;
    }
    setClientErrs({});
    const submitter = (e.nativeEvent as SubmitEvent).submitter as
      | HTMLElement
      | null;
    const fd = new FormData(e.currentTarget, submitter);
    const submit = () => {
      // An auto-save that landed since the last render moved the
      // draft's version; Create must claim the freshest one.
      const latest = autosave.latestUpdatedAt();
      if (autosave.draftId && latest) fd.set("draftUpdatedAt", latest);
      startTransition(() => formAction(fd));
    };
    if (autosave.isSaving()) void autosave.settled().then(submit);
    else submit();
  };

  // Client-side required-field errors (the server stays authoritative).
  const [clientErrs, setClientErrs] = useState<Record<string, string[]>>({});
  const formRef = useRef<HTMLFormElement>(null);
  // A validation-error echo wins over the saved draft's values.
  const draftVals: Record<string, string> = {};
  for (const [k, v] of Object.entries(draft?.values ?? {})) {
    if (typeof v === "string") draftVals[k] = v;
  }
  const vals = state.values ?? draftVals;
  const errs = { ...(state.errors ?? {}), ...clientErrs };

  // ── Draft save / auto-save ───────────────────────────────────────────
  const router = useRouter();
  const autosave = useDraftAutosave({
    draftId: draft?.id ?? null,
    updatedAt: draft?.updatedAt ?? null,
    getValues: () => (formRef.current ? serializeForm(formRef.current) : {}),
    paused: isPending,
  });
  const openDraft = (id: string) =>
    router.replace(`/matters/new?draft=${encodeURIComponent(id)}`);
  const saveDraft = async () => {
    const wasNew = !autosave.draftId;
    const id = await autosave.saveNow();
    if (id && wasNew) openDraft(id);
  };
  const ensureDraft = async (): Promise<string> => {
    if (autosave.draftId) return autosave.draftId;
    const id = await autosave.saveNow();
    if (!id) throw new Error("Couldn't save the draft.");
    openDraft(id);
    return id;
  };

  // ── Engagement (originating document) ────────────────────────────────
  const [agreementStatus, setAgreementStatus] = useState<string>(
    vals.agreementStatus ?? "not_sent"
  );
  const [agreementSignedDate, setAgreementSignedDate] = useState<string>(
    vals.agreementSignedDate ?? ""
  );
  const [originatingFileId, setOriginatingFileId] = useState<string>(
    draft?.files.find((f) => f.isOriginating)?.id ?? ""
  );
  const [removedFileIds, setRemovedFileIds] = useState<string[]>([]);
  const draftFiles = (draft?.files ?? []).filter(
    (f) => !removedFileIds.includes(f.id)
  );
  const hasOriginatingFile = draftFiles.some((f) => f.id === originatingFileId);
  const onEngagementChange = (c: EngagementChange) => {
    if (c.status !== undefined) setAgreementStatus(c.status);
    if (c.signedDate !== undefined) setAgreementSignedDate(c.signedDate);
    if (c.originatingFileId !== undefined) setOriginatingFileId(c.originatingFileId);
    if (c.removedFileId) {
      setRemovedFileIds((ids) => [...ids, c.removedFileId!]);
      if (c.removedFileId === originatingFileId) setOriginatingFileId("");
      router.refresh();
    }
  };

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
  const [venue, setVenue] = useState<VenueOption | null>(
    options.venues.find((v) => v.id === vals.venueId) ?? null
  );
  const [opposingParty, setOpposingParty] = useState<string>(
    vals.opposingParty ?? ""
  );

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

  const [leadUserId, setLeadUserId] = useState<string>(
    vals.leadUserId ?? options.currentUserId
  );

  const [practiceAreaId, setPracticeAreaId] = useState<string>(initialAreaId);
  const [stageId, setStageId] = useState<string>(initialStageId);
  // Controlled so the area-change handler can reset it; kept in state
  // (not defaultValue) so React 19's form reset can't revert it either.
  const [billingType, setBillingType] = useState<string>(() => {
    const allowed = initialArea?.allowedBillingTypes ?? [];
    // Drafts saved before billing types stored the old `feeStructure`.
    const saved = vals.billingType ?? vals.feeStructure;
    return isBillingType(saved) && allowed.includes(saved)
      ? saved
      : (initialArea?.defaultBillingType ?? "contingent");
  });

  const selectedArea = options.areas.find((a) => a.id === practiceAreaId);
  // Area change retitles the section; files and the mark stay (they
  // belong to the draft, not the area).
  const engagementLabel =
    engagement.labelsByArea[practiceAreaId] ?? engagement.defaultLabel;
  const stageOptions = selectedArea?.stages ?? [];

  const requiredKeys = requiredKeysFor(selectedArea ?? null);
  const { isRequired, requiredHint, reqHint } = useRequiredHints(
    selectedArea?.name,
    requiredKeys
  );

  function checkRequired(fd: FormData): RequiredMatterField[] {
    const get = (n: string) => String(fd.get(n) ?? "");
    return missingRequired(requiredKeys, {
      venue: get("venueId"),
      caseNumber: get("caseNumber"),
      court: get("court"),
      filedDate: get("filedDate"),
      trialDate: get("trialDate"),
      incidentDate: get("incidentDate"),
      opposingParty: get("opposingParty"),
      opposingFirm: get("opposingFirm"),
      description: get("description"),
      client: get("clientId"),
    });
  }

  const handleAreaChange = (nextAreaId: string) => {
    setPracticeAreaId(nextAreaId);
    // If the current stage isn't part of the new area, snap to that
    // area's first stage so the form never submits a mismatched pair.
    const nextArea = options.areas.find((a) => a.id === nextAreaId);
    const stageBelongs = nextArea?.stages.some((s) => s.id === stageId);
    if (!stageBelongs) setStageId(nextArea?.stages[0]?.id ?? "");
    // Same for billing type: keep the pick only if the new area offers it.
    if (
      !nextArea ||
      !isBillingType(billingType) ||
      !nextArea.allowedBillingTypes.includes(billingType)
    ) {
      setBillingType(nextArea?.defaultBillingType ?? "contingent");
    }
  };

  const selectedClient = selectedClientId
    ? options.clients.find((c) => c.id === selectedClientId)
    : null;

  // The auto name is pure derived state. Until the user takes ownership
  // of the field the input shows it directly — no effect, no stale
  // first render.
  const template = effectiveTemplate(
    selectedArea ?? null,
    options.firmTemplate
  );
  const autoName = renderMatterName(template, {
    clientName,
    // A picked contact whose organization is its own name is an
    // organization — never invert it into "Fund, Colorado Freedom".
    isOrganization:
      !!selectedClient && selectedClient.organization === selectedClient.name,
    caseNumber,
    venue: venue
      ? { name: venue.name, county: venue.county, state: venue.state }
      : null,
    opposingParty,
    practiceAreaName: selectedArea?.name ?? "",
    now: new Date(),
    timeZone: options.timeZone,
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
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-6">
      {errs.draftId?.[0] && (
        <div
          role="alert"
          className="rounded-md border border-warn-border bg-warn-soft px-3 py-2 text-xs font-medium text-warn"
        >
          {errs.draftId[0]}
        </div>
      )}
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
                  title="Auto-generated from the matter name template"
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
            className={inputClass(!!errs.name)}
            placeholder="Fill in the fields below — or type your own"
          />
          {errs.name && errs.name.length > 0 ? (
            <div className="text-2xs text-warn">{errs.name[0]}</div>
          ) : (
            <div className="text-2xs text-ink-4">
              Pattern:{" "}
              <span className="font-mono text-ink-3">{template}</span>
            </div>
          )}
        </div>

        <Row>
          <Field
            label="Practice area"
            htmlFor="practiceAreaId"
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
              {options.areas.length === 0 && (
                <NativeSelectOption value="" disabled>
                  No practice areas configured
                </NativeSelectOption>
              )}
              {options.areas.map((a) => (
                <NativeSelectOption key={a.id} value={a.id}>
                  {a.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>

          <Field label="Stage" htmlFor="stageId" error={errs.stageId}>
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
          <Field
            label="Case number"
            htmlFor="caseNumber"
            required={isRequired("caseNumber")}
            hint={reqHint("caseNumber")}
            error={errs.caseNumber}
          >
            <input
              id="caseNumber"
              name="caseNumber"
              type="text"
              value={caseNumber}
              onChange={(e) => setCaseNumber(e.target.value)}
              className={inputClass(!!errs.caseNumber)}
              placeholder="2026-CV-00481"
            />
          </Field>

          <VenueField
            required={isRequired("venue")}
            requiredHint={requiredHint}
            error={errs.venueId?.[0]}
          >
            <VenueCombobox
              name="venueId"
              venues={options.venues}
              value={venue?.id ?? null}
              onChange={setVenue}
              canAdd={options.canAddVenue}
              defaultState={options.firmState}
              error={errs.venueId?.[0]}
              required={isRequired("venue")}
            />
          </VenueField>
        </Row>

        <Field label="Billing type" htmlFor="billingType" error={errs.billingType}>
          <NativeSelect
            className="w-full"
            id="billingType"
            name="billingType"
            value={billingType}
            onChange={(e) => setBillingType(e.target.value)}
            aria-invalid={!!errs.billingType || undefined}
          >
            {BILLING_TYPE_OPTIONS.filter((o) =>
              selectedArea?.allowedBillingTypes.includes(o.value)
            ).map((o) => (
              <NativeSelectOption key={o.value} value={o.value}>
                {o.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
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
              {isRequired("client") && (
                <span className="text-warn ml-0.5">*</span>
              )}
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
                  className={inputClass(
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
                    <div className="px-2.5 py-1 text-2xs font-medium text-ink-3">
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
            {errs.clientId?.[0] && !errs.newClientName?.length && (
              <div className="text-2xs text-warn">{errs.clientId[0]}</div>
            )}
            {!selectedClient && !errs.newClientName?.length && !errs.clientId?.length && (
              <div className="text-2xs text-ink-4">
                {isRequired("client") && `${requiredHint}. `}Start typing — we&apos;ll suggest existing clients, or
                create a new one on save.
              </div>
            )}
          </div>

          <Field
            label="Lead attorney"
            htmlFor="leadUserId"
            required
            error={errs.leadUserId}
          >
            <NativeSelect
              className="w-full"
              id="leadUserId"
              name="leadUserId"
              value={leadUserId}
              onChange={(e) => setLeadUserId(e.target.value)}
              required
              aria-invalid={!!errs.leadUserId || undefined}
            >
              {options.users.map((u) => (
                <NativeSelectOption key={u.id} value={u.id}>
                  {u.name} · {u.jobTitle}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        </Row>

        {options.canManageTeam && (
          <NewMatterTeamPicker
            users={options.users}
            leadUserId={leadUserId}
            initial={parseTeamSeats(vals.extraTeam)}
            error={errs.extraTeam}
          />
        )}

        {/* New-client fields — visible unless an existing client is linked. */}
        {!selectedClient && (
          <div className="flex flex-col gap-3">
            <Row>
              <Field
                label="Client email"
                htmlFor="newClientEmail"
                error={errs.newClientEmail}
                hint="Email or phone required to reach the client."
              >
                <input
                  id="newClientEmail"
                  name="newClientEmail"
                  type="email"
                  defaultValue={vals.newClientEmail ?? ""}
                  className={inputClass(!!errs.newClientEmail)}
                  placeholder="maria.alvarez@example.com"
                />
              </Field>
              <Field
                label="Client phone"
                htmlFor="newClientPhone"
                error={errs.newClientPhone}
              >
                <input
                  id="newClientPhone"
                  name="newClientPhone"
                  type="tel"
                  defaultValue={vals.newClientPhone ?? ""}
                  className={inputClass(!!errs.newClientPhone)}
                  placeholder="(303) 555-0182"
                />
              </Field>
            </Row>
            <Field
              label="Client organization"
              htmlFor="newClientOrganization"
              error={errs.newClientOrganization}
              hint="Optional — for business or institutional clients."
            >
              <input
                id="newClientOrganization"
                name="newClientOrganization"
                type="text"
                defaultValue={vals.newClientOrganization ?? ""}
                className={inputClass(!!errs.newClientOrganization)}
              />
            </Field>
          </div>
        )}

        <Row>
          <Field
            label="Opposing party"
            htmlFor="opposingParty"
            required={isRequired("opposingParty")}
            hint={reqHint("opposingParty")}
            error={errs.opposingParty}
          >
            <input
              id="opposingParty"
              name="opposingParty"
              type="text"
              value={opposingParty}
              onChange={(e) => setOpposingParty(e.target.value)}
              className={inputClass(!!errs.opposingParty)}
              placeholder="City of Aurora, Officer J. Doe"
            />
          </Field>

          <Field
            label="Opposing firm"
            htmlFor="opposingFirm"
            required={isRequired("opposingFirm")}
            hint={reqHint("opposingFirm")}
            error={errs.opposingFirm}
          >
            <input
              id="opposingFirm"
              name="opposingFirm"
              type="text"
              defaultValue={vals.opposingFirm ?? ""}
              className={inputClass(!!errs.opposingFirm)}
              placeholder="Aurora City Attorney's Office"
            />
          </Field>
        </Row>
      </Section>

      {/* ── Details ─────────────────────────────────────────────── */}
      <Section title="Details">
        <Field
          label="Court"
          htmlFor="court"
          required={isRequired("court")}
          hint={reqHint("court")}
          error={errs.court}
        >
          <input
            id="court"
            name="court"
            type="text"
            defaultValue={vals.court ?? ""}
            className={inputClass(!!errs.court)}
            placeholder="D. Colorado · Hon. L. Martinez"
          />
        </Field>

        <Row>
          <Field
            label="Filed date"
            htmlFor="filedDate"
            required={isRequired("filedDate")}
            hint={reqHint("filedDate")}
            error={errs.filedDate}
          >
            <input
              id="filedDate"
              name="filedDate"
              type="date"
              defaultValue={vals.filedDate ?? ""}
              className={inputClass(!!errs.filedDate)}
            />
          </Field>
          <Field
            label="Trial date"
            htmlFor="trialDate"
            required={isRequired("trialDate")}
            hint={reqHint("trialDate")}
            error={errs.trialDate}
          >
            <input
              id="trialDate"
              name="trialDate"
              type="date"
              defaultValue={vals.trialDate ?? ""}
              className={inputClass(!!errs.trialDate)}
            />
          </Field>
        </Row>

        <Field
          label="Summary"
          htmlFor="description"
          required={isRequired("description")}
          hint={reqHint("description")}
          error={errs.description}
        >
          <textarea
            id="description"
            name="description"
            defaultValue={vals.description ?? ""}
            rows={4}
            className={cn(
              inputClass(!!errs.description),
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

      <EngagementSection
        label={engagementLabel}
        required={engagement.required}
        canUpload={engagement.canUpload}
        draftId={autosave.draftId}
        draftUpdatedAt={autosave.updatedAt}
        ensureDraft={ensureDraft}
        files={draftFiles}
        status={agreementStatus}
        signedDate={agreementSignedDate}
        originatingFileId={hasOriginatingFile ? originatingFileId : ""}
        onChange={onEngagementChange}
        errors={errs}
        storageDriver={engagement.storageDriver}
      />

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
              htmlFor="incidentDate"
              required={isRequired("incidentDate")}
              error={errs.incidentDate}
              hint={reqHint(
                "incidentDate",
                selectedArea.statutePeriod
                  ? `Period: ${formatStatutePeriod(selectedArea.statutePeriod)}${selectedArea.statuteSourceCitation ? ` · ${selectedArea.statuteSourceCitation}` : ""}. Leave Deadline blank to auto-compute.`
                  : "When known, drives the SOL deadline once the firm configures a statute period for this area."
              )}
            >
              <input
                id="incidentDate"
                name="incidentDate"
                type="date"
                defaultValue={vals.incidentDate ?? ""}
                className={inputClass(!!errs.incidentDate)}
              />
            </Field>
            <Field
              label="Deadline date"
              htmlFor="statuteOfLimitationsDate"
              error={errs.statuteOfLimitationsDate}
              hint="Manual override — wins over auto-compute."
            >
              <input
                id="statuteOfLimitationsDate"
                name="statuteOfLimitationsDate"
                type="date"
                defaultValue={vals.statuteOfLimitationsDate ?? ""}
                className={inputClass(!!errs.statuteOfLimitationsDate)}
              />
            </Field>
          </Row>
          <Row>
            <Field
              label="Notes"
              htmlFor="statuteOfLimitationsNotes"
              error={errs.statuteOfLimitationsNotes}
              hint="Tolling agreement, jurisdictional quirks, prior CRS exposure…"
            >
              <input
                id="statuteOfLimitationsNotes"
                name="statuteOfLimitationsNotes"
                type="text"
                defaultValue={vals.statuteOfLimitationsNotes ?? ""}
                className={inputClass(!!errs.statuteOfLimitationsNotes)}
              />
            </Field>
          </Row>
        </Section>
      )}

      {/* Conflict gate (ADR-054): keyed by fingerprint so a new result
          never inherits the previous one's "reviewed" tick. */}
      {state.conflict && (
        <ConflictReview
          key={state.conflict.fingerprint}
          conflict={state.conflict}
          checked="the client against adverse parties on other matters, and the opposing party and firm against the firm's clients"
          reasonError={errs.conflictOverrideReason}
          staleError={errs.conflictAck}
          defaultReason={vals.conflictOverrideReason}
        />
      )}

      {/* ── Submit ──────────────────────────────────────────────── */}
      <div className="sticky bottom-0 z-10 -mx-5 px-5 py-3 sm:static sm:mx-0 sm:px-0 sm:py-0 sm:pt-2 bg-white sm:bg-transparent flex items-center justify-end gap-2 border-t border-line">
        <DraftStatus
          status={autosave.status}
          savedAt={autosave.savedAt}
          timeZone={options.timeZone}
        />
        <Link
          href="/matters"
          className="inline-flex items-center h-8 px-3 rounded-md text-xs font-medium text-ink-2 border border-line bg-white hover:border-brand-300 hover:text-brand-700 transition-colors"
        >
          Cancel
        </Link>
        <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={() => void saveDraft()}
          disabled={isPending || autosave.status === "saving"}
          className="hover:border-brand-300 hover:text-brand-700"
        >
          Save draft
        </Button>
        <Button
          size="sm"
          type="submit"
          disabled={isPending}
        >
          {isPending ? "Creating…" : "Create matter"}
        </Button>
      </div>
    </form>
  );
}

function DraftStatus({
  status,
  savedAt,
  timeZone,
}: {
  status: AutosaveStatus;
  savedAt: Date | null;
  timeZone: string;
}) {
  if (status === "stale") {
    return (
      <span role="status" className="mr-auto text-2xs text-warn">
        Someone else saved this draft. Reload to see their changes.{" "}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="underline"
        >
          Reload
        </button>
      </span>
    );
  }
  if (status === "gone") {
    return (
      <span role="status" className="mr-auto text-2xs text-warn">
        This draft no longer exists
      </span>
    );
  }
  if (status === "invalid") {
    return (
      <span role="status" className="mr-auto text-2xs text-warn">
        This draft is too large to save.
      </span>
    );
  }
  if (status === "error") {
    return (
      <span role="status" className="mr-auto text-2xs text-warn">
        Couldn&apos;t save the draft. Try again.
      </span>
    );
  }
  if (status === "saving") {
    return (
      <span role="status" className="mr-auto text-2xs text-ink-4">
        Saving…
      </span>
    );
  }
  if (savedAt) {
    return (
      <span role="status" className="mr-auto text-2xs text-ink-4">
        Saved{" "}
        {savedAt.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          timeZone,
        })}
      </span>
    );
  }
  return null;
}
