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

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Pin, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { markMatterNotesRead } from "@/app/actions/notes";
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

/** Tree node — a note plus its (recursive) children. Reddit-style:
 *  any note can itself be replied to and those replies nest further
 *  beneath it. The recursion terminates because parentNoteId only
 *  points to existing notes in the matter; a visited set guards
 *  against hypothetical cycles. */
type NoteNode = { note: NoteCardNote; children: NoteNode[] };

function buildTrees(notes: NoteCardNote[]): NoteNode[] {
  const ids = new Set(notes.map((n) => n.id));
  const childrenByParent = new Map<string, NoteCardNote[]>();
  const roots: NoteCardNote[] = [];
  for (const n of notes) {
    // A note is a root if it has no parent OR the parent isn't in this
    // matter's set (edge case — cascade deletes should keep this clean).
    if (n.parentNoteId && ids.has(n.parentNoteId)) {
      if (!childrenByParent.has(n.parentNoteId))
        childrenByParent.set(n.parentNoteId, []);
      childrenByParent.get(n.parentNoteId)!.push(n);
    } else {
      roots.push(n);
    }
  }
  const visited = new Set<string>();
  const make = (n: NoteCardNote): NoteNode => {
    if (visited.has(n.id)) return { note: n, children: [] };
    visited.add(n.id);
    return {
      note: n,
      children: (childrenByParent.get(n.id) ?? []).map(make),
    };
  };
  // Pinned roots first; within each group the server already sorted
  // oldest-to-newest, but roots look best newest-to-oldest at the top.
  const pinned = roots.filter((r) => r.isPinned);
  const rest = roots.filter((r) => !r.isPinned).reverse();
  return [...pinned, ...rest].map(make);
}

function subtreeMatches(
  node: NoteNode,
  matches: (n: NoteCardNote) => boolean
): boolean {
  if (matches(node.note)) return true;
  return node.children.some((c) => subtreeMatches(c, matches));
}

function countNodes(node: NoteNode): number {
  return (
    1 + node.children.reduce((sum, c) => sum + countNodes(c), 0)
  );
}

/** True if any note in the subtree is still unread for the current
 *  user — drives the default collapse state so threads with fresh
 *  replies stay expanded on load. */
function subtreeHasUnread(node: NoteNode): boolean {
  if (!node.note.isRead) return true;
  return node.children.some((c) => subtreeHasUnread(c));
}

/** Aggregate counts of attached tasks/deadlines/time entries across
 *  every descendant of `node` (children only — the node itself's
 *  attachments are already shown on its own card). Powers the parent
 *  rollup chip "Thread has 4 items in 2 replies." */
export type ThreadRollup = {
  tasks: number;
  deadlines: number;
  timeEntries: number;
  totalHours: number;
  /** Number of descendant notes that have at least one attachment. */
  notesWithAttachments: number;
};

function summarizeRollup(r: ThreadRollup): string {
  const parts: string[] = [];
  if (r.tasks > 0) parts.push(`${r.tasks} ${r.tasks === 1 ? "task" : "tasks"}`);
  if (r.deadlines > 0)
    parts.push(`${r.deadlines} ${r.deadlines === 1 ? "deadline" : "deadlines"}`);
  if (r.timeEntries > 0)
    parts.push(
      `${r.timeEntries} time ${r.timeEntries === 1 ? "entry" : "entries"} (${r.totalHours.toFixed(1)}h)`
    );
  return `${parts.join(" · ")} across ${r.notesWithAttachments} ${r.notesWithAttachments === 1 ? "reply" : "replies"}`;
}

