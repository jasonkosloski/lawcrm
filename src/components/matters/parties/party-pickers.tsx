/**
 * Shared pickers for the Parties tab (composer + edit form).
 *
 *   - ContactTypeahead: a combobox over the firm's contacts. Enter
 *     never submits the surrounding form (it only picks the
 *     highlighted match), arrow keys move through matches, Escape
 *     closes. The list renders in flow under the input, not as an
 *     absolutely positioned popover, so the Card / Table overflow
 *     clipping can't hide matches or the "create" footer.
 *   - SelectedContactChip: the "linked contact" chip with an unlink X.
 *   - RepresentationToggle: Unknown / Yes / Pro se with pressed state.
 *
 * One implementation so a fix (keyboard handling, ARIA, sorting)
 * lands everywhere at once.
 */

"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { UserCheck, UserPlus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  ContactOption,
  RepresentationChoice,
} from "@/lib/party-constants";

const MAX_SUGGESTIONS = 6;

/** Contacts matching `query` by name / organization / email. The
 *  attorney variant sorts attorney-shaped contacts (opposing_counsel,
 *  other) first so picking the right rep is fast. */
export function matchContacts(
  contacts: ContactOption[],
  query: string,
  variant: "party" | "attorney"
): ContactOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const matches = contacts.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      (c.organization?.toLowerCase().includes(q) ?? false) ||
      (c.email?.toLowerCase().includes(q) ?? false)
  );
  if (variant === "attorney") {
    const attorneyish = (c: ContactOption) =>
      c.type === "opposing_counsel" || c.type === "other";
    matches.sort((a, b) => Number(attorneyish(b)) - Number(attorneyish(a)));
  }
  return matches.slice(0, MAX_SUGGESTIONS);
}

export function ContactTypeahead({
  contacts,
  query,
  onQueryChange,
  onPick,
  placeholder,
  ariaLabel,
  variant,
  invalid = false,
  autoFocus = false,
  compact = false,
}: {
  contacts: ContactOption[];
  query: string;
  onQueryChange: (value: string) => void;
  onPick: (contact: ContactOption) => void;
  placeholder: string;
  ariaLabel: string;
  variant: "party" | "attorney";
  invalid?: boolean;
  /** Focus the input on mount (used after unlinking a chip, whose
   *  button vanishes and would otherwise drop focus to <body>). */
  autoFocus?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  const suggestions = useMemo(
    () => matchContacts(contacts, query, variant),
    [contacts, query, variant]
  );
  const listVisible = open && suggestions.length > 0;
  const optionId = (i: number) => `${listId}-opt-${i}`;

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const pick = (c: ContactOption) => {
    setOpen(false);
    setActive(-1);
    onPick(c);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      // Never submit the form from the picker. Enter picks only the
      // match the user arrowed to; with nothing highlighted it does
      // nothing, so a partial name can't create a junk Contact.
      e.preventDefault();
      if (listVisible && active >= 0 && suggestions[active]) {
        pick(suggestions[active]);
      }
      return;
    }
    if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        setActive(-1);
      }
      return;
    }
    if (e.key === "Tab") {
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (suggestions.length === 0) return;
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(e.key === "ArrowDown" ? 0 : suggestions.length - 1);
        return;
      }
      const delta = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + delta + suggestions.length) % suggestions.length);
    }
  };

  return (
    <div ref={rootRef} className="flex flex-col gap-1">
      <input
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={listVisible}
        aria-controls={listVisible ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={
          listVisible && active >= 0 ? optionId(active) : undefined
        }
        aria-invalid={invalid || undefined}
        autoComplete="off"
        autoFocus={autoFocus}
        maxLength={200}
        value={query}
        onChange={(e) => {
          onQueryChange(e.target.value);
          setActive(-1);
          setOpen(e.target.value.trim().length > 0);
        }}
        onFocus={() => {
          if (query.trim().length > 0) setOpen(true);
        }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={cn(
          compact ? "h-7 px-2" : "h-8 px-2.5",
          "rounded-md border bg-white text-xs text-ink w-full",
          "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
          "placeholder:text-ink-4",
          invalid ? "border-warn" : "border-line"
        )}
      />
      {listVisible && (
        <div className="rounded-md border border-line bg-white shadow-sm py-1">
          <div className="px-2.5 py-1 text-2xs font-medium text-ink-3">
            Matching contacts
          </div>
          <div role="listbox" id={listId} aria-label="Matching contacts">
            {suggestions.map((c, i) => (
              <div
                key={c.id}
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                // Keep focus in the input so a click doesn't blur it
                // before the pick registers.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(c)}
                className={cn(
                  "w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left cursor-pointer",
                  i === active ? "bg-brand-tint" : "hover:bg-brand-tint"
                )}
              >
                <UserCheck size={12} className="text-ink-4 shrink-0" />
                <span className="font-medium text-ink">{c.name}</span>
                {c.organization && (
                  <span className="text-2xs font-mono text-ink-4 truncate">
                    · {c.organization}
                  </span>
                )}
                {variant === "party" && c.city && (
                  <span className="text-2xs font-mono text-ink-4 ml-auto shrink-0">
                    {c.city}
                  </span>
                )}
                {variant === "attorney" && (
                  <span className="text-2xs font-mono text-ink-4 ml-auto shrink-0 capitalize">
                    {c.type.replace(/_/g, " ")}
                  </span>
                )}
              </div>
            ))}
          </div>
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
    </div>
  );
}

/** The "linked contact" chip: name, organization, and an unlink X. */
export function SelectedContactChip({
  contact,
  unlinkLabel,
  onUnlink,
}: {
  contact: ContactOption;
  unlinkLabel: string;
  onUnlink: () => void;
}) {
  return (
    <div className="flex items-center gap-2 h-8 px-2.5 rounded-md border border-brand-200 bg-brand-soft/40 text-xs text-ink-2">
      <UserCheck size={13} className="text-brand-700 shrink-0" />
      <span className="font-medium truncate flex-1">{contact.name}</span>
      {contact.organization && (
        <span className="text-2xs font-mono text-ink-4 truncate">
          {contact.organization}
        </span>
      )}
      <button
        type="button"
        onClick={onUnlink}
        aria-label={unlinkLabel}
        className="p-0.5 rounded text-ink-3 hover:text-ink-2"
      >
        <X size={12} />
      </button>
    </div>
  );
}

/** Unknown / Yes / Pro se, exposing which one is pressed. */
export function RepresentationToggle({
  value,
  onChange,
}: {
  value: RepresentationChoice;
  onChange: (next: RepresentationChoice) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-2xs font-medium text-ink-3">
        Represented
      </span>
      <div
        role="group"
        aria-label="Represented"
        className="inline-flex items-center gap-0.5 rounded-md border border-line bg-white p-0.5"
      >
        {(["unknown", "yes", "no"] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={value === v}
            onClick={() => onChange(v)}
            className={cn(
              "text-2xs font-medium px-2 py-0.5 rounded transition-colors",
              value === v
                ? "bg-paper-2 text-ink"
                : "text-ink-3 hover:text-brand-700"
            )}
          >
            {v === "unknown" ? "Unknown" : v === "yes" ? "Yes" : "Pro se"}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Messages for field errors that aren't rendered inline next to
 *  their input, so a rejected submit never looks like it did nothing. */
export function collectOtherErrors(
  errors: Record<string, string[]> | undefined,
  inlineKeys: string[]
): string[] {
  if (!errors) return [];
  return Object.entries(errors)
    .filter(([key]) => !inlineKeys.includes(key))
    .map(([, messages]) => messages[0])
    .filter((m): m is string => Boolean(m));
}
