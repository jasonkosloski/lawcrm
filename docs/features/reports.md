# Reports

A single `/reports` page of four server-rendered snapshot cards, shipped 2026-07-07. Follow-ups are unscheduled.
Related: [PERMISSIONS.md](../PERMISSIONS.md)

## Open work
- [ ] **Reports follow-ups** (P2) — date-range picker, CSV export, per-user drill-down.

## Shipped
- [x] **Reports dashboard** (2026-07-07) — gated on `reports.view` (page-level guard; sidebar item hidden without it; palette Reports row also gated). CSS bars only, no charting library. Queries in `src/lib/queries/reports.ts` (with integration tests), using viewer-timezone month/quarter windows. Matter rows are filtered by matter-team access (ADR-039). Cards:
  - **Pipeline** — intake funnel by lead stage; open matters by practice area x stage (includes retired practice areas that still hold open matters); leads converted this quarter, dated by the converted matter's `createdAt`.
  - **Utilization** — per-active-user billable vs total hours this month with a capacity tick (`Firm.dailyHoursGoal` x business days); firm MTD vs `monthlyBillableGoal`. Both goals are read fresh off the Firm row.
  - **AR aging** — client invoices sent/partial in 0-30 / 31-60 / 61-90 / 90+ buckets, Decimal-safe sums, top 5 oldest with matter links.
  - **Realization** — trailing 3 months worked -> billed -> collected, cash basis; "billed" = client invoices sent/partial/paid.
