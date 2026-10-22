/**
 * Contact-detail kebab with the merge flow.
 *
 * "Merge into another contact…" (contacts.merge holders only — the
 * page doesn't render this component otherwise) opens a two-step
 * dialog: pick the surviving contact via a SERVER-side typeahead
 * (`searchMergeCandidatesAction` - name / organization / email, so
 * every active contact is reachable however large the directory is),
 * then confirm a summary of what moves. Each suggestion and the chosen
 * chip show type, phone and email next to the name so two records
 * called "John Smith" can be told apart. Submits
 * `mergeContacts(loserId, survivorId)` — THIS contact is the one that
 * gets retired — and navigates to the survivor. When the server finds
 * the two records on opposite sides of a matter it refuses until the
 * user confirms ("Merge anyway").
 */

"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Merge, MoreHorizontal, UserCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { formatPhone } from "@/lib/format-phone";
import { CONTACT_TYPE_LABEL } from "@/lib/contact-constants";
import {
  mergeContacts,
  searchMergeCandidatesAction,
} from "@/app/actions/contacts";
import type { MergeCandidateOption } from "@/lib/queries/contacts";
import { inputClass } from "@/components/ui/field";

const SEARCH_DEBOUNCE_MS = 200;

/** "Client · (303) 555-1212 · dana@example.com" - the bits that tell
 *  same-named records apart. */
