# Open issues

One file per open problem or tech-debt item that is too big for a roadmap line (each has Problem / Why it matters / Options or fix / Related).
Open product decisions that used to live at the end of the old single-file DECISIONS.md are here too.
When an issue is fixed, delete its file and note the fix in the relevant `../features/` file or in an ADR.
Roadmap items (planned features) stay in `../features/`, not here.

- [invoice-email-not-sent.md](invoice-email-not-sent.md) — invoice "send" is logged only; nothing is emailed to the client
- [conflict-status-not-in-matcher.md](conflict-status-not-in-matcher.md) — manual `Contact.conflictStatus` flag is never read by the conflict matcher
- [ungated-reads.md](ungated-reads.md) — template preview needs a key
- [document-metadata-edit.md](document-metadata-edit.md) — no rename/re-categorize after upload; receipt picker capped at 200
- [google-sync-origin-and-backfill-anchor.md](google-sync-origin-and-backfill-anchor.md) — `CalendarEvent.origin` and `EmailAccount.backfillBefore` needed
