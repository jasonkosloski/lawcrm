# Contact.conflictStatus is never read by the conflict matcher

## Problem
`Contact.conflictStatus` ("flagged" etc.) is a manual flag set from the contact page (`src/app/actions/contacts.ts`; the docstring calls it manual-only, nothing else writes it). The conflict matcher (ADR-026) never reads it. It is only displayed (contacts list/detail) and carried through contact merge.

## Why it matters
A user can flag a contact as a conflict and still see no warning when that person is matched during intake or matter creation, so the flag gives a false sense of coverage.

## Options or fix
- Make the matcher treat `conflictStatus = flagged` as a hit (ADR amendment to 026 for scope).
- Or relabel the flag in the UI as an informational note only.
- Needs a product call; once decided, record it as an ADR.

## Related
[ADR-026](../decisions/026-conflict-matcher-scope-own-contact-exclusion-inactive.md), [contacts.md](../features/contacts.md)
