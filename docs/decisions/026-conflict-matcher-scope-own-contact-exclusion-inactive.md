# ADR-026: Conflict matcher scope — own-contact exclusion, inactive parties stay hard

**Date:** 2026-10-16
**Status:** Accepted

**Context:** Every lead hangs off a Contact built from the very name/email/organization the conflict check scans, so the matcher matched the lead against itself and a lead could never come back "clear". Separately, the hard tier required `Contact.isActive`, but deactivating a contact only flips that flag and leaves its `MatterContact` rows on active matters — so deactivating an opposing party silently removed the conflict.

**Decision:**
- The candidate's own Contact (`ownContactId`, from `Lead.contactId`) is skipped by the soft "already in the directory" warnings. The hard tier still considers it: if the person is also an opposing-side party on an active matter, that is a real conflict.
- Contacts that are deactivated but still parties on non-archived matters stay in the hard tier. Only contacts merged away (`mergedIntoId` set; their rows moved to the survivor) are excluded. The soft warn still applies to active contacts only.
- Conflict-check audit entries identify the lead: the title carries the name, the detail begins `lead {id}:` (older rows keep the nameless title).
- **A manually flagged contact is a hard hit** (amended 2026-10-18). `Contact.conflictStatus = "flagged"` (set by `setContactConflictStatus`, carried over by merge) makes any email/name/organization match on that contact a `contact_flagged` conflict. This includes the candidate's own contact and inactive contacts: the flag is the firm saying "do not take this person on". `override` and `clear` add nothing.

**Trade-offs:**
- (+) A genuinely clean lead can be cleared; a deactivated adverse party can't hide a conflict
- (-) A deactivated party on an old open matter keeps raising conflicts until the matter is archived or the party row is removed
