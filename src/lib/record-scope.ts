/**
 * Record scope — whether a note / task / event hangs off a matter or
 * an intake lead.
 *
 * Notes must have exactly one scope (src/lib/note-scope.ts). Tasks
 * and calendar events may have NEITHER (a firm-wide task, a personal
 * event), but never both: `Task.leadId` / `CalendarEvent.leadId` are
 * app-enforced "at most one of (matterId, leadId)". Lead conversion
 * re-homes every lead-scoped record onto the new matter.
 *
 * Pure — imported by server actions and client composers alike.
 */

export type RecordScope =
  | { kind: "matter"; matterId: string }
  | { kind: "lead"; leadId: string };

/** The scope of a stored task / event row, or null for a firm-wide
 *  task or personal event. Throws on a row with both set — a breach
 *  is a programming error, not user input. */
export function optionalScopeOf(row: {
  matterId: string | null;
  leadId: string | null;
}): RecordScope | null {
  if (row.matterId && row.leadId) {
    throw new Error(
      "Record scope invariant: matterId and leadId are both set — a task or event belongs to at most one of a matter or a lead."
    );
  }
  if (row.matterId) return { kind: "matter", matterId: row.matterId };
  if (row.leadId) return { kind: "lead", leadId: row.leadId };
  return null;
}

/** The scope of a stored row that must have EXACTLY one of matterId /
 *  leadId (notes, documents, document folders). Throws on a both /
 *  neither row — a breach is a programming error, not user input. */
export function scopeOf(row: {
  matterId: string | null;
  leadId: string | null;
}): RecordScope {
  if (row.matterId && row.leadId) {
    throw new Error(
      "Record scope invariant: matterId and leadId are both set — the record belongs to exactly one of a matter or a lead."
    );
  }
  if (row.matterId) return { kind: "matter", matterId: row.matterId };
  if (row.leadId) return { kind: "lead", leadId: row.leadId };
  throw new Error(
    "Record scope invariant: neither matterId nor leadId is set — the record must belong to a matter or a lead."
  );
}

/** Prisma `where` / `data` fragment for a scope. */
export function scopeWhere(
  scope: RecordScope
): { matterId: string } | { leadId: string } {
  return scope.kind === "matter"
    ? { matterId: scope.matterId }
    : { leadId: scope.leadId };
}

/** The scope's record page: `/matters/{id}` or `/intake/{id}`. */
export function scopeBasePath(scope: RecordScope): string {
  return scope.kind === "matter"
    ? `/matters/${scope.matterId}`
    : `/intake/${scope.leadId}`;
}

/** The scope's record page and its tab for `tab` ("tasks", "events",
 *  "notes" …): what a write to that tab must revalidate. Null scope
 *  (firm-wide / personal) has no record page. */
export function scopePaths(scope: RecordScope | null, tab: string): string[] {
  if (!scope) return [];
  const base = scopeBasePath(scope);
  return [`${base}/${tab}`, base];
}

/** Refusal text when a document / folder operation would cross scopes
 *  (matter <-> intake lead, or between two different records). */
export const SAME_SCOPE_ERROR =
  "Documents and folders can only move within the same matter or intake.";
