/**
 * Notes tab — client-side list with search + type filter + pinned
 * toggle, rendered as threads (a parent note plus its replies
 * nested beneath). Notes come from the server sorted pinned-first /
 * oldest-to-newest so threads read top-down naturally.
 *
 * Filter applies to individual notes but a thread stays visible
 * when any note in it matches — that way searching for a term in a
 * reply still shows you the parent context.
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

type Thread = { parent: NoteCardNote; replies: NoteCardNote[] };

function buildThreads(notes: NoteCardNote[]): Thread[] {
  const ids = new Set(notes.map((n) => n.id));
  const byParent = new Map<string, NoteCardNote[]>();
  const roots: NoteCardNote[] = [];
  for (const n of notes) {
    // A note is a root if it has no parent OR the parent isn't in this
    // matter's set (edge case — cascade deletes should keep this clean).
    if (n.parentNoteId && ids.has(n.parentNoteId)) {
      if (!byParent.has(n.parentNoteId)) byParent.set(n.parentNoteId, []);
      byParent.get(n.parentNoteId)!.push(n);
    } else {
      roots.push(n);
    }
  }
  // Pinned roots first; within each group the server already sorted
  // oldest-to-newest, but roots look best newest-to-oldest at the top.
  const pinned = roots.filter((r) => r.isPinned);
  const rest = roots.filter((r) => !r.isPinned).reverse();
  return [...pinned, ...rest].map((parent) => ({
    parent,
    replies: byParent.get(parent.id) ?? [],
  }));
}

export function NotesTabBody({
  notes,
  matterId,
}: {
  notes: NoteCardNote[];
  matterId: string;
}) {
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

  const matches = (n: NoteCardNote): boolean => {
    if (pinnedOnly && !n.isPinned) return false;
    if (typeFilter.size > 0 && !typeFilter.has(n.type as NoteType))
      return false;
    const q = query.trim().toLowerCase();
    if (q.length > 0) {
      const hay = (stripHtml(n.content) + " " + n.authorName).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  };

  const threads = useMemo(() => buildThreads(notes), [notes]);
  const visibleThreads = useMemo(
    () =>
      threads.filter(
        ({ parent, replies }) =>
          matches(parent) || replies.some((r) => matches(r))
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [threads, query, typeFilter, pinnedOnly]
  );
  const visibleNoteCount = useMemo(
    () =>
      visibleThreads.reduce(
        (n, t) => n + 1 + t.replies.length,
        0
      ),
    [visibleThreads]
  );

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
          {visibleNoteCount === notes.length
            ? `${notes.length} note${notes.length === 1 ? "" : "s"}`
            : `${visibleNoteCount} of ${notes.length}`}
        </span>
      </div>

      {/* Threaded list */}
      {visibleThreads.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-xs text-ink-4">
            {anyActive
              ? "No notes match these filters."
              : "No notes on this matter yet — write the first one above."}
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {visibleThreads.map(({ parent, replies }) => (
            <ThreadView
              key={parent.id}
              parent={parent}
              replies={replies}
              matterId={matterId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ThreadView({
  parent,
  replies,
  matterId,
}: {
  parent: NoteCardNote;
  replies: NoteCardNote[];
  matterId: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <NoteCard note={parent} matterId={matterId} />
      {replies.length > 0 && (
        <div className="pl-5 border-l-2 border-line/80 ml-3 flex flex-col gap-2">
          {replies.map((r) => (
            <NoteCard key={r.id} note={r} matterId={matterId} isReply />
          ))}
        </div>
      )}
    </div>
  );
}
