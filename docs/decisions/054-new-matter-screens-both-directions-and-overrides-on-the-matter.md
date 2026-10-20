# ADR-054: New matters are conflict-checked in both directions; the override is recorded on the matter

**Date:** 2026-10-20
**Status:** Accepted

**Context:** Lead conversion re-runs the conflict check (ADR-050), but `/matters/new` created matters with no check at all. A matter made by hand also has no lead to hold an override. And the existing matcher only screens one direction: the prospective client against adverse parties on other matters. It never asked whether the party we'd be adverse to is one of the firm's own clients (Rule 1.7), which is the conflict a new matter is most likely to create.

**Decision:**
- `createMatter` screens before writing anything (`screenNewMatter`, `src/lib/matter-create-conflict.ts`): the client (picked or inline-new) through `runConflictMatcher`, and the opposing party / firm through the new `runAdverseConflictMatcher`.
- Adverse screening: a name equal to a client contact (Matter.client or a client party row) on an active matter is a conflict; a client only on archived matters is a warn (one per matter, so the display wall can redact it); a match on a contact's organization only is a warn; a flagged contact matched by name is a conflict. The new matter's own client is excluded. Each comma / semicolon part of two or more words is screened as well as the whole value (one-word parts like "Inc." or "John" are pieces of a single name).
- Warn needs a "reviewed" tick. Conflict needs an override by a holder of `intake.conflict_check.override` with a 5+ character justification; without the key the matter can't be created here. The justification goes on the new matter's timeline ("Created with conflict check: override"). No new key: it is the same ethics decision intake already gates.
- The tick or override acknowledges one specific result: the form echoes a fingerprint of the matches (`conflictAck`), and any change in the result asks again.
- The form shows the match list, redacted per viewer (`redactConflictResultForViewer`), unlike conversion's counts-only prompt.

**Trade-offs:**
- (+) No path creates a matter without a conflict check, and suing a current client is caught at the door
- (+) A tick or override never covers matches the user didn't see; the override's timeline row is written in the create transaction
- (-) Exact (normalized) name equality only, as in the client path: "Acme Inc." vs "Acme, Inc." is missed
- (-) A one-word adverse party typed inside a list ("Acme, Officer Doe") is screened only as part of the whole value
- (-) Only creation is gated: editing a matter's opposing party, and lead conversion (client side only), don't run the adverse screen yet; both are follow-ups
