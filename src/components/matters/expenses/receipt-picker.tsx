/**
 * Receipt picker — the expense form's "Receipt" control.
 *
 * Search-as-you-type over the matter's documents (newest first), so a
 * matter with thousands of files can still attach any of them; the
 * page no longer ships a capped list of names. Single-select: the
 * choice posts as the hidden `receiptDocumentId` the expense actions
 * parse ("" = no receipt), and the server re-checks it belongs to the
 * matter (resolveReceiptDocumentId).
 */

"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Paperclip, Search, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  searchReceiptDocuments,
  type ReceiptCandidate,
} from "@/app/actions/expenses";

export function ReceiptPicker({
  id,
  matterId,
  documentId,
  documentName,
  onChange,
}: {
  /** id of the trigger, so the field's label names it. */
  id: string;
  matterId: string;
  /** "" = no receipt. */
  documentId: string;
  /** Label for the current choice; "" when unknown. */
  documentName: string;
  onChange: (documentId: string, documentName: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [docs, setDocs] = useState<ReceiptCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Search the matter's documents while the popover is open.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const t = setTimeout(() => {
      searchReceiptDocuments(matterId, query)
        .then((rows) => {
          if (!cancelled) {
            setDocs(rows);
            setError(null);
          }
        })
        .catch(() => {
          if (!cancelled) setError("Couldn't load documents.");
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, matterId, query]);

  const pick = (doc: ReceiptCandidate) => {
    onChange(doc.id, doc.name);
    setOpen(false);
  };

  return (
    <div className="flex items-center gap-1">
      <input type="hidden" name="receiptDocumentId" value={documentId} />
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setQuery("");
        }}
      >
        <PopoverTrigger
          render={
            <button
              type="button"
              id={id}
              className="flex-1 min-w-0 h-8 px-2.5 inline-flex items-center gap-1.5 rounded-md border border-line bg-white text-xs text-left focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30"
            >
              {documentId ? (
                <>
                  <Paperclip size={11} className="text-ink-4 shrink-0" />
                  <span className="flex-1 truncate text-ink">
                    {documentName || "Current receipt"}
                  </span>
                </>
              ) : (
                <span className="flex-1 truncate text-ink-4">No receipt</span>
              )}
              <ChevronDown size={12} className="text-ink-4 shrink-0" />
            </button>
          }
        />
        <PopoverContent align="start" className="w-80">
          <div className="flex flex-col gap-2">
            <div className="relative">
              <Search
                size={12}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-4"
              />
              <input
                type="text"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search this matter's documents…"
                aria-label="Search documents"
                className="h-8 w-full pl-7 pr-2 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 placeholder:text-ink-4"
              />
            </div>
            <ul className="flex flex-col gap-px max-h-64 overflow-y-auto">
              {docs === null && !error && (
                <li className="text-2xs text-ink-4 px-2 py-1.5">Loading…</li>
              )}
              {docs?.length === 0 && (
                <li className="text-2xs text-ink-4 italic px-2 py-1.5">
                  {query.trim()
                    ? "No documents match."
                    : "No documents on this matter yet. Upload the receipt on the Documents tab."}
                </li>
              )}
              {docs?.map((d) => {
                const selected = d.id === documentId;
                return (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => pick(d)}
                      className={cn(
                        "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-left transition-colors hover:bg-paper-2",
                        selected ? "text-brand-700 font-medium" : "text-ink"
                      )}
                    >
                      <span className="flex-1 truncate">{d.name}</span>
                      {selected && (
                        <span className="text-2xs text-ink-4 shrink-0">Selected</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            {error && <div className="text-2xs text-warn">{error}</div>}
          </div>
        </PopoverContent>
      </Popover>
      {documentId && (
        <button
          type="button"
          onClick={() => onChange("", "")}
          aria-label="Remove receipt"
          className="inline-flex items-center justify-center w-6 h-6 rounded text-ink-4 hover:text-ink-2"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}
