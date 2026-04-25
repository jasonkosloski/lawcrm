-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_invoices" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceNumber" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "clientId" TEXT,
    "issueDate" DATETIME NOT NULL,
    "dueDate" DATETIME NOT NULL,
    "subtotal" DECIMAL NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "invoices_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "matters" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_invoices" ("clientId", "createdAt", "dueDate", "id", "invoiceNumber", "issueDate", "matterId", "notes", "paidAmount", "status", "subtotal", "taxAmount", "totalAmount", "updatedAt") SELECT "clientId", "createdAt", "dueDate", "id", "invoiceNumber", "issueDate", "matterId", "notes", "paidAmount", "status", "subtotal", "taxAmount", "totalAmount", "updatedAt" FROM "invoices";
DROP TABLE "invoices";
ALTER TABLE "new_invoices" RENAME TO "invoices";
CREATE UNIQUE INDEX "invoices_invoiceNumber_key" ON "invoices"("invoiceNumber");
CREATE INDEX "invoices_matterId_idx" ON "invoices"("matterId");
CREATE INDEX "invoices_status_idx" ON "invoices"("status");
CREATE TABLE "new_matters" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "caseNumber" TEXT,
    "practiceAreaId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "court" TEXT,
    "filedDate" DATETIME,
    "trialDate" DATETIME,
    "feeStructure" TEXT NOT NULL DEFAULT 'contingent',
    "trustBalance" DECIMAL NOT NULL DEFAULT 0,
    "wipAmount" DECIMAL NOT NULL DEFAULT 0,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#2563a8',
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "statuteOfLimitationsDate" DATETIME,
    "statuteOfLimitationsSatisfied" BOOLEAN NOT NULL DEFAULT false,
    "statuteOfLimitationsSatisfiedAt" DATETIME,
    "statuteOfLimitationsNotes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "clientId" TEXT,
    "opposingParty" TEXT,
    "opposingFirm" TEXT,
    CONSTRAINT "matters_practiceAreaId_fkey" FOREIGN KEY ("practiceAreaId") REFERENCES "practice_areas" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "matters_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "matter_stages" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "matters_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "contacts" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_matters" ("caseNumber", "clientId", "color", "court", "createdAt", "description", "feeStructure", "filedDate", "id", "isArchived", "name", "opposingFirm", "opposingParty", "practiceAreaId", "stageId", "statuteOfLimitationsDate", "statuteOfLimitationsNotes", "statuteOfLimitationsSatisfied", "statuteOfLimitationsSatisfiedAt", "trialDate", "trustBalance", "updatedAt", "wipAmount") SELECT "caseNumber", "clientId", "color", "court", "createdAt", "description", "feeStructure", "filedDate", "id", "isArchived", "name", "opposingFirm", "opposingParty", "practiceAreaId", "stageId", "statuteOfLimitationsDate", "statuteOfLimitationsNotes", "statuteOfLimitationsSatisfied", "statuteOfLimitationsSatisfiedAt", "trialDate", "trustBalance", "updatedAt", "wipAmount" FROM "matters";
DROP TABLE "matters";
ALTER TABLE "new_matters" RENAME TO "matters";
CREATE INDEX "matters_stageId_idx" ON "matters"("stageId");
CREATE INDEX "matters_practiceAreaId_idx" ON "matters"("practiceAreaId");
CREATE INDEX "matters_clientId_idx" ON "matters"("clientId");
CREATE TABLE "new_settlement_liens" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "settlementId" TEXT NOT NULL,
    "lienholder" TEXT NOT NULL,
    "lienholderType" TEXT,
    "originalAmount" DECIMAL NOT NULL,
    "negotiatedAmount" DECIMAL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    CONSTRAINT "settlement_liens_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "settlements" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_settlement_liens" ("id", "lienholder", "lienholderType", "negotiatedAmount", "originalAmount", "settlementId", "status") SELECT "id", "lienholder", "lienholderType", "negotiatedAmount", "originalAmount", "settlementId", "status" FROM "settlement_liens";
