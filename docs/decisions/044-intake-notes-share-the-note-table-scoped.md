# ADR-044: Intake notes share the Note table, scoped to a lead until conversion

**Date:** 2026-10-18
**Status:** Accepted

**Context:** Intake needed a Notes section like the matter's. Screening calls, evaluation thoughts and follow-ups happen before a matter exists, and they should not be lost when the lead converts.

**Decision:**

- **One `Note` table, two scopes.** `Note.leadId` (nullable, Cascade) was added and `Note.matterId` made nullable. Exactly one is set, the same invariant TimeEntry has used since 2026-07-07. `src/lib/note-scope.ts` holds the `NoteScope` type, the both/neither check and the revalidation paths.
- **Shared UI.** The matter Notes components take a `scope` instead of a `matterId`. On a lead scope they hide everything that needs a matter: captures, attached tasks / deadlines / time, Convert to task, event and email link chips.
- **Same permissions.** Intake notes use the existing `notes.*` keys. Writing an intake note is the same capability as writing a matter note, so no new key.
- **Roll forward on conversion.** `convertLeadToMatter` re-homes lead notes onto the new matter in its transaction. Replies, reads and reactions reference the note id, so they move with no extra work.
- **Quiet activity rows.** Lead notes have no matter team to scope the feed to, so their activity rows are firm-wide with no note text (the intake-time pattern).

**Trade-offs:**

- (+) No duplicate note model or actions; threads, reactions and read state work on day one and survive conversion
- (+) After conversion, intake notes read exactly like any other matter note
- (-) Every reader of `Note.matterId` has to handle null. The sweep was small (search, event-note mapping, note attachments), but new code must remember it
- (-) Lead notes can't capture tasks or deadlines until the lead is a matter
