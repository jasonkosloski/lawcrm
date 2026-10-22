# ADR-054: Matter writes are conflict-checked in both directions; the override is recorded on the matter

**Date:** 2026-10-20
**Status:** Accepted

**Context:** Lead conversion re-runs the conflict check (ADR-050), but `/matters/new` created matters with no check at all. A matter made by hand also has no lead to hold an override. And the existing matcher only screens one direction: the prospective client against adverse parties on other matters. It never asked whether the party we'd be adverse to is one of the firm's own clients (Rule 1.7), which is the conflict a new matter is most likely to create.

**Decision:**

- One gate (`src/lib/matter-conflict-gate.ts`: `screenMatter`, `evaluateConflictGate`, `conflictGateLogEntry`) runs before every write that puts a client or adverse party on a matter: a client through `runConflictMatcher`, adverse names through the new `runAdverseConflictMatcher`. Callers:
  - `createMatter`: the client (picked or inline-new) and the opposing party / firm.
  - `updateMatter`: only what the save changes (a new client; an opposing party / firm that differs after normalizing), so routine saves never ask.
  - `createMatterContact`: an "opposing" party by its name and organization plus its representation's name and firm; a "client" (co-client) against adverse parties. Witnesses and others are not screened.
  - Lead conversion keeps its own client-side gate (ADR-050). A lead carries no adverse party, so there is nothing adverse to screen there.
- Adverse screening: a name equal to a client contact (Matter.client or a client party row) on an active matter is a conflict; a client only on archived matters is a warn (one per matter, so the display wall can redact it); a match on a contact's organization only is a warn; a flagged contact matched by name is a conflict. The new matter's own client is excluded. Each comma / semicolon part of two or more words is screened as well as the whole value (one-word parts like "Inc." or "John" are pieces of a single name).
- Warn needs a "reviewed" tick. Conflict needs an override by a holder of `intake.conflict_check.override` with a 5+ character justification; without the key the write is refused. The outcome goes on the matter's timeline in the same transaction as the write ("Created / Saved / <name> added as opposing party with conflict check: override", with the justification). No new key: it is the same ethics decision intake already gates.
- The tick or override acknowledges one specific result: the form echoes a fingerprint of the matches (`conflictAck`), and any change in the result asks again.
- The forms show the match list, redacted per viewer (`redactConflictResultForViewer`), unlike conversion's counts-only prompt. The edit form keeps an acknowledged prompt through its deadline-cascade confirm (ADR-040), so that resubmit still carries the acknowledgement.

**Trade-offs:**

- (+) No path puts a client or adverse party on a matter unscreened, and suing a current client is caught at the door
- (+) A tick or override never covers matches the user didn't see; the override's timeline row is written in the create transaction
- (-) Exact (normalized) name equality only, as in the client path: "Acme Inc." vs "Acme, Inc." is missed
- (-) A one-word adverse party typed inside a list ("Acme, Officer Doe") is screened only as part of the whole value
- (-) Not gated: renaming a party's shared Contact (Parties tab edit or the contact page), or attaching counsel to an existing party row; follow-ups
- (-) Values already on matters before this gate are not swept; they are screened only when edited
