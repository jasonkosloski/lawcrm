/**
 * Party Edit Form — in-place editor for a party on a matter.
 *
 * Two write surfaces with very different blast radii:
 *   1. The shared Contact record — name, email, organization, and
 *      the multi-phone list. Contacts are firm-wide, so edits here
 *      ripple to every matter the contact appears on (the form
 *      warns the user under the phone editor). The form posts the
 *      values it was loaded with (`orig*`) so the server only writes
 *      what this user changed and can detect a concurrent edit.
 *   2. The MatterContact join row — subrole, notes, and (when not
 *      a client) representation info. Scoped to this matter only.
 *
 * The action is dispatched from the submit handler (not the form's
 * `action`) so a validation error never resets what the user typed.
 */

"use client";

import { useId, useRef, useState, useTransition } from "react";
import { Plus, Star, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { updateMatterContact } from "@/app/actions/parties";
import {
  CREATE_NEW,
  PICK_EXISTING,
  partyInitialState,
  type ContactOption,
  type PartyCategory,
  type PartyFormState,
  type RepresentationChoice,
} from "@/lib/party-constants";
import type { PartyRow } from "@/lib/queries/matter-detail";
import {
  ContactTypeahead,
  RepresentationToggle,
  SelectedContactChip,
  collectOtherErrors,
} from "./party-pickers";

type PhoneDraft = {
  tempId: string;
  label: string;
  number: string;
  isPrimary: boolean;
};

const CONTACT_LOCKED_HINT =
  "Editing the shared contact (name, email, organization, phones) needs the contacts.edit permission.";

const INPUT_CLASS =
  "h-7 px-2 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 placeholder:text-ink-4";

/** Phones — hydrate from the loaded contact.phones. A contact that
 *  predates ContactPhone rows only has the denormalized legacy
 *  Contact.phone: seed the editor from it, otherwise the empty
 *  payload would null that number firm-wide on any save. With
 *  neither, fall back to a single empty row so there's always a
 *  slot the user can fill. */
function initialPhoneDrafts(party: PartyRow, idPrefix: string): PhoneDraft[] {
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
      number: party.phone ?? "",
      isPrimary: true,
    },
  ];
}

/** Only phones that have a number are posted - empty drafts are
 *  ignored (the server drops them as well). */
function serializePhones(phones: PhoneDraft[]): string {
  return JSON.stringify(
    phones
      .filter((p) => p.number.trim().length > 0)
      .map((p) => ({
        label: p.label.trim(),
        number: p.number.trim(),
        isPrimary: p.isPrimary,
      }))
  );
}