DROP TABLE "settlement_liens";
ALTER TABLE "new_settlement_liens" RENAME TO "settlement_liens";
CREATE TABLE "new_settlements" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "matterId" TEXT NOT NULL,
    "grossAmount" DECIMAL NOT NULL,
    "firmFee" DECIMAL NOT NULL DEFAULT 0,
    "firmFeePercent" DECIMAL,
    "advancedCosts" DECIMAL NOT NULL DEFAULT 0,
    "clientNet" DECIMAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "settlements_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "matters" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_settlements" ("advancedCosts", "clientNet", "createdAt", "firmFee", "firmFeePercent", "grossAmount", "id", "matterId", "status", "updatedAt") SELECT "advancedCosts", "clientNet", "createdAt", "firmFee", "firmFeePercent", "grossAmount", "id", "matterId", "status", "updatedAt" FROM "settlements";
DROP TABLE "settlements";
ALTER TABLE "new_settlements" RENAME TO "settlements";
CREATE INDEX "settlements_matterId_idx" ON "settlements"("matterId");
CREATE TABLE "new_time_entries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "matterId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "hours" REAL NOT NULL,
    "activity" TEXT NOT NULL,
    "narrative" TEXT,
    "utbmsCode" TEXT,
    "rate" DECIMAL,
    "amount" DECIMAL,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "noCharge" BOOLEAN NOT NULL DEFAULT false,
    "privileged" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "sourceRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "invoiceId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "calendarEventId" TEXT,
    "noteId" TEXT,
    "taskId" TEXT,
    "deadlineId" TEXT,
    "emailMessageId" TEXT,
    "messengerItemId" TEXT,
    CONSTRAINT "time_entries_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "matters" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "time_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "time_entries_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "time_entries_calendarEventId_fkey" FOREIGN KEY ("calendarEventId") REFERENCES "calendar_events" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "time_entries_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "notes" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "time_entries_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "time_entries_deadlineId_fkey" FOREIGN KEY ("deadlineId") REFERENCES "deadlines" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "time_entries_emailMessageId_fkey" FOREIGN KEY ("emailMessageId") REFERENCES "email_messages" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "time_entries_messengerItemId_fkey" FOREIGN KEY ("messengerItemId") REFERENCES "messenger_items" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_time_entries" ("activity", "amount", "billable", "calendarEventId", "createdAt", "date", "deadlineId", "emailMessageId", "hours", "id", "invoiceId", "matterId", "messengerItemId", "narrative", "noCharge", "noteId", "privileged", "rate", "source", "sourceRef", "status", "taskId", "updatedAt", "userId", "utbmsCode") SELECT "activity", "amount", "billable", "calendarEventId", "createdAt", "date", "deadlineId", "emailMessageId", "hours", "id", "invoiceId", "matterId", "messengerItemId", "narrative", "noCharge", "noteId", "privileged", "rate", "source", "sourceRef", "status", "taskId", "updatedAt", "userId", "utbmsCode" FROM "time_entries";
DROP TABLE "time_entries";
ALTER TABLE "new_time_entries" RENAME TO "time_entries";
CREATE INDEX "time_entries_matterId_idx" ON "time_entries"("matterId");
CREATE INDEX "time_entries_userId_idx" ON "time_entries"("userId");
CREATE INDEX "time_entries_date_idx" ON "time_entries"("date");
CREATE INDEX "time_entries_status_idx" ON "time_entries"("status");
CREATE INDEX "time_entries_calendarEventId_idx" ON "time_entries"("calendarEventId");
CREATE INDEX "time_entries_noteId_idx" ON "time_entries"("noteId");
CREATE INDEX "time_entries_taskId_idx" ON "time_entries"("taskId");
CREATE INDEX "time_entries_deadlineId_idx" ON "time_entries"("deadlineId");
CREATE INDEX "time_entries_emailMessageId_idx" ON "time_entries"("emailMessageId");
CREATE INDEX "time_entries_messengerItemId_idx" ON "time_entries"("messengerItemId");
CREATE TABLE "new_trust_transactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "matterId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "date" DATETIME NOT NULL,
    "createdBy" TEXT,
    "reconciled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "trust_transactions_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "matters" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_trust_transactions" ("amount", "createdAt", "createdBy", "date", "description", "id", "matterId", "reconciled", "reference", "type") SELECT "amount", "createdAt", "createdBy", "date", "description", "id", "matterId", "reconciled", "reference", "type" FROM "trust_transactions";
DROP TABLE "trust_transactions";
ALTER TABLE "new_trust_transactions" RENAME TO "trust_transactions";
CREATE INDEX "trust_transactions_matterId_idx" ON "trust_transactions"("matterId");
CREATE INDEX "trust_transactions_date_idx" ON "trust_transactions"("date");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

