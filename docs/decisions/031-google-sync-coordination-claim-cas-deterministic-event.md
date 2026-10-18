# ADR-031: Google sync coordination — claim CAS, deterministic event ids, frontier skip

**Date:** 2026-10-17
**Status:** Accepted (complements ADR-023)

**Context:** The cron, "Sync now" and the opportunistic page kick can all start a sync for the same mailbox, and Calendar pushes can race or retry. A new claim column was avoided to keep the schema untouched.

**Decision:**
- **Sync claim by compare-and-set** on `EmailAccount.syncStatus` (`gmail-sync.ts`): `updateMany` flips the row to `syncing` only if it is not already `syncing` or its `updatedAt` is older than `SYNC_CLAIM_STALE_MS` (10 minutes, a crashed run). Zero rows claimed means another pass has it and this one returns `skipped`. The claim also requires a refresh token and a non-`disconnected` status so a concurrent disconnect is not stomped. **`EmailAccount.updatedAt` is therefore the heartbeat** — any update to the account refreshes it. The sweep order is `lastSyncAt` ascending, nulls first; the email-sync route sets `maxDuration = 300` (confirm against the Vercel plan limit).
- **Deterministic Google event ids:** the CRM event id is base32hex-encoded (`googleEventIdFor`, `calendar-shared.ts`) and sent as the Google event id on insert. A 409 means that id already exists (lost mapping write, racing first push, or a copy cancelled at Google) and the push PATCHes it with `status: confirmed` instead of creating a duplicate.
- **Backfill anchor without a schema column:** incremental sync skips unknown threads older than the oldest local thread (ADR-023). A durable `EmailAccount.backfillBefore` is deferred.
- **Junk:** SPAM/TRASH-only threads are never imported; local ones are kept, read and archived (ADR-023).
- **Host allowlist:** `gmailFetch` only calls `gmail.googleapis.com` and `www.googleapis.com`, with a 60 s per-request timeout (caller signal wins; OAuth endpoints 30 s). OAuth connect refuses a grant missing `gmail.modify` / `gmail.send`; connect and disconnect are audited as `auth` rows. Read-state writeback is per message (`messages/batchModify` over synced ids), and after a failed writeback the local flag stands until Gmail next reports that thread, then Gmail's labels win.

**Trade-offs:**
- (+) Concurrent passes are safe and crashed runs recover without a lock table
- (-) Reusing `updatedAt` as the heartbeat means unrelated account writes extend a stale claim; a dedicated `syncStartedAt` column would be cleaner
- (-) A Google-born event deleted in Google lingers until `CalendarEvent.origin` exists (ADR-023)
