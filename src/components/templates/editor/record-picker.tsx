/**
 * Search for a real matter or lead to preview a draft against. Results
 * come from `searchTemplatePreviewRecords`, which applies the viewer's
 * matter/lead access scoping on the server.
 */

"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { searchTemplatePreviewRecords } from "@/app/actions/document-templates";
import { inputClass } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RecordScope } from "@/lib/record-scope";
import type { AppliesTo } from "@/lib/templates/schema";

export type PickedRecord = { scope: RecordScope; label: string };

const KIND_WORD = { matter: "Matter", lead: "Lead" } as const;

export function RecordPicker({
  appliesTo,
  onPick,
  onCancel,
}: {
  appliesTo: AppliesTo;
  onPick: (r: PickedRecord) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{
    query: string;
    hits: PickedRecord[] | null;
    error?: string;
  } | null>(null);
  const q = query.trim();

  useEffect(() => {
    if (q.length < 2) return;
    let live = true;
    const t = setTimeout(() => {
      searchTemplatePreviewRecords(q, appliesTo).then(
        (hits) => {
          if (live) setResults({ query: q, hits });
        },
        () => {
          if (live) setResults({ query: q, hits: null, error: "Search failed — try again." });
        },
      );
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, appliesTo]);

  const current = q.length >= 2 && results?.query === q ? results : null;
  const hits = current?.hits ?? null;
  const what = appliesTo === "lead" ? "lead" : appliesTo === "matter" ? "matter" : "matter or lead";

  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-white p-2">
      <div className="relative">
        <Search
          size={12}
          className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-4"
          aria-hidden="true"
        />
        <input
          autoFocus
          aria-label={`Search for a ${what}`}
          placeholder={`Search for a ${what}`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={cn(inputClass(), "w-full pl-7")}
        />
      </div>
      {current?.error && <p className="px-1 text-xs text-warn">{current.error}</p>}
      {hits && hits.length === 0 && <p className="px-1 text-xs text-ink-4">No matches.</p>}
      {hits && hits.length > 0 && (
        <ul className="max-h-64 overflow-y-auto">
          {hits.map((h) => (
            <li
              key={`${h.scope.kind}:${h.scope.kind === "matter" ? h.scope.matterId : h.scope.leadId}`}
            >
              <button
                type="button"
                onClick={() => onPick(h)}
                className="flex w-full items-baseline justify-between gap-2 rounded px-2 py-1 text-left text-xs hover:bg-paper-2"
              >
                <span className="truncate text-ink-2">{h.label}</span>
                <span className="shrink-0 text-2xs text-ink-4">{KIND_WORD[h.scope.kind]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Button variant="ghost" size="xs" className="self-end" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}
