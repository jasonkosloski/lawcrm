# ADR-010: Per-user matter pins (UserMatterPin join table, not Matter.isPinned)

**Date:** 2026-04-24
**Status:** Accepted (supersedes the initial `Matter.isPinned` boolean)

**Context:** The initial schema had a global `Matter.isPinned` boolean — pinning a matter made it appear in everyone's sidebar. That's wrong: different users (attorneys, paralegals, finance, intake) care about different matters, and an attorney's pins shouldn't clutter a paralegal's sidebar.

**Decision:** Pinning is per-user. A new `UserMatterPin` join table (`@@id([userId, matterId])`) stores pins. The global `Matter.isPinned` column has been dropped. A `toggleMatterPin` server action flips the current user's pin for a given matter and `revalidatePath('/', 'layout')` so the sidebar refreshes.

**Trade-offs:**
- (+) Matches real usage patterns — each user curates their own pin list
- (+) Foreshadows the Phase 8 "role-based customizable sidebar" work
- (+) FK integrity via relations to both `User` and `Matter`
- (-) One more query on each matter detail + list render to determine pin state (acceptable; it's an indexed lookup)
- (-) Can't represent "firmwide featured" matters with this model alone — would need a separate flag or list if that use case emerges

**Not generalized to polymorphic pins (yet):** We could have added a generic `UserPin { itemType, itemId }` to cover future "pin a report / lead / saved filter" use cases. Declined for now — we only have one pinnable type, and a polymorphic table loses FK integrity. Revisit when a second pinnable type actually needs to exist.

**Authorization placeholder:** Current user is resolved via `getCurrentUserId()` (`src/lib/current-user.ts`), which today hardcodes Jason. When auth lands, that helper becomes the session resolver and this ADR stays valid — no call-site changes needed.
