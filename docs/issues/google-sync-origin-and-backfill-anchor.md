# Google-born event cleanup and explicit backfill anchor need schema

## Problem
Two Google sync improvements have no home in the schema: `CalendarEvent.origin` (to tell events created in Google from events created here, so cleanup after unlinking can be precise) and `EmailAccount.backfillBefore` (an explicit anchor for how far mail backfill goes). Neither field exists in `prisma/schema.prisma`.

## Why it matters
Without `origin`, cancel/unlink behaviour (ADR-023: cancel = unlink) cannot safely remove Google-born events. Without a backfill anchor, mail catch-up depends on implicit timing (ADR-031).

## Options or fix
- Add both columns via a migration (document in `docs/SCHEMA_NOTES.md`), backfill existing rows, then use them in the sync cleanup and backfill paths.
- Needs a product call on what cleanup should do with Google-born events.

## Related
[google-calendar-sync.md](../features/google-calendar-sync.md), [ADR-023](../decisions/023-google-sync-skips-only-deterministic-failures-catch.md), [ADR-031](../decisions/031-google-sync-coordination-claim-cas-deterministic-event.md)
