-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "attachmentIndex" INTEGER,
ADD COLUMN     "attachmentsExtractedAt" TIMESTAMP(3),
ADD COLUMN     "parentDocumentId" TEXT;

-- CreateTable
CREATE TABLE "document_links" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "folderId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_links_matterId_folderId_idx" ON "document_links"("matterId", "folderId");

-- CreateIndex
CREATE UNIQUE INDEX "document_links_documentId_folderId_key" ON "document_links"("documentId", "folderId");

-- CreateIndex
CREATE INDEX "documents_parentDocumentId_idx" ON "documents"("parentDocumentId");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_parentDocumentId_fkey" FOREIGN KEY ("parentDocumentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "matters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "document_folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

