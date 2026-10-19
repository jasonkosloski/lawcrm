-- AlterTable
ALTER TABLE "activity_logs" ADD COLUMN     "leadId" TEXT;

-- AlterTable
ALTER TABLE "expenses" DROP COLUMN "leadId";

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "restricted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "matters" ADD COLUMN     "restricted" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "lead_team_members" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'co_counsel',
    "addedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_team_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lead_team_members_userId_idx" ON "lead_team_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "lead_team_members_leadId_userId_key" ON "lead_team_members"("leadId", "userId");

-- CreateIndex
CREATE INDEX "activity_logs_leadId_idx" ON "activity_logs"("leadId");

-- AddForeignKey
ALTER TABLE "lead_team_members" ADD CONSTRAINT "lead_team_members_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_team_members" ADD CONSTRAINT "lead_team_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: lead-scoped firm activity rows carry "lead <id>: ..." in
-- detail (createLead, conflict checks, decline). Link them so the
-- lead wall can filter the feed (ADR-049).
UPDATE "activity_logs" a SET "leadId" = l."id"
FROM "leads" l
WHERE a."leadId" IS NULL AND a."detail" LIKE 'lead ' || l."id" || ':%';
