-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "invoiceId" TEXT;

-- CreateIndex
CREATE INDEX "documents_invoiceId_idx" ON "documents"("invoiceId");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: link already-filed invoice PDFs ("Invoice <number> (sent ...).pdf")
-- in each matter's Invoices system folder to their invoice. Idempotent: only
-- touches rows whose invoiceId is still NULL.
UPDATE "documents" d SET "invoiceId" = i."id"
FROM "document_folders" f, "invoices" i
WHERE d."folderId" = f."id" AND f."systemKind" = 'invoices'
  AND i."matterId" = d."matterId" AND d."invoiceId" IS NULL
  AND d."name" LIKE 'Invoice ' || i."invoiceNumber" || ' (%';
