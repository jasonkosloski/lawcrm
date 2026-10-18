-- Legal and money records no longer vanish with their matter or lead.
-- Matters and leads are closed/archived, never deleted, so nothing in
-- the app relies on these cascades; they only made a stray script or
-- manual DELETE silently erase trust ledgers, invoices, settlements,
-- billable time and documents. A delete now fails while any remain.

ALTER TABLE "documents" DROP CONSTRAINT "documents_matterId_fkey";
ALTER TABLE "documents" ADD CONSTRAINT "documents_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "matters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "documents" DROP CONSTRAINT "documents_leadId_fkey";
ALTER TABLE "documents" ADD CONSTRAINT "documents_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "time_entries" DROP CONSTRAINT "time_entries_matterId_fkey";
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "matters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "time_entries" DROP CONSTRAINT "time_entries_leadId_fkey";
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "expenses" DROP CONSTRAINT "expenses_matterId_fkey";
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "matters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoices" DROP CONSTRAINT "invoices_matterId_fkey";
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "matters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "trust_transactions" DROP CONSTRAINT "trust_transactions_matterId_fkey";
ALTER TABLE "trust_transactions" ADD CONSTRAINT "trust_transactions_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "matters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "settlements" DROP CONSTRAINT "settlements_matterId_fkey";
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "matters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
