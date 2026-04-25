-- AlterTable
ALTER TABLE "email_threads" ADD COLUMN "followUpAt" DATETIME;

-- AlterTable
ALTER TABLE "messenger_threads" ADD COLUMN "followUpAt" DATETIME;

-- CreateIndex
CREATE INDEX "email_threads_followUpAt_idx" ON "email_threads"("followUpAt");

-- CreateIndex
CREATE INDEX "messenger_threads_followUpAt_idx" ON "messenger_threads"("followUpAt");