function candidateDetail(c: MergeCandidateOption): string {
  return [
    CONTACT_TYPE_LABEL[c.type as keyof typeof CONTACT_TYPE_LABEL] ?? c.type,
    c.phone ? formatPhone(c.phone) : null,
    c.email,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function ContactMergeMenu({
  contactId,
  contactName,
}: {
  contactId: string;
  contactName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<MergeCandidateOption[]>([]);
  const [selected, setSelected] = useState<MergeCandidateOption | null>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when the server found the two records on opposite sides of a
  // matter: the next click on "Merge anyway" sends the confirmation.
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [pending, startTransition] = useTransition();

  // Debounce timer + a sequence number so a slow response for an old
  // query can't overwrite the suggestions for the current one.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  const onOpenChange = (next: boolean) => {
    if (next) {
      setQuery("");
      setSuggestions([]);
      setSelected(null);
      setSuggestionsOpen(false);
      setError(null);
      setNeedsConfirm(false);
    } else if (timer.current) {
      clearTimeout(timer.current);
    }
    seq.current += 1;
    setOpen(next);
  };

  const onQueryChange = (value: string) => {
    setQuery(value);
    const q = value.trim();
    seq.current += 1;
    const mine = seq.current;
    if (timer.current) clearTimeout(timer.current);
    if (!q) {
      setSuggestions([]);
      setSuggestionsOpen(false);
      return;
    }
    setSuggestionsOpen(true);
    timer.current = setTimeout(async () => {
      try {
        const rows = await searchMergeCandidatesAction(contactId, q);
        if (seq.current === mine) setSuggestions(rows);
      } catch {
        if (seq.current === mine) setSuggestions([]);
      }
    }, SEARCH_DEBOUNCE_MS);
  };

  const merge = (confirmOppositeSides: boolean) => {
    if (!selected) return;
    startTransition(async () => {
      const res = await mergeContacts(
        contactId,
        selected.id,
        confirmOppositeSides ? { confirmOppositeSides: true } : undefined
      );
      if (res.ok) {
        setOpen(false);
        router.push(`/contacts/${selected.id}`);
      } else {
        setNeedsConfirm(res.code === "opposite_sides");
        setError(res.error ?? "Merge failed");
      }
    });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label="More contact actions"
              className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-line text-ink-3 hover:bg-paper-2 hover:text-ink"
            >
              <MoreHorizontal size={14} />
            </button>
          }
        />
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuItem onClick={() => onOpenChange(true)}>
            <Merge size={13} />
            Merge into another contact…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Merge contact</DialogTitle>
            <DialogDescription>
              Pick the record that survives.{" "}
              <span className="text-ink-2">{contactName}</span> will be
              merged into it and retired.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            {selected ? (
              <div className="flex items-start gap-2 min-h-8 px-2.5 py-1.5 rounded-md border border-brand-200 bg-brand-soft/40 text-xs text-ink-2">
                <UserCheck
                  size={13}
                  className="text-brand-700 shrink-0 mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">
                    {selected.name}
                    {selected.organization && (
                      <span className="ml-2 text-2xs font-mono font-normal text-ink-4">
                        {selected.organization}
                      </span>
                    )}
                  </div>
                  <div className="text-2xs text-ink-3 truncate">
                    {candidateDetail(selected)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(null);
                    setQuery("");
                    setSuggestions([]);
                    setError(null);
                    setNeedsConfirm(false);
                  }}
                  aria-label="Clear selected contact"
                  className="p-0.5 rounded text-ink-3 hover:text-ink-2"
                >
                  <X size={12} />
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="text"
                  autoComplete="off"
                  autoFocus
                  value={query}
                  onChange={(e) => onQueryChange(e.target.value)}
                  onFocus={() => {
                    if (query.trim().length > 0) setSuggestionsOpen(true);
                  }}
                  aria-label="Search contacts to merge into"
                  placeholder="Merge into… type to search contacts"
                  className={cn(inputClass(), "w-full")}
                />
                {suggestionsOpen && suggestions.length > 0 && (
                  <div
                    role="listbox"
                    className="absolute left-0 right-0 top-[calc(100%+2px)] z-20 rounded-md border border-line bg-white shadow-md py-1"
                  >
                    {suggestions.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        role="option"
                        aria-selected={false}
                        onClick={() => {
                          setSelected(c);
                          setSuggestionsOpen(false);
                          setError(null);
                          setNeedsConfirm(false);
                        }}
                        className="w-full flex items-start gap-2 px-2.5 py-1.5 text-xs text-left hover:bg-brand-tint"
                      >
                        <UserCheck
                          size={12}
                          className="text-ink-4 shrink-0 mt-0.5"
                        />
                        <span className="flex-1 min-w-0">
                          <span className="flex items-center gap-2">
                            <span className="font-medium text-ink truncate">
                              {c.name}
                            </span>
                            {c.organization && (
                              <span className="text-2xs font-mono text-ink-4 truncate ml-auto">
                                {c.organization}
                              </span>
                            )}
                          </span>
                          <span className="block text-2xs text-ink-3 truncate">
                            {candidateDetail(c)}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {selected && (
              <div className="text-xs text-ink-3 rounded-md border border-line bg-paper-2 px-3 py-2 leading-relaxed">
                <div className="font-medium text-ink mb-1">
                  What happens:
                </div>
                <ul className="list-disc pl-4 flex flex-col gap-0.5">
                  <li>
                    Matters, party roles, leads, message threads, calendar
                    invites, and invoices on{" "}
                    <span className="text-ink-2">{contactName}</span> move to{" "}
                    <span className="text-ink-2">{selected.name}</span>
                    {" "}({candidateDetail(selected)}).
                  </li>
                  <li>
                    Phone numbers move too; duplicates are dropped and{" "}
                    <span className="text-ink-2">{selected.name}</span>
                    &apos;s primary stays primary.
                  </li>
                  <li>
                    Missing email / organization / address on{" "}
                    <span className="text-ink-2">{selected.name}</span> is
                    filled in from this contact, and its internal notes and
                    conflict flag carry over.
                  </li>
                  <li>
                    <span className="text-ink-2">{contactName}</span> is
                    retired and this page will redirect to the surviving
                    record. This is hard to undo.
                  </li>
                </ul>
              </div>
            )}

            {error && (
              <div className="text-xs text-warn px-3 py-2 rounded-md bg-warn-soft border border-warn-border">
                {error}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            {needsConfirm ? (
              <Button
                type="button"
                variant="destructive"
                onClick={() => merge(true)}
                disabled={pending || !selected}
              >
                {pending ? "Merging…" : "Merge anyway"}
              </Button>
            ) : (
              <Button
                type="button"
                onClick={() => merge(false)}
                disabled={pending || !selected}
              >
                {pending ? "Merging…" : "Merge contacts"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
