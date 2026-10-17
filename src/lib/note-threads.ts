/**
 * Thread-tree helpers for the Notes tab (pure, no React).
 *
 * The tab receives a flat list of a matter's notes (pinned first, then
 * oldest to newest) and renders it as threads: a root note plus its
 * replies nested beneath, to any depth. Extracted from the component
 * so ordering, orphan handling and the rollups can be unit-tested.
 */

/** The slice of a note the helpers read. */
export type ThreadableNote = {
  id: string;
  parentNoteId: string | null;
  isPinned: boolean;
  isRead: boolean;
  attachedTasks: unknown[];
  attachedDeadlines: unknown[];
  attachedTimeEntries: Array<{ hours: number }>;
};

/** Tree node - a note plus its (recursive) children. Any note can
 *  itself be replied to and those replies nest further beneath it. */
export type NoteNode<N extends ThreadableNote> = {
  note: N;
  children: NoteNode<N>[];
};

/**
 * Group a flat note list into threads.
 *
 * A note is a root when it has no parent OR its parent isn't in the
 * list (an orphan - cascade deletes should keep this clean, but a
 * visible orphan beats a vanished note). Roots are ordered pinned
 * first, then newest first; replies keep the input (oldest-first)
 * order so a thread reads top-down. A visited set guards against a
 * hypothetical parent cycle.
 */
export function buildTrees<N extends ThreadableNote>(
  notes: N[]
): NoteNode<N>[] {
  const ids = new Set(notes.map((n) => n.id));
  const childrenByParent = new Map<string, N[]>();
  const roots: N[] = [];
  for (const n of notes) {
    if (n.parentNoteId && ids.has(n.parentNoteId)) {
      if (!childrenByParent.has(n.parentNoteId))
        childrenByParent.set(n.parentNoteId, []);
      childrenByParent.get(n.parentNoteId)!.push(n);
    } else {
      roots.push(n);
    }
  }
  const visited = new Set<string>();
  const make = (n: N): NoteNode<N> => {
    if (visited.has(n.id)) return { note: n, children: [] };
    visited.add(n.id);
    return {
      note: n,
      children: (childrenByParent.get(n.id) ?? []).map(make),
    };
  };
  // Within each group the server already sorted oldest-to-newest, but
  // roots look best newest-to-oldest at the top.
  const pinned = roots.filter((r) => r.isPinned);
  const rest = roots.filter((r) => !r.isPinned).reverse();
  return [...pinned, ...rest].map(make);
}

/** True if `matches` holds for the node or any descendant - a thread
 *  stays visible when any note in it matches the filters. */
export function subtreeMatches<N extends ThreadableNote>(
  node: NoteNode<N>,
  matches: (n: N) => boolean
): boolean {
  if (matches(node.note)) return true;
  return node.children.some((c) => subtreeMatches(c, matches));
}

/** The node plus all of its descendants. */
export function countNodes<N extends ThreadableNote>(node: NoteNode<N>): number {
  return 1 + node.children.reduce((sum, c) => sum + countNodes(c), 0);
}

/** True if any note in the subtree is still unread for the current
 *  user - drives the default collapse state so threads with fresh
 *  replies stay expanded on load. */
export function subtreeHasUnread<N extends ThreadableNote>(
  node: NoteNode<N>
): boolean {
  if (!node.note.isRead) return true;
  return node.children.some((c) => subtreeHasUnread(c));
}

/** Aggregate counts of attached tasks/deadlines/time entries across
 *  every descendant of a node (children only - the node's own
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

export function summarizeRollup(r: ThreadRollup): string {
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

export function rollupDescendants<N extends ThreadableNote>(
  node: NoteNode<N>
): ThreadRollup {
  let tasks = 0;
  let deadlines = 0;
  let timeEntries = 0;
  let totalHours = 0;
  let notesWithAttachments = 0;
  const walk = (n: NoteNode<N>) => {
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
