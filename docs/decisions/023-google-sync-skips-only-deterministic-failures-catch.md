# ADR-023: Google sync skips only deterministic failures; catch-up never advances past an open gap; Google cancel is unlink-only

**Date:** 2026-10-16
**Status:** Accepted

**Context:** Gmail/Calendar sync had two opposite failure modes: one poisoned message (NUL byte, bad date) wedged a mailbox forever because the pass aborted before the cursor advanced, and the history-expired fallback was a 200-thread import that left a permanent gap (backfill only walks below the oldest local thread). Isolating failures naively would trade the first problem for silent, permanent loss on a database blip. Separately, a Google-side cancel could hard-delete a CRM event shaped like a personal import, which a CRM-born matterless "meeting" also is.

**Decision:**

- **Per-item isolation is limited to deterministic data errors.** `isTransientInfraError` (`src/lib/google/transient-error.ts`: Prisma P1001/P1002/P1008/P1017/P2024/P2034, initialization / rust-panic errors, driver socket + SQLSTATE codes) aborts the pass so the history cursor / calendar sync token stays put and the next run retries. A pass in which three or more items all failed and none succeeded also aborts (systemic, not poison); one or two failures with no success still count as isolated poison so a single-thread pass cannot wedge.
- **Catch-up never closes over a gap it did not fill.** Expired history for an account that has synced before triggers a catch-up since `lastSyncAt − 1d` under a safety cap (`CATCHUP_MAX_THREADS` = 1000; only a first import is capped at 200 threads / 90 days). If the cap truncates it, neither `historyId` nor `lastSyncAt` advances and `syncError` says so; each re-run skips threads already current locally (`format=minimal` compare of message count, last message time, flags) so the cap is spent on new threads and the gap shrinks every pass. No schema change; progress is implicit in the local threads.
- **Incremental sync skips unknown threads older than the oldest local thread** (the backfill frontier), so label-only history records on ancient mail cannot drag the anchor back and strand the middle.
- **Junk mail is never imported.** A thread whose every message is SPAM or TRASH is not imported (history.list reports changes on every label, so this keeps the junk folder out); a local thread that later becomes junk-only is kept, marked read and archived. Drafts are never stored.
- **A Google-side cancellation only unlinks** (deletes the `CalendarEventSync` row). With no origin flag on `CalendarEvent` there is no reliable "Google-born" discriminator, and deleting loses notes/time/tasks links with no audit entry.

**Trade-offs:**

- (+) A DB blip can no longer silently drop mail or calendar changes; a poisoned item can no longer wedge a mailbox
- (+) The large-outage gap closes over multiple passes without schema work
- (-) Skipped (poisoned) items are retried only if they change upstream again; they are visible via `syncError` and server logs until the next clean pass
- (-) A catch-up pass costs one extra `format=minimal` request per already-local thread
- (-) Google-born imports deleted in Google linger in the CRM until removed; a durable fix needs `CalendarEvent.origin` (and `EmailAccount.backfillBefore` for an explicit backfill anchor) - deferred schema work
