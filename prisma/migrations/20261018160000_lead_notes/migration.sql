-- Intake notes: a Note belongs to EXACTLY ONE of a Matter or a Lead
-- (app-enforced, same invariant as time_entries). Lead conversion
-- re-homes lead notes onto the new matter.

-- AlterTable
ALTER TABLE "notes" ADD COLUMN     "leadId" TEXT,
ALTER COLUMN "matterId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "notes_leadId_idx" ON "notes"("leadId");

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
