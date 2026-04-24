/**
 * Notes tab — client-side list with search + type filter + pinned
 * toggle. Notes come from the server pre-sorted (pinned first, then
 * most-recently updated); we only filter in-memory here.
 *
 * Search runs over a plain-text extraction of each note's HTML
 * content plus the author's name. Matches are case-insensitive.
 */

"use client";

import { useMemo, useState } from "react";
import { Pin, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { NoteCard, type NoteCardNote } from "./note-card";
import {
  NOTE_TYPES,
  NOTE_TYPE_LABEL,
  type NoteType,
} from "@/lib/note-constants";

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function NotesTabBody({ notes }: { notes: NoteCardNote[] }) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<Set<NoteType>>(new Set());
  const [pinnedOnly, setPinnedOnly] = useState(false);

  const toggleType = (t: NoteType) => {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return notes.filter((n) => {
      if (pinnedOnly && !n.isPinned) return false;
      if (typeFilter.size > 0 && !typeFilter.has(n.type as NoteType))
        return false;
      if (q.length > 0) {
        const hay = (stripHtml(n.content) + " " + n.authorName).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [notes, query, typeFilter, pinnedOnly]);

  const typesWithCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const n of notes) counts[n.type] = (counts[n.type] ?? 0) + 1;
    return counts;
  }, [notes]);

  const pinnedCount = notes.filter((n) => n.isPinned).length;
  const anyActive =
    query.length > 0 || typeFilter.size > 0 || pinnedOnly;

  return (
    <div className="flex flex-col gap-3">
      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-64 max-w-sm">
          <Search
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-4"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search notes…"
            className={cn(
              "h-7 pl-7 pr-7 rounded-md border border-line bg-white text-xs text-ink w-full",
              "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
              "placeholder:text-ink-4"
            )}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-4 hover:text-ink-2"
            >
              <X size={12} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1">
          {NOTE_TYPES.map((t) => {
            const on = typeFilter.has(t);
            const c = typesWithCounts[t] ?? 0;
            return (
              <button
                key={t}
                type="button"
                onClick={() => toggleType(t)}
                disabled={c === 0 && !on}
                className={cn(
                  "inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-2xs font-medium border transition-colors",
                  on
                    ? "bg-brand-soft text-brand-700 border-brand-200"
                    : "bg-white text-ink-3 border-line hover:text-brand-700 hover:border-brand-300",
                  c === 0 && !on && "opacity-40 cursor-not-allowed"
                )}
              >
                {NOTE_TYPE_LABEL[t]}
                <span className="font-mono text-[10px] text-ink-4">{c}</span>
              </button>
            );
          })}
        </div>

        {pinnedCount > 0 && (
          <button
            type="button"
            onClick={() => setPinnedOnly((p) => !p)}
            aria-pressed={pinnedOnly}
            className={cn(
              "inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-2xs font-medium border transition-colors",
              pinnedOnly
                ? "bg-brand-soft text-brand-700 border-brand-200"
                : "bg-white text-ink-3 border-line hover:text-brand-700 hover:border-brand-300"
            )}
          >
            <Pin
              size={11}
              className={pinnedOnly ? "fill-brand-500 text-brand-500" : ""}
            />
            Pinned only
            <span className="font-mono text-[10px] text-ink-4">
              {pinnedCount}
            </span>
          </button>
        )}

        {anyActive && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setTypeFilter(new Set());
              setPinnedOnly(false);
            }}
            className="text-2xs text-brand-700 hover:underline"
          >
            Clear filters
          </button>
        )}

        <span className="text-2xs text-ink-4 ml-auto">
          {filtered.length === notes.length
            ? `${notes.length} note${notes.length === 1 ? "" : "s"}`
            : `${filtered.length} of ${notes.length}`}
        </span>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-xs text-ink-4">
            {anyActive
              ? "No notes match these filters."
              : "No notes on this matter yet — write the first one above."}
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((n) => (
            <NoteCard key={n.id} note={n} />
          ))}
        </div>
      )}
    </div>
  );
}
