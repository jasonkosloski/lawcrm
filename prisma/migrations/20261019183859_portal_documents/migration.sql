-- AlterTable
ALTER TABLE "document_folders" ADD COLUMN     "clientShared" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "clientShare" TEXT,
ADD COLUMN     "documentRequestId" TEXT,
ADD COLUMN     "portalBatchId" TEXT,
ADD COLUMN     "portalUploaderId" TEXT;

-- CreateTable
CREATE TABLE "document_requests" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT,
    "dueDate" DATE,
    "status" TEXT NOT NULL DEFAULT 'open',
    "returnNote" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "document_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_requests_matterId_status_idx" ON "document_requests"("matterId", "status");

-- CreateIndex
CREATE INDEX "documents_portalUploaderId_createdAt_idx" ON "documents"("portalUploaderId", "createdAt");

-- CreateIndex
CREATE INDEX "documents_documentRequestId_idx" ON "documents"("documentRequestId");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_portalUploaderId_fkey" FOREIGN KEY ("portalUploaderId") REFERENCES "portal_identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_documentRequestId_fkey" FOREIGN KEY ("documentRequestId") REFERENCES "document_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "matters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Data: roles that can edit matters get the new portal document permissions.
INSERT INTO "role_permissions" ("roleId", "permission")
SELECT DISTINCT "roleId", k FROM "role_permissions", unnest(ARRAY['portal.share_documents','portal.add_requests','portal.edit_requests','portal.delete_requests']) AS k
WHERE "permission" = 'matters.edit'
ON CONFLICT ("roleId", "permission") DO NOTHING;
