-- CreateTable
CREATE TABLE "messenger_accounts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'quo',
    "providerAccountId" TEXT,
    "providerNumberId" TEXT,
    "phoneNumber" TEXT NOT NULL,
    "label" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "webhookSecret" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "messenger_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "messenger_threads" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "contactId" TEXT,
    "defaultMatterId" TEXT,
    "lastItemAt" DATETIME NOT NULL,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "messenger_threads_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "messenger_accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "messenger_threads_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "messenger_threads_defaultMatterId_fkey" FOREIGN KEY ("defaultMatterId") REFERENCES "matters" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "messenger_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "threadId" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "fromNumber" TEXT NOT NULL,
    "toNumber" TEXT NOT NULL,
    "body" TEXT,
    "mediaUrls" JSONB,
    "callDurationSec" INTEGER,
    "callStatus" TEXT,
    "recordingUrl" TEXT,
    "transcript" TEXT,
    "matterId" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "occurredAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "messenger_items_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "messenger_threads" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "messenger_items_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "matters" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "messenger_accounts_userId_idx" ON "messenger_accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "messenger_accounts_provider_phoneNumber_key" ON "messenger_accounts"("provider", "phoneNumber");

-- CreateIndex
CREATE INDEX "messenger_threads_accountId_lastItemAt_idx" ON "messenger_threads"("accountId", "lastItemAt");

-- CreateIndex
CREATE INDEX "messenger_threads_contactId_idx" ON "messenger_threads"("contactId");

-- CreateIndex
CREATE INDEX "messenger_threads_defaultMatterId_idx" ON "messenger_threads"("defaultMatterId");

-- CreateIndex
CREATE UNIQUE INDEX "messenger_threads_accountId_contactPhone_key" ON "messenger_threads"("accountId", "contactPhone");

-- CreateIndex
CREATE UNIQUE INDEX "messenger_items_providerEventId_key" ON "messenger_items"("providerEventId");

-- CreateIndex
CREATE INDEX "messenger_items_threadId_occurredAt_idx" ON "messenger_items"("threadId", "occurredAt");

-- CreateIndex
CREATE INDEX "messenger_items_matterId_idx" ON "messenger_items"("matterId");

-- CreateIndex
CREATE INDEX "messenger_items_threadId_isRead_idx" ON "messenger_items"("threadId", "isRead");
