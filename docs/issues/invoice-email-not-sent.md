# Invoice email delivery is logged-only

## Problem
"Send invoice" and "Send updated invoice" only record intent. `markInvoiceSent` writes an activity row titled "Invoice N marked sent via <method> (not emailed)" and the updated-invoice copy path logs "Updated invoice N copy requested for <email> (not emailed)". Nothing is sent to the client (`src/app/actions/billing/payments.ts`, comments near the "Send updated invoice" checkbox say NOTHING is emailed today).

## Why it matters
Users could believe a client received an invoice when they did not. Mitigated 2026-10-18: the UI now reads "Mark as sent" / "Client needs an updated invoice" and says nothing is emailed. Real delivery is still missing.

## Options or fix
- Wire the existing Gmail send path (`src/app/actions/email-send.ts`) to attach the printed invoice PDF/link and send from the user's connected mailbox; log the real send.
- Depends on how invoice PDFs are produced (currently browser Save-as-PDF from `/print/invoices/[id]`; see [documents.md](../features/documents.md) PDF export item).

## Related
[time-and-billing.md](../features/time-and-billing.md), [communication-email.md](../features/communication-email.md)
