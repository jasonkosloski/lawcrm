-- CreateTable
CREATE TABLE "transcripts" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'assemblyai',
    "providerJobId" TEXT,
    "webhookSecret" TEXT,
    "language" TEXT,
    "durationSeconds" DOUBLE PRECISION,
    "speakers" JSONB NOT NULL DEFAULT '{}',
    "correctedAt" TIMESTAMP(3),
    "correctedById" TEXT,
    "error" TEXT,
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transcripts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcript_segments" (
    "id" TEXT NOT NULL,
    "transcriptId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "speaker" TEXT NOT NULL,
    "startSeconds" DOUBLE PRECISION NOT NULL,
    "endSeconds" DOUBLE PRECISION NOT NULL,
    "text" TEXT NOT NULL,
    "words" JSONB NOT NULL,
    "originalText" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "transcript_segments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transcripts_documentId_key" ON "transcripts"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "transcripts_providerJobId_key" ON "transcripts"("providerJobId");

-- CreateIndex
CREATE INDEX "transcripts_status_requestedAt_idx" ON "transcripts"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "transcript_segments_transcriptId_startSeconds_idx" ON "transcript_segments"("transcriptId", "startSeconds");

-- CreateIndex
CREATE UNIQUE INDEX "transcript_segments_transcriptId_index_key" ON "transcript_segments"("transcriptId", "index");

-- AddForeignKey
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_correctedById_fkey" FOREIGN KEY ("correctedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_transcriptId_fkey" FOREIGN KEY ("transcriptId") REFERENCES "transcripts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data only: new transcript permissions. Grant transcribe + correct to every
-- role that can already upload documents, and delete to every role that can
-- delete any document. Everyone else is granted them in the role matrix.
-- Admins bypass the matrix. Idempotent.
INSERT INTO "role_permissions" ("roleId", "permission")
SELECT DISTINCT "roleId", p.key FROM "role_permissions"
CROSS JOIN (VALUES ('documents.transcribe'), ('documents.transcript.edit')) AS p(key)
WHERE "permission" = 'documents.upload'
ON CONFLICT ("roleId", "permission") DO NOTHING;
INSERT INTO "role_permissions" ("roleId", "permission")
SELECT DISTINCT "roleId", 'documents.transcript.delete' FROM "role_permissions"
WHERE "permission" = 'documents.delete_any'
ON CONFLICT ("roleId", "permission") DO NOTHING;
