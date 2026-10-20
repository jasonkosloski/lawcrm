# ADR-056: Drafts hold intake files; the firm can require a signed originating document

**Date:** 2026-10-20
**Status:** Accepted

**Context:** `/matters/new` could not be saved and resumed, had no way to attach intake documents, and recorded nothing about the fee agreement. Some firms want no matter opened until the agreement is signed.

**Decision:**
- A `MatterDraft` stores the form's values as posted (JSON, capped at 200 KB) plus draft-only files (`MatterDraftFile`). Draft files are not `Document` rows until Create moves them into the new matter, so no matter or lead scope rule applies to them. At most one file per draft is the originating document (app-enforced).
- Drafts are private to their creator. A draft someone else owns answers like a missing one (no existence oracle). Draft values keep the agreement status and signed date so resuming restores what was typed. Team seats in a draft need `matters.create`, same as on a real matter. Untouched drafts and their files are swept after 90 days by a daily cron.
- Create locks the draft row `FOR UPDATE` in its transaction and re-checks the files under the lock. Bumping `updatedAt` on file changes was rejected: it would make the uploader's own auto-save look stale, and blob completions cannot return a fresh token.
- Every new matter gets one `MatterAgreement` row (`not_sent` by default), so the Overview card and the missing-count are plain reads. It links the originating `Document` and records status and signed date. Changing it needs `matters.agreement.edit`.
- `Firm.requireOriginatingDoc` (Admin only, default off) makes create and lead conversion require a signed originating document. The label is per practice area (`originatingDocLabel`, default "Fee agreement").
- The sweep route is exempt from the login proxy and authenticates with `CRON_SECRET`, like the other crons.

**Trade-offs:**
- (+) Resume without losing work; the agreement is queryable; the gate is one switch
- (-) A create can wait briefly on in-flight uploads (the draft lock)
- (-) Lead conversion enforces the agreement gate but still not an area's required fields or venue (see [matters](../features/matters.md))
