# ADR-038: `billing.view` gates the billing read surface

**Date:** 2026-10-17
**Status:** Accepted

**Context:** Billing had action keys (`billing.*`, `trust.record_transaction`) but no read key: every signed-in user could open any matter's Billing tab, print any invoice by id, and see the firm trust total and trust deposit rows (ADR-021 listed this as open).

**Decision:**

- New key `billing.view` ("View billing, trust ledger and invoices"). It gates the matter Billing page (`requirePermission`, redirect to `/` like other denied pages), the Billing tab link (hidden without it), the invoice print route and its metadata, the Overview "Trust balance" and "WIP" facts, the dashboard Trust balance KPI (needs `reports.view` too), and trust `deposit` activity rows on the matter Timeline and the dashboard feed (omitted, as with settlement/expense rows).
- The migration grants `billing.view` to every role that already holds any `billing.*` or `trust.*` key, so nobody who could act on billing loses the tab. Admin is a wildcard in code and needs no row. Other roles gain nothing until an admin ticks the key.
- The matters list/kanban "Trust" column and its sort/filter are now gated by `billing.view` too (ADR-039).

**Trade-offs:**

- (+) Billing data has an explicit read gate separate from the action keys
- (-) Roles that could view billing only because everyone could (no `billing.*` key) lose the tab until granted
