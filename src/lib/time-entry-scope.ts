/**
 * TimeEntry scope invariant.
 *
 * `TimeEntry.matterId` and `TimeEntry.leadId` are both nullable in
 * the schema, but the documented app-enforced invariant is EXACTLY
 * ONE set — never both (a time entry has one billing context), never
 * neither (an unscoped entry is unreachable from every surface and
 * silently pollutes /time totals).
 *
 * Most create paths satisfy this structurally (they resolve a
 * required matter before writing). Call this assertion wherever a
 * scope arrives as data rather than a checked constant — e.g. the
 * lead-scoped create action — so a future refactor can't quietly
 * write a both/neither row. Throwing (not returning an error state)
 * is deliberate: a breach is a programming error, not user input.
 */

export type TimeEntryScope = {
  matterId: string | null | undefined;
  leadId: string | null | undefined;
};

/** Throws unless exactly one of (matterId, leadId) is a non-empty
 *  string. Returns the scope narrowed for spreading into a create. */
export function assertTimeEntryScope(scope: TimeEntryScope): {
  matterId: string | null;
  leadId: string | null;
} {
  const matterId = scope.matterId || null;
  const leadId = scope.leadId || null;
  if (matterId && leadId) {
    throw new Error(
      "TimeEntry scope invariant: matterId and leadId are both set — a time entry belongs to exactly one of a matter or a lead."
    );
  }
  if (!matterId && !leadId) {
    throw new Error(
      "TimeEntry scope invariant: neither matterId nor leadId is set — a time entry must belong to a matter or a lead."
    );
  }
  return { matterId, leadId };
}
