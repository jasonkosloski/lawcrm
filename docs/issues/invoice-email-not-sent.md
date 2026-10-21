# Invoice email and mail delivery is logged-only

## Problem
The "Send invoice" methods `email` and `mail`, and "Send updated invoice", only record intent. `markInvoiceSent` writes an activity row titled "Invoice N marked sent via <method> (not emailed)" and the updated-invoice copy path logs "Updated invoice N copy requested for <email> (not emailed)" (`src/app/actions/billing/payments.ts`). The **Client portal** method is not affected: it posts the invoice to the portal and emails the billed client a notice ([client-portal-billing](../features/client-portal-billing.md)).

## Why it matters
Users could believe a client received an invoice by email when they did not. Mitigated: the UI reads "Mark as sent" / "Client needs an updated invoice" and says nothing is emailed for those methods.

## Options or fix
- Wire the existing Gmail send path (`src/app/actions/email-send.ts`) to attach the printed invoice PDF/link and send from the user's connected mailbox; log the real send.
- Depends on how invoice PDFs are produced (currently browser Save-as-PDF from `/print/invoices/[id]`; see [documents.md](../features/documents.md) PDF export item).

## Related
[time-and-billing.md](../features/time-and-billing.md), [communication-email.md](../features/communication-email.md)
