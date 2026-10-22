/**
 * Party Composer — inline "Add a <category>" form.
 *
 * Collapsed to a single-line button that sits at the bottom of each
 * category section on the Parties tab. Expands into a typeahead
 * picker backed by the firm's existing contacts; when nothing
 * matches, the same field becomes the new-contact name and an
 * optional email/phone/organization block appears. Picking a match
 * turns the field into a chip; the chip's X unlinks it and returns to
 * create-new mode.
 *
 * Submit either reuses the picked Contact id or creates a new
 * Contact inline (both paths go through the same server action).
 * The action is dispatched from the submit handler (not the form's
 * `action`) so a validation error never resets what the user typed.
 */

"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConflictReview } from "@/components/matters/conflict-review";
import { createMatterContact } from "@/app/actions/parties";
import {
  CREATE_NEW,
  PARTY_CATEGORY_ADD_LABEL,
  PICK_EXISTING,
  partyInitialState,
  type ContactOption,
  type PartyCategory,
  type PartyFormState,
  type RepresentationChoice,
} from "@/lib/party-constants";
import {
  ContactTypeahead,
  RepresentationToggle,
  SelectedContactChip,
  collectOtherErrors,
} from "./party-pickers";
import { inputClass } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

export type { ContactOption };

export function PartyComposer({
  matterId,
  category,
  contacts,
}: {
  matterId: string;
  category: PartyCategory;
  contacts: ContactOption[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState<PartyFormState>(partyInitialState);
  const [isPending, startTransition] = useTransition();

  const showsRepresentation = category !== "client";

  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [role, setRole] = useState("");
  const [notes, setNotes] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [organization, setOrganization] = useState("");
  const [representation, setRepresentation] =
    useState<RepresentationChoice>("unknown");
  // Representation picker — mirrors the main party picker pattern:
  // either select an existing Contact (repSelectedId) or type a name
  // to create a new one inline. The typed query doubles as the new
  // contact's name when nothing is picked.
  const [repQuery, setRepQuery] = useState("");
  const [repSelectedId, setRepSelectedId] = useState<string | null>(null);
  const [repFirm, setRepFirm] = useState("");
  const [repEmail, setRepEmail] = useState("");
  const [repPhone, setRepPhone] = useState("");
  // After an unlink the chip (and its button) disappears; the input
  // that replaces it takes focus so keyboard users aren't dropped on
  // <body>.
  const [refocusName, setRefocusName] = useState(false);
  const [refocusRep, setRefocusRep] = useState(false);

  const reset = () => {
    setState(partyInitialState);
    setQuery("");
    setSelectedId(null);
    setRole("");
    setNotes("");
    setEmail("");
    setPhone("");
    setOrganization("");
    setRepresentation("unknown");
    setRepQuery("");
    setRepSelectedId(null);
    setRepFirm("");
    setRepEmail("");
    setRepPhone("");
    setRefocusName(false);
    setRefocusRep(false);
  };

  const pickExisting = (c: ContactOption) => {
    setSelectedId(c.id);
    setQuery(c.name);
  };
  const clearSelection = () => {
    setSelectedId(null);
    // Also clear the picked name: leaving it in the query would make
    // the next save create a duplicate Contact with the same name.
    setQuery("");
    setRefocusName(true);
  };

  const pickRepExisting = (c: ContactOption) => {
    setRepSelectedId(c.id);
    setRepQuery(c.name);
    // Pre-fill the optional fields from the picked contact so the
    // user can see what they're getting; on submit these are ignored
    // when mode === PICK_EXISTING.
    setRepFirm(c.organization ?? "");
    setRepEmail(c.email ?? "");
    setRepPhone(c.phone ?? "");
  };
  const clearRepSelection = () => {
    setRepSelectedId(null);
    setRepQuery("");
    setRepFirm("");
    setRepEmail("");
    setRepPhone("");
    setRefocusRep(true);
  };

  const errs = state.errors ?? {};
  const selected = selectedId
    ? contacts.find((c) => c.id === selectedId)
    : null;
  const contactMode = selected ? PICK_EXISTING : CREATE_NEW;
  const hasContent = selected ? true : query.trim().length > 0;
  const repSelected = repSelectedId
    ? contacts.find((c) => c.id === repSelectedId)
    : null;
  const repContactMode = repSelected ? PICK_EXISTING : CREATE_NEW;

  // Errors with no inline slot (subrole, notes, phone, org, email,
  // a picked contact's contactId, form-level) get one summary line so
  // a rejected submit never looks like it did nothing.
  const inlineKeys = [
    ...(state.conflict ? ["conflictAck", "conflictOverrideReason"] : []),
    ...(selected ? [] : ["newContactName", "contactId"]),
    ...(representation === "yes" && !repSelected
      ? ["newRepresentationName", "representationContactId"]
      : []),
  ];
  const otherErrors = collectOtherErrors(state.errors, inlineKeys);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await createMatterContact(matterId, partyInitialState, fd);
      if (res.status === "ok") {
        reset();
        setExpanded(false);
      } else {
        setState(res);
      }
    });
  };

  if (!expanded) {
    return (
      <Button
        variant="outline"
        size="sm"
        type="button"
        onClick={() => setExpanded(true)}
        className="flex gap-2 text-2xs text-ink-4 w-full border-dashed hover:border-brand-300 hover:text-brand-700 text-left"
      >
        <Plus size={12} />
        {PARTY_CATEGORY_ADD_LABEL[category]}
      </Button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <input type="hidden" name="category" value={category} />
      <input type="hidden" name="contactMode" value={contactMode} />
      {selected && (
        <input type="hidden" name="contactId" value={selected.id} />
      )}
      {!selected && (
        <input type="hidden" name="newContactName" value={query} />
      )}

      {/* Name / typeahead — or chip when an existing contact is picked. */}
      {selected ? (
        <SelectedContactChip
          contact={selected}
          unlinkLabel="Unlink selected contact"
          onUnlink={clearSelection}
        />
      ) : (
        <div>
          <ContactTypeahead
            contacts={contacts}
            query={query}
            onQueryChange={setQuery}
            onPick={pickExisting}
            placeholder="Name — type to search or create"
            ariaLabel="Party name"
            variant="party"
            invalid={Boolean(errs.newContactName || errs.contactId)}
            autoFocus={refocusName}
          />
          {errs.newContactName && (
            <div className="text-2xs text-warn mt-0.5">
              {errs.newContactName[0]}
            </div>
          )}
          {errs.contactId && (
            <div className="text-2xs text-warn mt-0.5">
              {errs.contactId[0]}
            </div>
          )}
        </div>
      )}

      {/* New-contact details appear only when no existing contact is picked. */}
      {!selected && (
        <div className="grid grid-cols-2 gap-2">
          <input
            type="email"
            name="newContactEmail"
            aria-label="Email"
            maxLength={200}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email (optional)"
            className={cn(
              inputClass(false, "xs"),
              errs.newContactEmail && "border-warn"
            )}
          />
          <input
            type="tel"
            name="newContactPhone"
            aria-label="Phone"
            maxLength={80}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone (optional)"
            className={cn(inputClass(false, "xs"), errs.newContactPhone && "border-warn")}
          />
          <input
            type="text"
            name="newContactOrganization"
            aria-label="Organization"
            maxLength={200}
            value={organization}
            onChange={(e) => setOrganization(e.target.value)}
            placeholder="Organization (optional)"
            className={cn(
              inputClass(false, "xs"),
              "col-span-2",
              errs.newContactOrganization && "border-warn"
            )}
          />
        </div>
      )}

      {/* Subrole + notes — apply to both picked and new contacts. */}
      <div className="grid grid-cols-[1fr_2fr] gap-2">
        <input
          type="text"
          name="role"
          aria-label="Subrole"
          maxLength={80}
          value={role}
          onChange={(e) => setRole(e.target.value)}
          placeholder={rolePlaceholder(category)}
          className={cn(inputClass(false, "xs"), errs.role && "border-warn")}
        />
        <input
          type="text"
          name="notes"
          aria-label="Notes"
          maxLength={4000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes about this party's role in the matter (optional)"
          className={cn(inputClass(false, "xs"), errs.notes && "border-warn")}
        />
      </div>

      {/* Representation — non-client categories only. */}
      {showsRepresentation && (
        <>
          <input
            type="hidden"
            name="representation"
            value={representation}
          />
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
          <div className="pt-1">
            <RepresentationToggle
              value={representation}
              onChange={setRepresentation}
            />
          </div>
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

              {/* New-rep optional fields — hidden when an existing
                  contact is picked, since those values come from the
                  joined Contact row instead. */}
              {!repSelected && (
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    aria-label="Attorney firm"
                    maxLength={200}
                    value={repFirm}
                    onChange={(e) => setRepFirm(e.target.value)}
                    placeholder="Firm (optional)"
                    className={inputClass(false, "xs")}
                  />
                  <input
                    type="email"
                    aria-label="Attorney email"
                    maxLength={200}
                    value={repEmail}
                    onChange={(e) => setRepEmail(e.target.value)}
                    placeholder="Email (optional)"
                    className={cn(
                      inputClass(false, "xs"),
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
                    className={cn(inputClass(false, "xs"), "col-span-2")}
                  />
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Conflict gate (ADR-054), opposing parties and co-clients.
          Keyed by fingerprint so a new result never inherits an old
          tick. */}
      {state.conflict && (
        <ConflictReview
          key={state.conflict.fingerprint}
          conflict={state.conflict}
          checked={
            category === "client"
              ? "this client against adverse parties on other matters"
              : "this opposing party and its counsel against the firm's clients"
          }
          reasonError={errs.conflictOverrideReason}
          staleError={errs.conflictAck}
        />
      )}

      {otherErrors.length > 0 && (
        <div role="alert" className="text-2xs text-warn">
          {otherErrors.join(" ")}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            reset();
            setExpanded(false);
          }}
          className="text-2xs text-ink-3 hover:text-ink-2 px-2"
        >
          Cancel
        </button>
        <Button
          size="xs"
          type="submit"
          disabled={isPending || !hasContent}
        >
          {isPending ? "Saving…" : "Add party"}
        </Button>
      </div>
    </form>
  );
}

function rolePlaceholder(category: PartyCategory): string {
  switch (category) {
    case "client":
      return "Subrole (plaintiff, petitioner…)";
    case "opposing":
      return "Subrole (defendant, opposing counsel…)";
    case "lay_witness":
      return "Subrole (eyewitness, custodian…)";
    case "expert_witness":
      return "Subrole (economist, medical expert…)";
    default:
      return "Subrole (optional)";
  }
}
