# ADR-035: Statute periods are calendar amount + unit, computed with calendar arithmetic

**Date:** 2026-10-17
**Status:** Accepted (supersedes the 365/30 convention in ADR-027 and ADR-019)

**Context:** `PracticeArea.statutePeriodDays` stored "years x 365 + months x 30 + days". Statutes say "two years" or "six months", which run to the same calendar date, so the computed SOL date could be a day early across a leap year or a day or two off for months. Missing an SOL is malpractice, so the stored period must say what the statute says.

**Decision:**
- `PracticeArea.statutePeriodAmount Int?` + `statutePeriodUnit SolPeriodUnit?` (`DAYS | MONTHS | YEARS`), set together or not at all. The settings form is an amount input plus a unit select. The migration backfills from the old column: days divisible by 365 become `YEARS` (730 -> 2 YEARS), anything else stays `DAYS` (180 -> 180 DAYS; an "18 months" area stored as 540 comes back as 540 DAYS and should be re-entered).
- `statutePeriodDays` stays in the schema (expand/contract) but nothing reads or writes it; a later migration drops it. Rolling the app back one release still works for existing areas.
- `computeSolDate` (`src/lib/sol.ts`) works on the incident's UTC date-only value (ADR-012). DAYS adds N days; MONTHS/YEARS add N (12N) calendar months keeping the day of month. **Month-end rule:** when the target month is shorter, the result clamps to its last day (2024-02-29 + 1 year = 2025-02-28; 2024-02-29 + 4 years = 2028-02-29; 2026-01-31 + 1 month = 2026-02-28). No time zone ever enters the math.
- Callers (`createMatter`, `updateMatter` via `resolveEditedSolDate`, lead conversion, the edit/new matter form previews and the SOL card) take a `SolPeriod = { amount, unit }` built by `toSolPeriod`.
- Automation deadline rules (ADR-019) keep their single signed `offsetDays` integer plus `offsetUnit`; the amount is recovered with `unpackOffset` and months/years are then applied as calendar months on the day key (`applyOffsetToKey`). "Days" rules are unchanged.
- Auto-vs-manual inference (ADR-027) is unchanged but now compares against the calendar result; a matter whose stored auto date was computed under the old 365-day rule can look manual after the migration (the safe direction: it is kept).

**Trade-offs:**
- (+) The date matches the statute's wording; leap years and month ends are explicit and tested
- (-) A date computed under the old rule can differ by a day or two from the new one for existing matters; they keep their stored dates (treated as manual) until edited
- (-) A mixed period ("1 year 6 months") is entered as 18 months
