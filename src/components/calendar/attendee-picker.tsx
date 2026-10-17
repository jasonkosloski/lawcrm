/**
 * Attendee Picker
 *
 * The attendee list editor + autocomplete extracted from
 * EventDetailModal so the standalone event create form
 * (/calendar/events/new) can reuse it verbatim. The modal still
 * imports from here — one implementation, two surfaces.
 *
 * `AttendeePicker` is controlled: it renders `value` and calls
 * `onCommit(next)` with the whole next list on every add/remove.
 * The modal wires `onCommit` straight into its whole-row commit;
 * the create form wires it into local state serialized to a
 * hidden JSON field on submit.
 *
 * The autocomplete searches firm users + contacts server-side
 * (`searchAttendeesAction`) and offers an "Add as new contact"
 * branch for free text — the server action turns that into a real
 * Contact (type=other) on save.
 */

"use client";

import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { searchAttendeesAction } from "@/app/actions/attendee-search";
import { EmailLink } from "@/components/ui/email-link";
import type { AttendeeSearchResult } from "@/lib/queries/attendee-search";

/** A single attendee in the editor. The picker tags each entry
 *  with its source so the action can persist the right FK +
 *  decide whether to create a Contact for the arbitrary case. */
export type EditableAttendee = {
  kind: "user" | "contact" | "new";
  /** Server-side row id, present after the first commit. New
   *  entries before save have no id. */
  attendeeId: string | null;
  /** Set when kind === "user". */
  userId: string | null;
  /** Set when kind === "contact" (or after a "new" save once
   *  the action created the Contact and we re-read). */
  contactId: string | null;
  name: string;
  email: string;
  /** Display extras for the chip — populated when known.
   *  Stripped from the FormData; the action only cares about
   *  kind / userId / contactId / name / email. */
  initials?: string | null;
  jobTitle?: string | null;
  contactType?: string | null;
  status?: string;
};

export const ATTENDEE_STATUS_LABEL: Record<string, string> = {
  accepted: "Accepted",
  declined: "Declined",
  tentative: "Tentative",
  pending: "Pending",
};

// Mapped to a contact `type` field; surfaced as the chip suffix.
export const CONTACT_TYPE_LABEL: Record<string, string> = {
  client: "Client",
  opposing_counsel: "Opposing counsel",
  witness: "Witness",
  expert: "Expert",
  judge: "Judge",
  court: "Court",
  vendor: "Vendor",
  medical_provider: "Medical provider",
  government: "Government",
  other: "Contact",
};

/** Attendee list editor with autocomplete picker. Replace-all on
 *  commit; the action handles the create-Contact-on-arbitrary-add
 *  path. The autocomplete preferentially shows firm users, then
 *  contacts, and finally an "Add as new contact" option for
 *  free-text that doesn't match anything. */
