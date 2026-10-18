/**
 * Note scope — which record a note hangs off.
 *
 * `Note.matterId` and `Note.leadId` are both nullable in the schema;
 * the app-enforced invariant (same as TimeEntry, see
 * src/lib/time-entry-scope.ts) is EXACTLY ONE set. Matter notes live
 * on /matters/[id]/notes; intake notes on /intake/[id]/notes until the
 * lead converts, when they re-home onto the new matter.
 *
 * Pure — imported by both the note actions and the client note
 * components (which branch on `kind` to hide matter-only features:
 * captures, attached tasks / deadlines / time, Convert to task).
 */

export type NoteScope =
  | { kind: "matter"; matterId: string }
  | { kind: "lead"; leadId: string };

/** The scope of a stored note row. Throws on a both / neither row —
 *  a breach is a programming error, not user input. */
export function noteScopeOf(row: {
  matterId: string | null;
  leadId: string | null;
}): NoteScope {
  if (row.matterId && row.leadId) {
    throw new Error(
      "Note scope invariant: matterId and leadId are both set — a note belongs to exactly one of a matter or a lead."
    );
  }
  if (row.matterId) return { kind: "matter", matterId: row.matterId };
  if (row.leadId) return { kind: "lead", leadId: row.leadId };
  throw new Error(
    "Note scope invariant: neither matterId nor leadId is set — a note must belong to a matter or a lead."
  );
}

/** The Notes tab for this scope. */
export function notesPathFor(scope: NoteScope): string {
  return scope.kind === "matter"
    ? `/matters/${scope.matterId}/notes`
    : `/intake/${scope.leadId}/notes`;
}

/** Every path that renders a note in this scope: its Notes tab plus
 *  the record's overview (matter overview previews pinned notes), and
 *  the events tab + calendar when the note is a court note. Lead
 *  notes are never event-linked. */
export function notePathsToRevalidate(
  scope: NoteScope,
  opts: { calendarEventId?: string | null } = {}
): string[] {
  if (scope.kind === "lead") {
    return [notesPathFor(scope), `/intake/${scope.leadId}`];
  }
  const paths = [notesPathFor(scope), `/matters/${scope.matterId}`];
  if (opts.calendarEventId) {
    paths.push(`/matters/${scope.matterId}/events`, "/calendar");
  }
  return paths;
}
