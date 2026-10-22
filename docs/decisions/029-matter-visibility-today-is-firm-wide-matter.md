# ADR-029: Matter visibility today is firm-wide; matter-team access is planned, not built

**Date:** 2026-10-17
**Status:** Accepted (history); superseded by ADR-039

**Context:** Older docs implied `MatterTeamMember` restricts who can see a matter. It does not, and the sweep confirmed it on every read path. The firm decided on 2026-10-16 how the restriction should work; the design is in `out/sweep/MATTER_ACCESS_DESIGN.md`. This ADR records the truth so nobody builds on the wrong assumption.

**Decision (current, built):**

- Every signed-in user can list, open, search, download and export every matter and everything attached to it — notes (including strategy memos), documents, invoices, trust ledger, time narratives — subject only to the granular permission keys and the calendar Busy scrub (ADR-021). Even the zero-permission default role reads matter detail; the Billing tab and `/print/invoices/[id]` now need `billing.view` (ADR-038).
- `MatterTeamMember` drives assignment, notifications, auto-attendees (`src/lib/calendar-default-attendees.ts`), calendar detail unlocks and the lead filter. It is **not** an access-control list. Ethical walls are unsupported.
- The document download route and the upload, blob-upload and document-template routes have no firm or matter-team scoping. Scoping them needs the matter-access phase and, for true multi-tenancy, a `Matter.firmId`.
- Email is the exception: it is mailbox-personal (ADR-014).

**Decision (planned, NOT built — Proposed):**

- A user can see a matter when they are an active team member, hold the grantable `matters.view_all` key (Admins implicitly), or the firm's matter-visibility switch is still at "everyone". Hidden matters 404 (never 403). Every matter-scoped write also requires access.
- A firm-level switch (Settings → Firm) starts at "everyone"; the admin flips it to "team only" after fixing rosters with a "thin teams" list. Turning it on is logged.
- Events on inaccessible matters show as Busy through the existing scrub.
- Mechanism: `src/lib/matter-access.ts` (`matterAccessWhere`, `canAccessMatter`, `assertMatterAccess`), enforced by a static scan like `page-guards.test.ts` plus two-user integration tests. The firm-switch column and `matters.view_all` ship in the Batch 4 migration (see `SCHEMA_NOTES.md`; not applied).

**Trade-offs:**

- (+) Docs now state what the code does; the planned phase has an agreed rollout that cannot lock anyone out on day one
- (-) Until the phase ships, any staff account can read any client file; permissions narrow actions, not reads
