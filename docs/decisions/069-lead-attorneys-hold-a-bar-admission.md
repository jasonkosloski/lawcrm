# ADR-069: Lead attorneys hold a bar admission; bar numbers are per state

**Date:** 2026-10-23
**Status:** Accepted.

**Context:** `User.barNumber` was one free-text value per person, but lawyers are admitted in several states and templates need the number for the matter's venue. Nothing stopped a non-lawyer from being made lead attorney.

**Decision:**

- `BarAdmission` holds one row per user per state (two-letter code from `src/lib/us-states.ts`, number up to 40 chars, at most 60 per user). Profile, Team → Edit member and Invite edit the list; saves log "bar admissions updated" without the numbers.
- An attorney is an active user with at least one admission (`src/lib/attorneys.ts`). Admissions are the only definition; there is no separate "is attorney" flag.
- The lead attorney must be an attorney at pick time: new matter (no fallback to a non-attorney creator), changing the lead on edit, promoting in team management, and lead-to-matter conversion (the dialog picks the lead). Existing leads are grandfathered and not flagged; the current lead stays listed when editing even if not an attorney.
- Conversion carries the intake team over; any other intake lead becomes co-counsel. The converter is not added just for converting, and one who cannot see the new matter returns to the lead page with no pin. The SOL deadline owner is the picked lead.
- Templates print the number for the matter's venue state, else the firm's state (also for lead-scoped records), else the usual "not on file" marker. `matter.leadAttorney`, the "Attorneys" list and `signer.barNumber` all follow this rule.
- `User.barNumber` was backfilled into `BarAdmission` for the firm's state and is now unread and unwritten, kept until a drop migration ([SCHEMA_NOTES](../SCHEMA_NOTES.md)).

**Rejected:**

- An `isAttorney` flag on `User`: it can disagree with the admissions and says nothing about which state.
- Enforcing attorney status continuously: demoting or flagging existing leads when an admission is removed would break matters mid-flight; the rule applies when someone is picked.

**Trade-offs:**

- (+) The right number prints per venue, and a non-lawyer cannot be picked as lead
- (-) A lead who later loses all admissions stays lead, unflagged
- (-) A matter in a state with no admission prints "not on file" rather than another state's number
