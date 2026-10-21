-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "emailAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "emailState" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN     "emailedAt" TIMESTAMP(3);

-- Rows from before email delivery are never emailed.
UPDATE "notifications" SET "emailState" = 'skipped';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "notificationDigestSentOn" DATE;

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "emailMode" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_matter_mutes" (
    "userId" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_matter_mutes_pkey" PRIMARY KEY ("userId","matterId")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_userId_category_key" ON "notification_preferences"("userId", "category");

-- CreateIndex
CREATE INDEX "notification_matter_mutes_matterId_idx" ON "notification_matter_mutes"("matterId");

-- CreateIndex
CREATE INDEX "notifications_emailState_createdAt_idx" ON "notifications"("emailState", "createdAt");

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_matter_mutes" ADD CONSTRAINT "notification_matter_mutes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_matter_mutes" ADD CONSTRAINT "notification_matter_mutes_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "matters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
