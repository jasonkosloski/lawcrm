/**
 * Contact-detail kebab with the merge flow.
 *
 * "Merge into another contact…" (contacts.merge holders only — the
 * page doesn't render this component otherwise) opens a two-step
 * dialog: pick the surviving contact via typeahead (same idiom as
 * the log-call composer's picker), then confirm a summary of what
 * moves. Submits `mergeContacts(loserId, survivorId)` — THIS contact
 * is the one that gets retired — and navigates to the survivor.
 */

"use client";

import { useMemo, useState, useTransition } from "react";
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
import { mergeContacts } from "@/app/actions/contacts";
import type { ContactPickerOption } from "@/lib/queries/contacts";

export function ContactMergeMenu({
  contactId,
  contactName,
  candidates,
}: {
  contactId: string;
  contactName: string;
  /** Merge-target options — the caller excludes this contact. */
  candidates: ContactPickerOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ContactPickerOption | null>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onOpenChange = (next: boolean) => {
    if (next) {
      setQuery("");
      setSelected(null);
      setSuggestionsOpen(false);
      setError(null);
    }
    setOpen(next);
  };

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return candidates
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.organization ?? "").toLowerCase().includes(q)
      )
      .slice(0, 6);
  }, [query, candidates]);

  const merge = () => {
    if (!selected) return;
    startTransition(async () => {
      const res = await mergeContacts(contactId, selected.id);
      if (res.ok) {
        setOpen(false);
        router.push(`/contacts/${selected.id}`);
      } else {
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
                  onClick={() => {
                    setSelected(null);
                    setQuery("");
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
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setSuggestionsOpen(e.target.value.trim().length > 0);
                  }}
                  onFocus={() => {
                    if (query.trim().length > 0) setSuggestionsOpen(true);
                  }}
                  placeholder="Merge into… type to search contacts"
                  className={cn(
                    "h-8 px-2.5 rounded-md border border-line bg-white text-xs text-ink w-full",
                    "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
                    "placeholder:text-ink-4"
                  )}
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
                        onClick={() => {
                          setSelected(c);
                          setSuggestionsOpen(false);
                        }}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left hover:bg-brand-tint"
                      >
                        <UserCheck size={12} className="text-ink-4 shrink-0" />
                        <span className="font-medium text-ink truncate">
                          {c.name}
                        </span>
                        {c.organization && (
                          <span className="text-2xs font-mono text-ink-4 truncate ml-auto">
                            {c.organization}
                          </span>
                        )}
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
                    <span className="text-ink-2">{selected.name}</span>.
                  </li>
                  <li>
                    Phone numbers move too; duplicates are dropped and{" "}
                    <span className="text-ink-2">{selected.name}</span>
                    &apos;s primary stays primary.
                  </li>
                  <li>
                    Missing email / organization / address on{" "}
                    <span className="text-ink-2">{selected.name}</span> is
                    filled in from this contact.
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
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={merge}
              disabled={pending || !selected}
            >
              {pending ? "Merging…" : "Merge contacts"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
