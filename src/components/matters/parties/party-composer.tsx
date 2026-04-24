/**
 * Party Composer — inline "Add a <category>" form.
 *
 * Collapsed to a single-line button that sits at the bottom of each
 * category section on the Parties tab. Expands into a typeahead
 * picker backed by the firm's existing contacts; when nothing
 * matches, the same field becomes the new-contact name and an
 * optional email/phone/organization block appears. A dedicated
 * "Switch to existing" / "Create new" toggle lets the user flip
 * modes explicitly.
 *
 * Submit either reuses the picked Contact id or creates a new
 * Contact inline (both paths go through the same server action).
 */

"use client";

import {
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Plus, UserCheck, UserPlus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { createMatterContact } from "@/app/actions/parties";
import {
  PARTY_CATEGORY_ADD_LABEL,
  partyInitialState,
  type PartyCategory,
  type PartyFormState,
} from "@/lib/party-constants";

const PICK_EXISTING = "__existing__";
const CREATE_NEW = "__new__";

export type ContactOption = {
  id: string;
  name: string;
  organization: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  type: string;
};

const MAX_SUGGESTIONS = 6;

export function PartyComposer({
  matterId,
  category,
  contacts,
}: {
  matterId: string;
  category: PartyCategory;
  contacts: ContactOption[];
}) {
  const action = createMatterContact.bind(null, matterId);
  const [state, formAction, isPending] = useActionState<
    PartyFormState,
    FormData
  >(action, partyInitialState);

  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [role, setRole] = useState("");
  const [notes, setNotes] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [organization, setOrganization] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  const reset = () => {
    setQuery("");
    setSelectedId(null);
    setSuggestionsOpen(false);
    setRole("");
    setNotes("");
    setEmail("");
    setPhone("");
    setOrganization("");
  };

  useEffect(() => {
    if (state.status === "ok") {
      reset();
      setExpanded(false);
    }
  }, [state.status]);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return contacts
      .filter((c) => {
        const inName = c.name.toLowerCase().includes(q);
        const inOrg = c.organization?.toLowerCase().includes(q) ?? false;
        const inEmail = c.email?.toLowerCase().includes(q) ?? false;
        return inName || inOrg || inEmail;
      })
      .slice(0, MAX_SUGGESTIONS);
  }, [query, contacts]);

  // Close the suggestions popover on outside click.
  useEffect(() => {
    if (!suggestionsOpen) return;
    const handler = (e: MouseEvent) => {
      const el = e.target as Node;
      if (
        inputRef.current?.contains(el) ||
        suggestionsRef.current?.contains(el)
      ) {
        return;
      }
      setSuggestionsOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [suggestionsOpen]);

  const pickExisting = (c: ContactOption) => {
    setSelectedId(c.id);
    setQuery(c.name);
    setSuggestionsOpen(false);
  };
  const clearSelection = () => {
    setSelectedId(null);
    setSuggestionsOpen(false);
    inputRef.current?.focus();
  };

  const errs = state.errors ?? {};
  const selected = selectedId
    ? contacts.find((c) => c.id === selectedId)
    : null;
  const contactMode = selected ? PICK_EXISTING : CREATE_NEW;
  const hasContent = selected ? true : query.trim().length > 0;

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className={cn(
          "flex items-center gap-2 h-8 px-3 text-2xs text-ink-4 w-full",
          "rounded-md border border-dashed border-line bg-white",
          "hover:border-brand-300 hover:text-brand-700 transition-colors text-left"
        )}
      >
        <Plus size={12} />
        {PARTY_CATEGORY_ADD_LABEL[category]}
      </button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
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
        <div className="flex items-center gap-2 h-8 px-2.5 rounded-md border border-brand-200 bg-brand-soft/40 text-xs text-ink-2">
          <UserCheck size={13} className="text-brand-700 shrink-0" />
          <span className="font-medium truncate flex-1">
            {selected.name}
          </span>
          {selected.organization && (
            <span className="text-2xs font-mono text-ink-4 truncate">
              {selected.organization}
            </span>
          )}
          <button
            type="button"
            onClick={clearSelection}
            aria-label="Unlink selected contact"
            className="p-0.5 rounded text-ink-3 hover:text-ink-2"
          >
            <X size={12} />
          </button>
        </div>
      ) : (
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            autoComplete="off"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSuggestionsOpen(e.target.value.trim().length > 0);
            }}
            onFocus={() => {
              if (query.trim().length > 0) setSuggestionsOpen(true);
            }}
            placeholder="Name — type to search or create"
            className={cn(
              "h-8 px-2.5 rounded-md border bg-white text-xs text-ink w-full",
              "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
              "placeholder:text-ink-4",
              errs.newContactName || errs.contactId ? "border-warn" : "border-line"
            )}
          />
          {suggestionsOpen && suggestions.length > 0 && (
            <div
              ref={suggestionsRef}
              role="listbox"
              className="absolute left-0 right-0 top-[calc(100%+2px)] z-20 rounded-md border border-line bg-white shadow-md py-1"
            >
              <div className="px-2.5 py-1 text-2xs font-mono uppercase tracking-wider text-ink-4">
                Matching contacts
              </div>
              {suggestions.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => pickExisting(c)}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left hover:bg-brand-tint"
                >
                  <UserCheck size={12} className="text-ink-4 shrink-0" />
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
                {query.trim() && (
                  <span className="text-ink-3 font-medium truncate">
                    {" “"}
                    {query.trim()}
                    {"”"}
                  </span>
                )}
              </div>
            </div>
          )}
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
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email (optional)"
            className={cn(
              "h-7 px-2 rounded-md border bg-white text-xs text-ink",
              "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
              "placeholder:text-ink-4",
              errs.newContactEmail ? "border-warn" : "border-line"
            )}
          />
          <input
            type="tel"
            name="newContactPhone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone (optional)"
            className="h-7 px-2 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 placeholder:text-ink-4"
          />
          <input
            type="text"
            name="newContactOrganization"
            value={organization}
            onChange={(e) => setOrganization(e.target.value)}
            placeholder="Organization (optional)"
            className="h-7 px-2 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 placeholder:text-ink-4 col-span-2"
          />
        </div>
      )}

      {/* Subrole + notes — apply to both picked and new contacts. */}
      <div className="grid grid-cols-[1fr_2fr] gap-2">
        <input
          type="text"
          name="role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          placeholder={rolePlaceholder(category)}
          className="h-7 px-2 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 placeholder:text-ink-4"
        />
        <input
          type="text"
          name="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes about this party's role in the matter (optional)"
          className="h-7 px-2 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 placeholder:text-ink-4"
        />
      </div>

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
        <button
          type="submit"
          disabled={isPending || !hasContent}
          className={cn(
            "inline-flex items-center h-7 px-3 rounded-md text-xs font-medium bg-brand-500 text-white",
            "hover:bg-brand-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          )}
        >
          {isPending ? "Saving…" : "Add party"}
        </button>
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
