-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "leadId" TEXT,
ALTER COLUMN "matterId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "document_folders" ADD COLUMN     "leadId" TEXT,
ALTER COLUMN "matterId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "documents_leadId_idx" ON "documents"("leadId");

-- CreateIndex
CREATE INDEX "document_folders_leadId_parentId_idx" ON "document_folders"("leadId", "parentId");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_folders" ADD CONSTRAINT "document_folders_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

