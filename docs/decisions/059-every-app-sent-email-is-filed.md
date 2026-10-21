# ADR-059: Every app-sent email is filed to a matter or lead

**Date:** 2026-10-21
**Status:** Accepted.

**Context:** The CRM is not a free-form mail client: mail sent from it is firm correspondence and belongs on a record. Compose and reply could send from an unfiled thread, leaving sent mail with no matter or lead, outside the ethical walls and invisible to the people working the record. Threads could be filed only to matters, so intake correspondence had nowhere to live before conversion; the lead tab instead matched threads to the contact's email address, which surfaced mail never deliberately filed.

**Decision:**
- `EmailThread` has `matterId` and `leadId`, at most one; neither means unfiled inbound mail. `EmailMessage.sentFromApp` marks mail sent from the CRM.
- Sending requires a matter or lead. Replying on an unfiled thread picks a record and files the thread first (needs `communication.file_email`).
- Unfiling a thread that holds app-sent mail is refused, so sent mail can never lose its record. Moves between records are logged on both.
- If Gmail lands a send in a thread filed elsewhere, the filing stays and the sender gets a notice; the wording is generic when they cannot see that record.
- Matter and lead walls apply to every thread list, count, reader, search and attachment download.
- Lead conversion carries every user's lead-filed threads to the matter.
- The lead tab shows only threads filed to the lead. Contact-address matching is removed and deferred to a future categorizer.

**Trade-offs:**
- (+) No sent mail without a record; walls and timelines stay complete
- (+) Intake correspondence is filed deliberately and follows the lead to the matter
- (-) Sending needs one more choice, and replying to unfiled mail needs the file permission
- (-) Unfiling is blocked once the CRM has sent in a thread; a wrong filing can only be moved
- (-) Until the categorizer exists, inbound mail from a lead's contact is not shown on the lead unless someone files it
- (-) Inbox-to-action buttons and attachment "File to matter" stay matter-only
