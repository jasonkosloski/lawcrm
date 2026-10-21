# ADR-060: Billing type is derived; court-appointed is hourly work paid by a voucher

**Date:** 2026-10-21
**Status:** Accepted.

**Context:** Firms think of a matter as hourly, flat fee, contingency, court-appointed or pro bono. The schema had two separate fields (`Matter.feeStructure`, `Matter.billingMode`), edited as two selects, with `billingMode` snapshotted from a per-area default. Court-appointed work is hourly work with a different payer and output (agency voucher, statutory rate, caps), so it is not a fee structure of its own. Anyone could change either field after the fact, and fee petition was selectable although no flow exists for it.

**Decision:**
- One user-facing billing type (`src/lib/billing-type.ts`): Hourly, Flat fee, Contingency, Court-appointed, Pro bono. It is derived from the existing fields; there is no Matter column. Court-appointed = `feeStructure hourly` + `billingMode court_voucher`; pro bono = `pro_bono` + `none`; the rest = the same-named fee structure + `client`. Hourly math never special-cases court-appointed.
- Legacy `hybrid` matters keep their value and display "Hybrid"; it is never offered and can't be a change target. Matters already on `fee_petition` read as their fee structure's type.
- Each practice area stores `allowedBillingTypes` and `defaultBillingType`. New-matter and lead conversion offer only the allowed types, preselect the default, and the server rejects others. Narrowing an area never touches existing matters.
- The type is locked after creation. `matters.billing_type.edit` (Admins implicitly) can change it to any type, not just the area's list; the change is logged.
- The fee-petition billing mode can no longer be selected. It returns as its own matter switch when a fee-petition flow is built.

**Trade-offs:**
- (+) One concept in the UI and filters; no third copy of the same fact to drift
- (+) Court-appointed shares all hourly behaviour
- (-) Every reader must go through `billingTypeOf` rather than reading one column
- (-) Fee petition is dormant until it gets its own switch, so fee-shifting matters can't flag it meanwhile
- (-) `PracticeArea.defaultBillingMode` is deprecated and unread; drop it in a later migration
