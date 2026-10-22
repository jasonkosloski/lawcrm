# ADR-030: Settlement status follows the approval chain; amounts and steps serialize under a per-matter lock

**Date:** 2026-10-17
**Status:** Accepted

**Context:** `matters.settlement.edit` could set `status` directly, so an editor could mark a settlement approved or disbursed without the approval chain, and amount edits raced with approver clicks.

**Decision** (`src/app/actions/settlements.ts`):

- New settlements are always `pending`. Only the approval chain (`setApprovalStepStatus` promotes `pending` to `approved` when every step is approved and demotes `approved` to `pending` when a step is rejected or reset) or `matters.settlement.approve` moves status. `edit` alone can no longer change status; `approve` also covers reopen and stage transitions through `upsertSettlement`. Step notifications go only to `matters.settlement.view` holders.
- `disbursed` and `closed` lock amounts. Changing amounts on a fully approved settlement resets the approvals and therefore requires `matters.settlement.approve`.
- Amount edits, step changes and creation all take `pg_advisory_xact_lock(hashtext('settlement:' + matterId))`, so two approvers or an approver and an editor serialize. The unique index on `settlements(matterId)` now backs the one-settlement-per-matter guarantee in the database (ADR-036); the lock stays because it also serializes status transitions and amount edits.
- Client net is signed and never clamped (a negative net is shown, in warn tone). Fee math is Decimal HALF_UP to cents via `src/lib/settlement-waterfall.ts` (same rounding rule as ADR-024); `Settlement.clientNet` is derived on read, not stored.

**Trade-offs:**

- (+) The recorded status always matches the recorded sign-offs
- (-) The lock is app-level, but a second row for the same matter is no longer possible: the unique index (ADR-036) refuses it
