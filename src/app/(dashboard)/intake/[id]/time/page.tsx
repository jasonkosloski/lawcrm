/**
 * Lead Detail — Time & Expenses tab
 *
 * Placeholder. Tracking time on a lead (intake calls, conflict
 * checks, evaluation work) is valuable firm-overhead data but
 * requires schema changes:
 *
 *   - `TimeEntry.leadId` (nullable) so entries can attach to a lead
 *     before a matter exists
 *   - Optional roll-up when the lead converts — carry intake time
 *     entries over to the new matter's record
 *
 * The `Expense` model and matter-level expense tracking already
 * shipped (see the matter Time & Expenses tab). `Expense.leadId`
 * exists as a placeholder FK, but `Expense.matterId` is still
 * required and the conversion roll-forward isn't wired, so
 * lead-only expenses can't be stored yet. Both gaps are captured
 * as open questions in SCHEMA_NOTES.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function LeadTimePage() {
  return (
    <div className="p-5 flex flex-col gap-4 max-w-2xl">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">
            Intake time tracking coming
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <p className="text-xs text-ink-3 leading-relaxed mb-3">
            Log time spent evaluating this lead — intake calls,
            conflict checks, meeting prep. When the lead converts, the
            intake time rolls forward to the new matter automatically.
          </p>
          <ul className="flex flex-col gap-1.5 text-xs text-ink-2 list-disc pl-4">
            <li>Duration (decimal hours or start/stop)</li>
            <li>Activity + narrative</li>
            <li>Owner (intake coordinator, attorney, or paralegal)</li>
            <li>Billable flag (most intake is non-billable firm overhead)</li>
            <li>Carry-forward to matter on conversion</li>
          </ul>
          <div className="mt-4 pt-3 border-t border-line text-2xs text-ink-4">
            Requires <code className="font-mono text-ink-3">TimeEntry.leadId</code>{" "}
            in the schema. Open question in SCHEMA_NOTES.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">
            Expenses
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <p className="text-xs text-ink-3 leading-relaxed">
            Reimbursable costs tied to intake (e.g., courthouse
            records pulls, mileage) land here once expenses can
            attach to a lead. The{" "}
            <code className="font-mono text-ink-3">Expense</code> model
            shipped with the matter Time &amp; Expenses tab; what&apos;s
            left is lead-scoped attachment (a matter is still required
            today) and roll-forward on conversion.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
