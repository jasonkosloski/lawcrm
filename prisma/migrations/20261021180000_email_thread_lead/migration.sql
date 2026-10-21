-- AlterTable
ALTER TABLE "email_messages" ADD COLUMN     "sentFromApp" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "email_threads" ADD COLUMN     "leadId" TEXT;

-- CreateIndex
CREATE INDEX "email_threads_leadId_idx" ON "email_threads"("leadId");

-- AddForeignKey
ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