export function AttendeePicker({
  value,
  onCommit,
}: {
  value: EditableAttendee[];
  onCommit: (next: EditableAttendee[]) => void;
}) {
  const remove = (idx: number) => {
    onCommit(value.filter((_, i) => i !== idx));
  };
  const append = (added: EditableAttendee) => {
    onCommit([...value, added]);
  };

  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {value.map((a, i) => (
            <li
              key={a.attendeeId ?? `${a.kind}-${a.name}-${i}`}
              className="flex items-center justify-between text-xs gap-2"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <AttendeeAvatar attendee={a} />
                <div className="flex flex-col leading-tight min-w-0">
                  <span className="text-ink truncate flex items-center gap-1.5">
                    {a.name}
                    {a.kind === "user" && a.jobTitle && (
                      <span className="text-2xs text-ink-4 font-normal">
                        — {a.jobTitle}
                      </span>
                    )}
                    {a.kind === "contact" && a.contactType && (
                      <span className="text-2xs text-ink-4 font-normal">
                        ·{" "}
                        {CONTACT_TYPE_LABEL[a.contactType] ?? a.contactType}
                      </span>
                    )}
                  </span>
                  {a.email && (
                    <EmailLink
                      email={a.email}
                      className="text-2xs text-ink-4 font-mono"
                    />
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {/* Hide the pill for `accepted` (the default for
                    firm-user attendees). RSVP isn't a real flow
                    yet — surfacing "Accepted" next to every
                    teammate would be visual noise. pending /
                    declined / tentative still surface so when
                    RSVP lands the chip lights up automatically. */}
                {a.status && a.status !== "accepted" && (
                  <span className="text-2xs text-ink-3">
                    {ATTENDEE_STATUS_LABEL[a.status] ?? a.status}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => remove(i)}
                  aria-label={`Remove ${a.name}`}
                  className="text-ink-4 hover:text-warn"
                >
                  <X size={12} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <AttendeeAutocomplete
        existing={value}
        onPick={append}
      />
    </div>
  );
}

/** Small avatar rendered next to a chip. Uses initials for users
 *  (firm-internal), a paper square for contacts (external), and
 *  a generic outline for arbitrary entries that don't have a
 *  contact id yet. */
export function AttendeeAvatar({ attendee }: { attendee: EditableAttendee }) {
  if (attendee.kind === "user") {
    return (
      <span className="shrink-0 w-6 h-6 rounded-full bg-brand-soft text-brand-700 text-2xs font-mono font-medium inline-flex items-center justify-center border border-brand-200">
        {attendee.initials ?? attendee.name.charAt(0).toUpperCase()}
      </span>
    );
  }
  return (
    <span className="shrink-0 w-6 h-6 rounded-full bg-paper-2 text-ink-3 text-2xs font-mono font-medium inline-flex items-center justify-center border border-line">
      {attendee.name.charAt(0).toUpperCase()}
    </span>
  );
}

/** Single-input autocomplete that searches firm users + contacts
 *  as the user types. Below the matches sits an "Add as new
 *  contact: <typed>" option when the typed text doesn't exact-
 *  match an existing entry — picking it commits an arbitrary
 *  attendee, which the server-side action turns into a real
 *  Contact (type=other) on save.
 *
 *  Email field is optional + disabled-looking until needed; we
 *  show it only on hover/focus + when the user is in the
 *  add-new branch. Existing-match picks ignore typed email
 *  entirely (the user/contact has its own).
 */
function AttendeeAutocomplete({
  existing,
  onPick,
}: {
  existing: EditableAttendee[];
  onPick: (next: EditableAttendee) => void;
}) {
  const [query, setQuery] = useState("");
  const [email, setEmail] = useState("");
  // The rows come tagged with the query they answer, so rows for an
  // older query are never shown against a newer one.
  const [fetched, setFetched] = useState<{
    q: string;
    rows: AttendeeSearchResult[];
  }>({ q: "", rows: [] });
  const [open, setOpen] = useState(false);
  const [focusedIdx, setFocusedIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  // The trimmed query the user is waiting on. A search response only
  // lands if it still answers THIS query: otherwise a slow response
  // for an old query (or one in flight when a pick cleared the box)
  // re-opens stale suggestions — including the person just added.
  const latestQueryRef = useRef("");

  const trimmedQuery = query.trim();
  // Derived, not stored: only rows that answer the CURRENT query show.
  // An empty or since-edited query has none, so deleting "a" and typing
  // "b" never offers (or lets Enter pick) the old "a" suggestions while
  // the "b" response is still in flight.
  const results =
    trimmedQuery.length > 0 && fetched.q === trimmedQuery ? fetched.rows : [];

  // Compute already-picked ids so the search action excludes
  // duplicates on the server. Names + emails alone aren't
  // reliable for dedup (multiple contacts can share an email).
  const excludeUserIds = existing
    .map((a) => (a.kind === "user" ? a.userId : null))
    .filter((id): id is string => !!id);
  const excludeContactIds = existing
    .map((a) => (a.kind === "contact" ? a.contactId : null))
    .filter((id): id is string => !!id);

  // Debounced search. The 250ms threshold balances "feels
  // instant" against the round-trip cost on every keystroke.
  useEffect(() => {
    const trimmed = query.trim();
    latestQueryRef.current = trimmed;
    if (trimmed.length === 0) return;
    const t = setTimeout(async () => {
      try {
        const r = await searchAttendeesAction(
          trimmed,
          excludeUserIds,
          excludeContactIds
        );
        if (latestQueryRef.current !== trimmed) return; // stale response
        setFetched({ q: trimmed, rows: r });
        setFocusedIdx(0);
      } catch {
        // Search failures are non-blocking — the user can still
        // pick "Add as new contact" or refine the query.
        if (latestQueryRef.current === trimmed) setFetched({ q: trimmed, rows: [] });
      }
    }, 250);
    return () => clearTimeout(t);
    // The exclusion lists are read when the timer fires; re-running on
    // every pick would only re-search the query that was just cleared.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Close dropdown on outside click.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const trimmedEmail = email.trim();
  // Light client-side email check. The server re-validates with
  // the same regex, so this is purely UX (don't enable the
  // commit button until the address looks valid).
  const emailLooksValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail);
  // Show "Add new" option whenever the typed text doesn't have
  // an exact case-insensitive name match in the results.
  const exactMatchExists = results.some(
    (r) => r.name.toLowerCase() === trimmedQuery.toLowerCase()
  );
  const showAddNew = trimmedQuery.length > 0 && !exactMatchExists;
  // The arbitrary-attendee path creates a real Contact row, so
  // it requires an email. Without one the picker still shows
  // the row (so the user knows the option exists) but it's
  // disabled with a "+ email required" hint.
  const addNewEnabled = showAddNew && emailLooksValid;
  // Total selectable rows in the dropdown — used for keyboard
  // navigation bounds.
  const totalRows = results.length + (showAddNew ? 1 : 0);

  const clearInputs = () => {
    // Drop the awaited query first so a response already in flight for
    // it is discarded instead of repopulating the dropdown.
    latestQueryRef.current = "";
    setQuery("");
    setEmail("");
    setFetched({ q: "", rows: [] });
    setOpen(false);
  };

  const pickResult = (r: AttendeeSearchResult) => {
    if (r.kind === "user") {
      onPick({
        kind: "user",
        attendeeId: null,
        userId: r.id,
        contactId: null,
        name: r.name,
        email: r.email,
        initials: r.initials,
        jobTitle: r.jobTitle,
      });
    } else {
      onPick({
        kind: "contact",
        attendeeId: null,
        userId: null,
        contactId: r.id,
        name: r.name,
        email: r.email ?? "",
        contactType: r.type,
      });
    }
    clearInputs();
  };

  const pickAddNew = () => {
    // Both gates are server-enforced too — this is just UX.
    if (!trimmedQuery || !addNewEnabled) return;
    onPick({
      kind: "new",
      attendeeId: null,
      userId: null,
      contactId: null,
      name: trimmedQuery,
      email: trimmedEmail,
    });
    clearInputs();
  };

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    isEmailField: boolean
  ) => {
    if (e.key === "Enter" && isEmailField) {
      // In the email box Enter means "add the typed contact", never
      // "pick the highlighted suggestion" — otherwise typing a new
      // person's address while a partial-name match is showing adds the
      // wrong (existing) person.
      e.preventDefault();
      if (showAddNew && addNewEnabled) pickAddNew();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setFocusedIdx((i) => Math.min(i + 1, totalRows - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (!open || totalRows === 0) {
        // Plain Enter on an empty dropdown should still let the
        // add-new path fire when the user has typed a name AND
        // a valid email.
        if (showAddNew && addNewEnabled) pickAddNew();
        return;
      }
      if (focusedIdx < results.length) {
        pickResult(results[focusedIdx]!);
      } else if (showAddNew && addNewEnabled) {
        pickAddNew();
      }
    } else if (e.key === "Escape") {
      // With the dropdown open, Escape means "dismiss the
      // suggestions" — swallow it so a surrounding modal stays
      // up. With it closed, let the event bubble (the modal's
      // close handler takes it from there).
      if (open) e.stopPropagation();
      setOpen(false);
    }
  };

  const optionId = (i: number) => `${listboxId}-opt-${i}`;
  const dropdownOpen = open && (results.length > 0 || showAddNew);

  return (
    <div ref={containerRef} className="relative">
      <div className="grid grid-cols-[1fr_1fr] gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(query.length > 0)}
          onKeyDown={(e) => handleKeyDown(e, false)}
          placeholder="Add attendee — name, email, or jobTitle…"
          className="h-7 px-2 rounded-md border border-line text-xs text-ink bg-white"
          aria-label="Search attendees"
          role="combobox"
          aria-expanded={dropdownOpen}
          aria-haspopup="listbox"
          aria-autocomplete="list"
          aria-controls={dropdownOpen ? listboxId : undefined}
          aria-activedescendant={
            dropdownOpen
              ? optionId(Math.min(focusedIdx, totalRows - 1))
              : undefined
          }
        />
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => handleKeyDown(e, true)}
          placeholder="Email (for new contact)"
          className="h-7 px-2 rounded-md border border-line text-xs text-ink bg-white font-mono"
          aria-label="Attendee email"
        />
      </div>

      {dropdownOpen && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Attendee suggestions"
          className="absolute left-0 right-0 mt-1 z-50 max-h-64 overflow-y-auto rounded-md border border-line bg-white shadow-md"
        >
          {results.map((r, i) => (
            <li
              key={`${r.kind}-${r.id}`}
              id={optionId(i)}
              role="option"
              aria-selected={i === focusedIdx}
              onMouseEnter={() => setFocusedIdx(i)}
              onClick={() => pickResult(r)}
              className={cn(
                "px-2.5 py-1.5 cursor-pointer flex items-center gap-2",
                i === focusedIdx
                  ? "bg-brand-tint"
                  : "hover:bg-paper-2"
              )}
            >
              <ResultAvatar result={r} />
              <div className="flex flex-col min-w-0 leading-tight flex-1">
                <span className="text-xs text-ink truncate">{r.name}</span>
                <span className="text-2xs text-ink-4 font-mono truncate">
                  {r.kind === "user"
                    ? `${r.jobTitle}${r.email ? ` · ${r.email}` : ""}`
                    : `${CONTACT_TYPE_LABEL[r.type] ?? r.type}${r.organization ? ` · ${r.organization}` : ""}${r.email ? ` · ${r.email}` : ""}`}
                </span>
              </div>
              <span className="text-3xs uppercase tracking-wider text-ink-4 font-mono shrink-0">
                {r.kind === "user" ? "user" : "contact"}
              </span>
            </li>
          ))}
          {showAddNew && (
            <li
              id={optionId(results.length)}
              role="option"
              aria-selected={focusedIdx === results.length}
              aria-disabled={!addNewEnabled}
              onMouseEnter={() => setFocusedIdx(results.length)}
              onClick={() => addNewEnabled && pickAddNew()}
              className={cn(
                "px-2.5 py-1.5 flex items-center gap-2 border-t border-line/60",
                addNewEnabled
                  ? cn(
                      "cursor-pointer",
                      focusedIdx === results.length
                        ? "bg-brand-tint"
                        : "hover:bg-paper-2"
                    )
                  : "cursor-not-allowed opacity-60"
              )}
              title={
                addNewEnabled
                  ? undefined
                  : "Email is required to create a new contact"
              }
            >
              <span className="shrink-0 w-6 h-6 rounded-full bg-paper-2 text-ink-3 text-2xs font-mono inline-flex items-center justify-center border border-dashed border-line">
                +
              </span>
              <div className="flex flex-col leading-tight flex-1 min-w-0">
                <span className="text-xs text-ink truncate">
                  Add as new contact: {trimmedQuery}
                </span>
                <span className="text-2xs text-ink-4 font-mono truncate">
                  {addNewEnabled
                    ? "Creates a Contact (type: other) — links to the firm directory"
                    : "Email required for the new contact"}
                </span>
              </div>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/** Avatar variant for autocomplete result rows. Mirrors
 *  AttendeeAvatar's user / contact treatment, but keyed off the
 *  search-result discriminator (which doesn't have the same
 *  fields as EditableAttendee). */
function ResultAvatar({ result }: { result: AttendeeSearchResult }) {
  if (result.kind === "user") {
    return (
      <span className="shrink-0 w-6 h-6 rounded-full bg-brand-soft text-brand-700 text-2xs font-mono font-medium inline-flex items-center justify-center border border-brand-200">
        {result.initials}
      </span>
    );
  }
  return (
    <span className="shrink-0 w-6 h-6 rounded-full bg-paper-2 text-ink-3 text-2xs font-mono font-medium inline-flex items-center justify-center border border-line">
      {result.name.charAt(0).toUpperCase()}
    </span>
  );
}

/** Serialize the picker's list to the wire format the server
 *  actions read from the form's hidden `attendees` field —
 *  display-only extras (initials / jobTitle / contactType /
 *  status / attendeeId) are stripped so the payload matches the
 *  action's zod schema exactly. */
export function serializeAttendees(list: EditableAttendee[]): string {
  return JSON.stringify(
    list.map((a) => ({
      kind: a.kind,
      userId: a.userId ?? "",
      contactId: a.contactId ?? "",
      name: a.name,
      email: a.email,
    }))
  );
}
