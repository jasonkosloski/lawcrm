# Google Calendar sync

Two-way sync of each user's `primary` Google calendar, riding the existing Gmail OAuth connection. Shipped 2026-07-08. Triggers piggyback email sync ("Sync now", `/api/email-sync` cron) with zero new UI; per-account isolation means a broken calendar never blocks mail. The Gmail-side parts of the same integrity pass (W6a) are in [communication-email.md](communication-email.md).
Related: [ADR-023](../decisions/023-google-sync-skips-only-deterministic-failures-catch.md), [ADR-031](../decisions/031-google-sync-coordination-claim-cas-deterministic-event.md), [ADR-037](../decisions/037-private-calendar-events-show-to-their-creator.md), [calendar.md](calendar.md)

## Open work

- [ ] **`CalendarEvent.origin` flag** (P2) — would allow safe cleanup of Google-born imports deleted in Google (schema change). Today they linger in the CRM until removed there.
- [ ] **Attendee fan-out push** (P2) — push is creator-only; attendees never sync (see rules).
- [ ] **Delete retry** (P2) — a transient Google failure during delete orphans the Google copy (CRM delete proceeds, mapping gone, nothing retries); manual cleanup at Google, accepted for v1.
- [ ] **Skipped-event acknowledgement** (P2) — skipped poison events surface only via `syncError`.

## Shipped

- [x] **Connection / scope** — `calendar.events` scope is part of the connect flow; Google's actual grant persists to `EmailAccount.grantedScopes`. Pre-calendar connections see "Reconnect to enable calendar sync" on the integrations card. Google Cloud project needs the Calendar API enabled (plus Gmail).
- [x] **Pull (Google → CRM)** — `src/lib/google/google-calendar-sync.ts`. syncToken incremental; 410 → full windowed re-pull (now−30d … now+400d, `singleEvents=true` since the CRM has no recurrence model). Google-born events import as personal matterless meetings owned by the connection's user; events carrying the `extendedProperties.private.lawcrmEventId` echo marker update by mapping. v1 imports every non-cancelled item incl. tentative/transparent. Pull writes go through prisma directly (never server actions) so a pull can't trigger a push echo. Echo of our own push is detected against the mapping's `googleUpdatedAt`; a `lawcrmEventId` marker is adopted only for an event already mapped to this account or created by its owner.
- [x] **Push (CRM → Google)** — `src/lib/google/google-calendar-push.ts`, hooked into calendar-event server actions after each local commit (create both paths / update / move, including matter Events-tab events and sibling captures; delete → Google sweep BEFORE the CRM row deletes since mappings cascade). Creator-only; exactly ONE calendar per creator — the oldest connected account with the calendar scope (an account already holding the event's mapping wins, so pulled events PATCH their original). Insert vs update by mapping row. Pushed resources always carry the `lawcrmEventId` marker and NEVER attendees. Never-rejects discipline (like gmail-writeback): local mutation always wins; token-less/unscoped creators skip silently; revoked grants mark the account reconnect-required; transients warn; 404/410 tolerated on delete. CRM-side cleared description/location clear at Google too. Private events push as private (ADR-037).
- [x] **Shared contract** — `src/lib/google/calendar-shared.ts` (resource mapping, echo marker, LWW policy); mappings in `CalendarEventSync` (one row per event × Google account). Coordination claim / CAS details: ADR-031.

## Notes

Policies (deliberate):

1. **Last-write-wins** by timestamp — Google's `updated` must be strictly newer than the CRM row's `updatedAt` to overwrite.
2. **Unlink-only cancellation** (W6a, ADR-023) — deleting an event in Google drops only the sync mapping, for every event type; the CRM event always survives, so cleaning a personal Google calendar can never delete a firm deposition or CRM-born meeting.
3. **Attendees never sync to Google** — Google auto-emails invites (a malpractice generator).
4. Deactivated users' accounts do not sync or push (reactivation resumes; tokens untouched).
5. A per-account sync claim makes concurrent Sync now / cron / page-kick runs skip (stale after 10 min); skipped poison events surface in `syncError` ("N event(s) could not be imported").
