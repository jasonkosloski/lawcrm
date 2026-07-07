/**
 * Party Edit Form — in-place editor for a party on a matter.
 *
 * Two write surfaces with very different blast radii:
 *   1. The shared Contact record — name, email, organization, and
 *      the multi-phone list. Contacts are firm-wide, so edits here
 *      ripple to every matter the contact appears on (the form
 *      warns the user under the phone editor).
 *   2. The MatterContact join row — subrole, notes, and (when not
 *      a client) representation info. Scoped to this matter only.
 */

"use client";

import {
  useActionState,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Plus, Star, UserCheck, UserPlus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { updateMatterContact } from "@/app/actions/parties";
import {
  partyInitialState,
  type PartyCategory,
  type PartyFormState,
} from "@/lib/party-constants";
import type { PartyRow } from "@/lib/queries/matter-detail";
import type { ContactOption } from "./party-composer";

type PhoneDraft = {
  tempId: string;
  label: string;
  number: string;
  isPrimary: boolean;
};

const PICK_EXISTING = "__existing__";
const CREATE_NEW = "__new__";
const MAX_REP_SUGGESTIONS = 6;

export function PartyEditForm({
  party,
  category,
  contacts,
  onDone,
}: {
  party: PartyRow;
  category: PartyCategory;
  /** All active contacts — feeds the representation typeahead. */
  contacts: ContactOption[];
  onDone: () => void;
}) {
  const action = updateMatterContact.bind(null, party.id);
  const [state, formAction, isPending] = useActionState<
    PartyFormState,
    FormData
  >(action, partyInitialState);

  const showsRepresentation = category !== "client";

  const [contactName, setContactName] = useState(party.name);
  const [contactEmail, setContactEmail] = useState(party.email ?? "");
  const [contactOrganization, setContactOrganization] = useState(
    party.organization ?? ""
  );
  const [role, setRole] = useState(party.role ?? "");
  const [notes, setNotes] = useState(party.notes ?? "");

  // Phones — hydrate from the loaded contact.phones, fall back to a
  // single empty row keyed "Primary" when the contact has none so
  // there's always a slot the user can fill.
  const idPrefix = useId();
  let phoneCounter = 0;
  const nextPhoneId = () =>
    `phone-${idPrefix}-${++phoneCounter}-${Date.now()}`;
  const [phones, setPhones] = useState<PhoneDraft[]>(() => {
    if (party.phones.length > 0) {
      return party.phones.map((p) => ({
        tempId: p.id,
        label: p.label ?? "",
        number: p.number,
        isPrimary: p.isPrimary,
      }));
    }
    return [
      {
        tempId: `phone-${idPrefix}-init`,
        label: "",
        number: "",
        isPrimary: true,
      },
    ];
  });

  const addPhone = () => {
    setPhones((prev) => [
      ...prev,
      {
        tempId: nextPhoneId(),
        label: "",
        number: "",
        // New phones default to non-primary; user can promote one.
        isPrimary: prev.length === 0,
      },
    ]);
  };
  const removePhone = (tempId: string) => {
    setPhones((prev) => {
      const next = prev.filter((p) => p.tempId !== tempId);
      // If we just removed the primary and others remain, promote
      // the first one so exactly one primary survives.
      if (next.length > 0 && !next.some((p) => p.isPrimary)) {
        next[0] = { ...next[0], isPrimary: true };
      }
      return next;
    });
  };
  const updatePhone = (tempId: string, patch: Partial<PhoneDraft>) => {
    setPhones((prev) =>
      prev.map((p) => (p.tempId === tempId ? { ...p, ...patch } : p))
    );
  };
  const setPrimary = (tempId: string) => {
    setPhones((prev) =>
      prev.map((p) => ({ ...p, isPrimary: p.tempId === tempId }))
    );
  };

  // Only submit phones that have a number — empty drafts are ignored
  // server-side anyway (min(1) on number).
  const phonesJson = JSON.stringify(
    phones
      .filter((p) => p.number.trim().length > 0)
      .map((p) => ({
        label: p.label.trim(),
        number: p.number.trim(),
        isPrimary: p.isPrimary,
      }))
  );
  const [representation, setRepresentation] = useState<
    "unknown" | "yes" | "no"
  >(
    party.isRepresented === true
      ? "yes"
      : party.isRepresented === false
        ? "no"
        : "unknown"
  );
  // Representation picker — pre-populate from the existing FK if any
  // (preferred), else from the legacy free-text columns so partial-
  // historic data still hydrates the form. Picking an existing contact
  // overrides the typed query path; clearing it returns to create-new
  // mode with the original text fields intact.
  const initialRepContact = party.representationContactId
    ? contacts.find((c) => c.id === party.representationContactId) ?? null
    : null;
  const [repSelectedId, setRepSelectedId] = useState<string | null>(
    party.representationContactId ?? null
  );
  const [repQuery, setRepQuery] = useState(
    initialRepContact?.name ?? party.representationName ?? ""
  );
  const [repSuggestionsOpen, setRepSuggestionsOpen] = useState(false);
  const [repFirm, setRepFirm] = useState(party.representationFirm ?? "");
  const [repEmail, setRepEmail] = useState(party.representationEmail ?? "");
  const [repPhone, setRepPhone] = useState(party.representationPhone ?? "");
  const repInputRef = useRef<HTMLInputElement>(null);
  const repSuggestionsRef = useRef<HTMLDivElement>(null);

  const repSuggestions = useMemo(() => {
    const q = repQuery.trim().toLowerCase();
    if (!q) return [];
    const matches = contacts.filter((c) => {
      const inName = c.name.toLowerCase().includes(q);
      const inOrg = c.organization?.toLowerCase().includes(q) ?? false;
      const inEmail = c.email?.toLowerCase().includes(q) ?? false;
      return inName || inOrg || inEmail;
    });
    const isAttorneyish = (c: ContactOption) =>
      c.type === "opposing_counsel" || c.type === "other";
    matches.sort((a, b) => Number(isAttorneyish(b)) - Number(isAttorneyish(a)));
    return matches.slice(0, MAX_REP_SUGGESTIONS);
  }, [repQuery, contacts]);

  useEffect(() => {
    if (!repSuggestionsOpen) return;
    const handler = (e: MouseEvent) => {
      const el = e.target as Node;
      if (
        repInputRef.current?.contains(el) ||
        repSuggestionsRef.current?.contains(el)
      ) {
        return;
      }
      setRepSuggestionsOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [repSuggestionsOpen]);

  const pickRepExisting = (c: ContactOption) => {
    setRepSelectedId(c.id);
    setRepQuery(c.name);
    setRepSuggestionsOpen(false);
    setRepFirm(c.organization ?? "");
    setRepEmail(c.email ?? "");
    setRepPhone(c.phone ?? "");
  };
  const clearRepSelection = () => {
    setRepSelectedId(null);
    setRepSuggestionsOpen(false);
    // Restore the party's saved rep fields rather than blanking —
    // an accidental pick + X + save must not overwrite existing
    // representation data with empty strings. (The composer's
    // identical helper wipes instead; it has no prior data.)
    setRepQuery(party.representationName ?? "");
    setRepFirm(party.representationFirm ?? "");
    setRepEmail(party.representationEmail ?? "");
    setRepPhone(party.representationPhone ?? "");
    repInputRef.current?.focus();
  };

  const repSelected = repSelectedId
    ? contacts.find((c) => c.id === repSelectedId)
    : null;
  const repContactMode = repSelected ? PICK_EXISTING : CREATE_NEW;

  useEffect(() => {
    if (state.status === "ok") onDone();
  }, [state.status, onDone]);

  const errs = state.errors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-2">
      {/* Contact core — edits flow back to the global Contact record
          and affect every matter this contact appears on. */}
      <div className="flex flex-col gap-1.5">
        <div className="text-2xs font-mono uppercase tracking-wider text-ink-4">
          Contact
        </div>
        <input
          type="text"
          name="contactName"
          value={contactName}
          onChange={(e) => setContactName(e.target.value)}
          placeholder="Name"
          className={cn(
            "h-7 px-2 rounded-md border bg-white text-xs text-ink",
            "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
            "placeholder:text-ink-4",
            errs.contactName ? "border-warn" : "border-line"
          )}
        />
        {errs.contactName && (
          <div className="text-2xs text-warn">{errs.contactName[0]}</div>
        )}
        <input
          type="email"
          name="contactEmail"
          value={contactEmail}
          onChange={(e) => setContactEmail(e.target.value)}
          placeholder="Email (optional)"
          className="h-7 px-2 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 placeholder:text-ink-4"
        />
        <input
          type="text"
          name="contactOrganization"
          value={contactOrganization}
          onChange={(e) => setContactOrganization(e.target.value)}
          placeholder="Organization (optional)"
          className="h-7 px-2 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 placeholder:text-ink-4"
        />

        {/* Phones — multi-entry editor. Star marks the primary. */}
        <input type="hidden" name="phones" value={phonesJson} />
        <div className="flex flex-col gap-1.5 pt-1">
          <div className="flex items-center justify-between">
            <div className="text-2xs font-mono uppercase tracking-wider text-ink-4">
              Phones
            </div>
            <button
              type="button"
              onClick={addPhone}
              className="inline-flex items-center gap-1 text-2xs text-brand-700 hover:underline"
            >
              <Plus size={11} />
              Add phone
            </button>
          </div>
          {phones.length === 0 ? (
            <div className="text-2xs text-ink-4 italic py-1">
              No phones — click "Add phone" to create one.
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {phones.map((p) => (
                <div
                  key={p.tempId}
                  className="grid grid-cols-[auto_8rem_1fr_auto] gap-1.5 items-center"
                >
                  <button
                    type="button"
                    onClick={() => setPrimary(p.tempId)}
                    title={
                      p.isPrimary
                        ? "Primary phone"
                        : "Make this the primary phone"
                    }
                    aria-label={
                      p.isPrimary ? "Primary phone" : "Set as primary"
                    }
                    aria-pressed={p.isPrimary}
                    className={cn(
                      "inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors",
                      p.isPrimary
                        ? "text-brand-700"
                        : "text-ink-4 hover:text-brand-700"
                    )}
                  >
                    <Star
                      size={12}
                      className={cn(p.isPrimary && "fill-brand-500 text-brand-500")}
                    />
                  </button>
                  <input
                    type="text"
                    value={p.label}
                    onChange={(e) =>
                      updatePhone(p.tempId, { label: e.target.value })
                    }
                    placeholder="Label (Mobile…)"
                    className="h-7 px-2 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 placeholder:text-ink-4"
                  />
                  <input
                    type="tel"
                    value={p.number}
                    onChange={(e) =>
                      updatePhone(p.tempId, { number: e.target.value })
                    }
                    placeholder="(303) 555-0000"
                    className="h-7 px-2 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 placeholder:text-ink-4 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => removePhone(p.tempId)}
                    title="Remove phone"
                    aria-label="Remove phone"
                    className="inline-flex items-center justify-center w-7 h-7 rounded-md text-ink-4 hover:text-warn hover:bg-warn-soft transition-colors"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="text-[10px] text-ink-4 leading-relaxed pt-0.5">
          Changes here update the contact across every matter they
          appear on.
        </div>
      </div>

      {/* Matter-specific fields — only apply to this matter. */}
      <div className="flex flex-col gap-1.5 pt-2 border-t border-line">
        <div className="text-2xs font-mono uppercase tracking-wider text-ink-4">
          Role on this matter
        </div>
        <div className="grid grid-cols-[1fr_2fr] gap-2">
          <input
            type="text"
            name="role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="Subrole (optional)"
            className="h-7 px-2 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 placeholder:text-ink-4"
          />
          <input
            type="text"
            name="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes about this party"
            className="h-7 px-2 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 placeholder:text-ink-4"
          />
        </div>
      </div>

      {showsRepresentation && (
        <>
          <input type="hidden" name="representation" value={representation} />
          {representation === "yes" && (
            <>
              <input
                type="hidden"
                name="representationContactMode"
                value={repContactMode}
              />
              {repSelected ? (
                <input
                  type="hidden"
                  name="representationContactId"
                  value={repSelected.id}
                />
              ) : (
                <>
                  <input
                    type="hidden"
                    name="newRepresentationName"
                    value={repQuery}
                  />
                  <input
                    type="hidden"
                    name="newRepresentationFirm"
                    value={repFirm}
                  />
                  <input
                    type="hidden"
                    name="newRepresentationEmail"
                    value={repEmail}
                  />
                  <input
                    type="hidden"
                    name="newRepresentationPhone"
                    value={repPhone}
                  />
                </>
              )}
            </>
          )}
          <div className="flex items-center gap-2">
            <span className="text-2xs font-mono uppercase tracking-wider text-ink-4">
              Represented
            </span>
            <div className="inline-flex items-center gap-0.5 rounded-md border border-line bg-white p-0.5">
              {(["unknown", "yes", "no"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setRepresentation(v)}
                  className={cn(
                    "text-2xs font-medium px-2 py-0.5 rounded transition-colors",
                    representation === v
                      ? "bg-brand-500 text-white"
                      : "text-ink-3 hover:text-brand-700"
                  )}
                >
                  {v === "unknown"
                    ? "Unknown"
                    : v === "yes"
                      ? "Yes"
                      : "Pro se"}
                </button>
              ))}
            </div>
          </div>
          {representation === "yes" && (
            <div className="flex flex-col gap-2">
              {repSelected ? (
                <div className="flex items-center gap-2 h-8 px-2.5 rounded-md border border-brand-200 bg-brand-soft/40 text-xs text-ink-2">
                  <UserCheck size={13} className="text-brand-700 shrink-0" />
                  <span className="font-medium truncate flex-1">
                    {repSelected.name}
                  </span>
                  {repSelected.organization && (
                    <span className="text-2xs font-mono text-ink-4 truncate">
                      {repSelected.organization}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={clearRepSelection}
                    aria-label="Unlink representing contact"
                    className="p-0.5 rounded text-ink-3 hover:text-ink-2"
                  >
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <input
                    ref={repInputRef}
                    type="text"
                    autoComplete="off"
                    value={repQuery}
                    onChange={(e) => {
                      setRepQuery(e.target.value);
                      setRepSuggestionsOpen(e.target.value.trim().length > 0);
                    }}
                    onFocus={() => {
                      if (repQuery.trim().length > 0) setRepSuggestionsOpen(true);
                    }}
                    placeholder="Attorney name — type to search or create"
                    className={cn(
                      "h-7 px-2 rounded-md border bg-white text-xs text-ink w-full",
                      "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
                      "placeholder:text-ink-4",
                      errs.newRepresentationName || errs.representationContactId
                        ? "border-warn"
                        : "border-line"
                    )}
                  />
                  {repSuggestionsOpen && repSuggestions.length > 0 && (
                    <div
                      ref={repSuggestionsRef}
                      role="listbox"
                      className="absolute left-0 right-0 top-[calc(100%+2px)] z-20 rounded-md border border-line bg-white shadow-md py-1"
                    >
                      <div className="px-2.5 py-1 text-2xs font-mono uppercase tracking-wider text-ink-4">
                        Matching contacts
                      </div>
                      {repSuggestions.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => pickRepExisting(c)}
                          className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left hover:bg-brand-tint"
                        >
                          <UserCheck size={12} className="text-ink-4 shrink-0" />
                          <span className="font-medium text-ink">{c.name}</span>
                          {c.organization && (
                            <span className="text-2xs font-mono text-ink-4 truncate">
                              · {c.organization}
                            </span>
                          )}
                          <span className="text-2xs font-mono text-ink-4 ml-auto shrink-0 capitalize">
                            {c.type.replace(/_/g, " ")}
                          </span>
                        </button>
                      ))}
                      <div className="border-t border-line mt-1 pt-1 px-2.5 pb-0.5 text-2xs text-ink-4 flex items-center gap-1">
                        <UserPlus size={11} />
                        Or keep typing to create
                        {repQuery.trim() && (
                          <span className="text-ink-3 font-medium truncate">
                            {" “"}
                            {repQuery.trim()}
                            {"”"}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                  {(errs.newRepresentationName ||
                    errs.representationContactId) && (
                    <div className="text-2xs text-warn mt-0.5">
                      {errs.newRepresentationName?.[0] ??
                        errs.representationContactId?.[0]}
                    </div>
                  )}
                </div>
              )}

              {!repSelected && (
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={repFirm}
                    onChange={(e) => setRepFirm(e.target.value)}
                    placeholder="Firm (optional)"
                    className="h-7 px-2 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 placeholder:text-ink-4"
                  />
                  <input
                    type="email"
                    value={repEmail}
                    onChange={(e) => setRepEmail(e.target.value)}
                    placeholder="Email (optional)"
                    className="h-7 px-2 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 placeholder:text-ink-4"
                  />
                  <input
                    type="tel"
                    value={repPhone}
                    onChange={(e) => setRepPhone(e.target.value)}
                    placeholder="Phone (optional)"
                    className="h-7 px-2 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 placeholder:text-ink-4 col-span-2"
                  />
                </div>
              )}
            </div>
          )}
        </>
      )}

      {(errs.role || errs.notes) && (
        <div className="text-2xs text-warn">
          {errs.role?.[0] ?? errs.notes?.[0]}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          className="text-2xs text-ink-3 hover:text-ink-2 px-2"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending}
          className={cn(
            "inline-flex items-center h-7 px-3 rounded-md text-xs font-medium bg-brand-500 text-white",
            "hover:bg-brand-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          )}
        >
          {isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
