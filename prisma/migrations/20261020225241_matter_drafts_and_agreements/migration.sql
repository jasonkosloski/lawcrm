-- AlterTable
ALTER TABLE "firms" ADD COLUMN     "requireOriginatingDoc" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "practice_areas" ADD COLUMN     "originatingDocLabel" TEXT;

-- CreateTable
CREATE TABLE "matter_drafts" (
    "id" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "values" JSONB NOT NULL,
    "leadUserId" TEXT,
    "teamUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "matter_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matter_draft_files" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "contentType" TEXT,
    "fileSize" INTEGER,
    "uploadedBy" TEXT NOT NULL,
    "isOriginating" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "matter_draft_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matter_agreements" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'not_sent',
    "signedDate" TIMESTAMP(3),
    "documentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "matter_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "matter_drafts_createdById_idx" ON "matter_drafts"("createdById");

-- CreateIndex
CREATE INDEX "matter_drafts_updatedAt_idx" ON "matter_drafts"("updatedAt");

-- CreateIndex
CREATE INDEX "matter_draft_files_draftId_idx" ON "matter_draft_files"("draftId");

-- CreateIndex
CREATE UNIQUE INDEX "matter_agreements_matterId_key" ON "matter_agreements"("matterId");

-- CreateIndex
CREATE UNIQUE INDEX "matter_agreements_documentId_key" ON "matter_agreements"("documentId");

-- AddForeignKey
ALTER TABLE "matter_draft_files" ADD CONSTRAINT "matter_draft_files_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "matter_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matter_agreements" ADD CONSTRAINT "matter_agreements_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "matters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matter_agreements" ADD CONSTRAINT "matter_agreements_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Grant matters.agreement.edit to every role that can edit matters.
INSERT INTO "role_permissions" ("roleId", "permission")
SELECT DISTINCT "roleId", 'matters.agreement.edit' FROM "role_permissions"
WHERE "permission" = 'matters.edit'
ON CONFLICT ("roleId", "permission") DO NOTHING;