function rollupDescendants(node: NoteNode): ThreadRollup {
  let tasks = 0;
  let deadlines = 0;
  let timeEntries = 0;
  let totalHours = 0;
  let notesWithAttachments = 0;
  const walk = (n: NoteNode) => {
    for (const child of n.children) {
      const t = child.note.attachedTasks.length;
      const d = child.note.attachedDeadlines.length;
      const e = child.note.attachedTimeEntries.length;
      tasks += t;
      deadlines += d;
      timeEntries += e;
      totalHours += child.note.attachedTimeEntries.reduce(
        (s, x) => s + x.hours,
        0
      );
      if (t + d + e > 0) notesWithAttachments++;
      walk(child);
    }
  };
  walk(node);
  return { tasks, deadlines, timeEntries, totalHours, notesWithAttachments };
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

  // Fire-and-forget: mark every note that came back unread as read.
  // We intentionally do NOT revalidate the page after — the initial
  // render already drove default-expand from the was-unread state;
  // refreshing would snap expanded threads shut mid-read. The write
  // only matters for the NEXT page visit.
  useEffect(() => {
    const unreadIds = notes.filter((n) => !n.isRead).map((n) => n.id);
    if (unreadIds.length === 0) return;
    // Small delay so the user gets a beat to see the highlight before
    // we mark things read behind the scenes.
    const handle = setTimeout(() => {
      markMatterNotesRead(unreadIds).catch(() => {
        // Silent — failing to mark read isn't worth a user-facing error.
      });
    }, 800);
    return () => clearTimeout(handle);
    // Notes identity is stable per page render; no need to re-fire
    // on unrelated state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matterId]);

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

  const trees = useMemo(() => buildTrees(notes), [notes]);
  const visibleTrees = useMemo(
    () => trees.filter((t) => subtreeMatches(t, matches)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trees, query, typeFilter, pinnedOnly]
  );
  const visibleNoteCount = useMemo(
    () => visibleTrees.reduce((n, t) => n + countNodes(t), 0),
    [visibleTrees]
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
      {visibleTrees.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-xs text-ink-4">
            {anyActive
              ? "No notes match these filters."
              : "No notes on this matter yet — write the first one above."}
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {visibleTrees.map((tree) => (
            <ThreadView
              key={tree.note.id}
              node={tree}
              matterId={matterId}
              depth={0}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Recursive tree render. Each level adds a small left-indent + a
 *  connector line so the nesting reads at a glance. Indent is capped
 *  at MAX_INDENT_DEPTH so very deep threads don't march off the
 *  screen; beyond the cap everything stacks at the same indent with
 *  the connector line still visible. */
const MAX_INDENT_DEPTH = 6;

function ThreadView({
  node,
  matterId,
  depth,
}: {
  node: NoteNode;
  matterId: string;
  depth: number;
}) {
  const hasChildren = node.children.length > 0;
  // Default collapse state — if the whole subtree is already read,
  // collapse it so old threads don't clutter the page. If anything
  // inside is still unread for this user, leave it open.
  const [collapsed, setCollapsed] = useState(
    () => hasChildren && !node.children.some((c) => subtreeHasUnread(c))
  );
  // Count is of ALL descendants, not just direct children — that's
  // more useful info for deciding whether to expand a long thread.
  const descendantCount = hasChildren
    ? node.children.reduce((n, c) => n + countNodes(c), 0)
    : 0;

  // Roll up attachments from descendants — surfaces "thread has N
  // items buried in replies" so the user knows the conversation has
  // actionable stuff before expanding it. Only computed at depth 0
  // (root of the conversation); deeper levels handle their own.
  const rollup =
    depth === 0 && hasChildren ? rollupDescendants(node) : null;
  const rollupTotal =
    rollup === null
      ? 0
      : rollup.tasks + rollup.deadlines + rollup.timeEntries;

  return (
    <div className="flex flex-col gap-2">
      <NoteCard
        note={node.note}
        matterId={matterId}
        isReply={depth > 0}
      />
      {hasChildren && (
        <>
          <div className="flex items-center gap-2 self-start pl-3 ml-3">
            <button
              type="button"
              onClick={() => setCollapsed((v) => !v)}
              aria-expanded={!collapsed}
              className="inline-flex items-center gap-1 text-2xs text-ink-3 hover:text-brand-700 transition-colors"
            >
              {collapsed ? (
                <ChevronRight size={11} />
              ) : (
                <ChevronDown size={11} />
              )}
              {collapsed
                ? `Show ${descendantCount} ${descendantCount === 1 ? "reply" : "replies"}`
                : `Hide ${descendantCount} ${descendantCount === 1 ? "reply" : "replies"}`}
            </button>
            {rollup && rollupTotal > 0 && (
              <button
                type="button"
                onClick={() => setCollapsed(false)}
                title={summarizeRollup(rollup)}
                className="inline-flex items-center gap-1 text-2xs px-1.5 py-0.5 rounded-md border border-line bg-paper-2/60 text-ink-3 hover:border-brand-300 hover:bg-brand-soft hover:text-brand-700 transition-colors"
              >
                <span className="font-mono text-brand-700">
                  {rollupTotal}
                </span>
                <span>
                  {rollupTotal === 1 ? "item" : "items"} in replies
                </span>
                {rollup.totalHours > 0 && (
                  <span className="font-mono text-ink-4">
                    · {rollup.totalHours.toFixed(1)}h
                  </span>
                )}
              </button>
            )}
          </div>
          {!collapsed && (
            <div
              className={cn(
                "border-l-2 border-line/80 flex flex-col gap-2",
                // Cap the visual indent — deeper replies still render
                // inside the connector but stop marching right so they
                // don't get cramped against the viewport edge.
                depth + 1 <= MAX_INDENT_DEPTH ? "pl-5 ml-3" : "pl-3 ml-1"
              )}
            >
              {node.children.map((child) => (
                <ThreadView
                  key={child.note.id}
                  node={child}
                  matterId={matterId}
                  depth={depth + 1}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