export function PartyEditForm({
  party,
  category,
  contacts,
  onDone,
  canEditContact = true,
}: {
  party: PartyRow;
  category: PartyCategory;
  /** All active contacts — feeds the representation typeahead. */
  contacts: ContactOption[];
  onDone: () => void;
  /** Viewer holds contacts.edit. The shared Contact fields (name,
   *  email, organization, phones) are read-only without it: the server
   *  refuses changes to them, so don't invite edits that will bounce. */
  canEditContact?: boolean;
}) {
  const [state, setState] = useState<PartyFormState>(partyInitialState);
  const [isPending, startTransition] = useTransition();

  const showsRepresentation = category !== "client";

  const [contactName, setContactName] = useState(party.name);
  const [contactEmail, setContactEmail] = useState(party.email ?? "");
  const [contactOrganization, setContactOrganization] = useState(
    party.organization ?? ""
  );
  const [role, setRole] = useState(party.role ?? "");
  const [notes, setNotes] = useState(party.notes ?? "");

  const idPrefix = useId();
  const phoneSeq = useRef(0);
  const [phones, setPhones] = useState<PhoneDraft[]>(() =>
    initialPhoneDrafts(party, idPrefix)
  );
  // The list as loaded, posted back so the server can tell what this
  // user changed from what someone else changed in the meantime.
  const [orig] = useState(() => ({
    name: party.name,
    email: party.email ?? "",
    organization: party.organization ?? "",
  }));
  const [origPhonesJson] = useState(() =>
    serializePhones(initialPhoneDrafts(party, idPrefix))
  );

  const addPhone = () => {
    setPhones((prev) => [
      ...prev,
      {
        tempId: `phone-${idPrefix}-${++phoneSeq.current}`,
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

  const phonesJson = serializePhones(phones);
  const [representation, setRepresentation] = useState<RepresentationChoice>(
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
  // The linked rep may be missing from `contacts` (that list is
  // active-only, and the rep Contact can have been deactivated). Build
  // an option from the party's own representation fields so the chip
  // and PICK_EXISTING mode survive — otherwise every save, even a
  // notes-only one, would post create-new and mint a duplicate Contact.
  const linkedRepContact: ContactOption | null = party.representationContactId
    ? (contacts.find((c) => c.id === party.representationContactId) ?? {
        id: party.representationContactId,
        name: party.representationName ?? "Linked attorney",
        organization: party.representationFirm,
        email: party.representationEmail,
        phone: party.representationPhone,
        city: null,
        type: "opposing_counsel",
      })
    : null;
  const [repSelectedId, setRepSelectedId] = useState<string | null>(
    party.representationContactId ?? null
  );
  const [repQuery, setRepQuery] = useState(
    linkedRepContact?.name ?? party.representationName ?? ""
  );
  const [repFirm, setRepFirm] = useState(party.representationFirm ?? "");
  const [repEmail, setRepEmail] = useState(party.representationEmail ?? "");
  const [repPhone, setRepPhone] = useState(party.representationPhone ?? "");
  // After an unlink the chip's button disappears; focus the input that
  // replaces it so keyboard users aren't dropped on <body>.
  const [refocusRep, setRefocusRep] = useState(false);

  const pickRepExisting = (c: ContactOption) => {
    setRepSelectedId(c.id);
    setRepQuery(c.name);
    setRepFirm(c.organization ?? "");
    setRepEmail(c.email ?? "");
    setRepPhone(c.phone ?? "");
  };
  const clearRepSelection = () => {
    setRepSelectedId(null);
    if (party.representationContactId) {
      // FK-linked rep: the saved display fields belong to the linked
      // Contact. Restoring them would put the form in create-new mode
      // carrying that attorney's details, and Save would mint a
      // duplicate Contact. Start from an empty create-new state
      // instead — saving without choosing someone fails with
      // "Attorney name is required".
      setRepQuery("");
      setRepFirm("");
      setRepEmail("");
      setRepPhone("");
    } else {
      // Legacy free-text rep: restore the party's saved fields rather
      // than blanking — an accidental pick + X + save must not
      // overwrite existing representation data with empty strings.
      setRepQuery(party.representationName ?? "");
      setRepFirm(party.representationFirm ?? "");
      setRepEmail(party.representationEmail ?? "");
      setRepPhone(party.representationPhone ?? "");
    }
    setRefocusRep(true);
  };

  const repSelected = repSelectedId
    ? (contacts.find((c) => c.id === repSelectedId) ??
      (repSelectedId === linkedRepContact?.id ? linkedRepContact : null))
    : null;
  const repContactMode = repSelected ? PICK_EXISTING : CREATE_NEW;

  const errs = state.errors ?? {};
  const otherErrors = collectOtherErrors(state.errors, [
    "contactName",
    "phones",
    ...(representation === "yes" && !repSelected
      ? ["newRepresentationName", "representationContactId"]
      : []),
  ]);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updateMatterContact(
        party.id,
        partyInitialState,
        fd
      );
      if (res.status === "ok") onDone();
      else setState(res);
    });
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      {/* Contact values as loaded - lets the server write only what
          this user changed and spot a concurrent edit. */}
      <input type="hidden" name="origContactName" value={orig.name} />
      <input type="hidden" name="origContactEmail" value={orig.email} />
      <input
        type="hidden"
        name="origContactOrganization"
        value={orig.organization}
      />
      <input type="hidden" name="origPhones" value={origPhonesJson} />

      {/* Contact core — edits flow back to the global Contact record
          and affect every matter this contact appears on. */}
      <div className="flex flex-col gap-1.5">
        <div className="text-2xs font-mono uppercase tracking-wider text-ink-4">
          Contact
        </div>
        <input
          type="text"
          name="contactName"
          aria-label="Contact name"
          maxLength={200}
          value={contactName}
          onChange={(e) => setContactName(e.target.value)}
          readOnly={!canEditContact}
          title={canEditContact ? undefined : CONTACT_LOCKED_HINT}
          placeholder="Name"
          className={cn(INPUT_CLASS, errs.contactName && "border-warn")}
        />
        {errs.contactName && (
          <div className="text-2xs text-warn">{errs.contactName[0]}</div>
        )}
        <input
          type="email"
          name="contactEmail"
          aria-label="Contact email"
          maxLength={200}
          value={contactEmail}
          onChange={(e) => setContactEmail(e.target.value)}
          readOnly={!canEditContact}
          title={canEditContact ? undefined : CONTACT_LOCKED_HINT}
          placeholder="Email (optional)"
          className={cn(INPUT_CLASS, errs.contactEmail && "border-warn")}
        />
        <input
          type="text"
          name="contactOrganization"
          aria-label="Contact organization"
          maxLength={200}
          value={contactOrganization}
          onChange={(e) => setContactOrganization(e.target.value)}
          readOnly={!canEditContact}
          title={canEditContact ? undefined : CONTACT_LOCKED_HINT}
          placeholder="Organization (optional)"
          className={INPUT_CLASS}
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
              disabled={!canEditContact}
              className="inline-flex items-center gap-1 text-2xs text-brand-700 hover:underline disabled:opacity-40 disabled:no-underline"
            >
              <Plus size={11} />
              Add phone
            </button>
          </div>
          {phones.length === 0 ? (
            <div className="text-2xs text-ink-4 italic py-1">
              No phones — click &quot;Add phone&quot; to create one.
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
                    disabled={!canEditContact}
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
                    aria-label="Phone label"
                    maxLength={40}
                    value={p.label}
                    onChange={(e) =>
                      updatePhone(p.tempId, { label: e.target.value })
                    }
                    readOnly={!canEditContact}
                    placeholder="Label (Mobile…)"
                    className={INPUT_CLASS}
                  />
                  <input
                    type="tel"
                    aria-label="Phone number"
                    maxLength={80}
                    value={p.number}
                    onChange={(e) =>
                      updatePhone(p.tempId, { number: e.target.value })
                    }
                    readOnly={!canEditContact}
                    placeholder="(303) 555-0000"
                    className={cn(INPUT_CLASS, "font-mono")}
                  />
                  <button
                    type="button"
                    onClick={() => removePhone(p.tempId)}
                    disabled={!canEditContact}
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
          {errs.phones && (
            <div className="text-2xs text-warn">{errs.phones[0]}</div>
          )}
        </div>

        <div className="text-[10px] text-ink-4 leading-relaxed pt-0.5">
          {canEditContact
            ? "Changes here update the contact across every matter they appear on."
            : CONTACT_LOCKED_HINT}
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
            aria-label="Subrole"
            maxLength={80}
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="Subrole (optional)"
            className={cn(INPUT_CLASS, errs.role && "border-warn")}
          />
          <input
            type="text"
            name="notes"
            aria-label="Notes"
            maxLength={4000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes about this party"
            className={cn(INPUT_CLASS, errs.notes && "border-warn")}
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
          <RepresentationToggle
            value={representation}
            onChange={setRepresentation}
          />
          {representation === "yes" && (
            <div className="flex flex-col gap-2">
              {repSelected ? (
                <SelectedContactChip
                  contact={repSelected}
                  unlinkLabel="Unlink representing contact"
                  onUnlink={clearRepSelection}
                />
              ) : (
                <div>
                  <ContactTypeahead
                    contacts={contacts}
                    query={repQuery}
                    onQueryChange={setRepQuery}
                    onPick={pickRepExisting}
                    placeholder="Attorney name — type to search or create"
                    ariaLabel="Attorney name"
                    variant="attorney"
                    compact
                    invalid={Boolean(
                      errs.newRepresentationName ||
                        errs.representationContactId
                    )}
                    autoFocus={refocusRep}
                  />
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
                    aria-label="Attorney firm"
                    maxLength={200}
                    value={repFirm}
                    onChange={(e) => setRepFirm(e.target.value)}
                    placeholder="Firm (optional)"
                    className={INPUT_CLASS}
                  />
                  <input
                    type="email"
                    aria-label="Attorney email"
                    maxLength={200}
                    value={repEmail}
                    onChange={(e) => setRepEmail(e.target.value)}
                    placeholder="Email (optional)"
                    className={cn(
                      INPUT_CLASS,
                      errs.newRepresentationEmail && "border-warn"
                    )}
                  />
                  <input
                    type="tel"
                    aria-label="Attorney phone"
                    maxLength={80}
                    value={repPhone}
                    onChange={(e) => setRepPhone(e.target.value)}
                    placeholder="Phone (optional)"
                    className={cn(INPUT_CLASS, "col-span-2")}
                  />
                </div>
              )}
            </div>
          )}
        </>
      )}

      {otherErrors.length > 0 && (
        <div role="alert" className="text-2xs text-warn">
          {otherErrors.join(" ")}
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
