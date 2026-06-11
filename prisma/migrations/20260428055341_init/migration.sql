-- AlterTable
ALTER TABLE "leads" ADD COLUMN "conflictCheckedAt" DATETIME;
ALTER TABLE "leads" ADD COLUMN "conflictResolutionNotes" TEXT;

-- AlterTable
ALTER TABLE "matter_team_members" ADD COLUMN "removedAt" DATETIME;
ALTER TABLE "matter_team_members" ADD COLUMN "removedBy" TEXT;

-- AlterTable
ALTER TABLE "matters" ADD COLUMN "autoAddTeamToNewEvents" BOOLEAN;
ALTER TABLE "matters" ADD COLUMN "autoAddTeamToUpcomingEvents" BOOLEAN;
ALTER TABLE "matters" ADD COLUMN "incidentDate" DATETIME;

-- AlterTable
ALTER TABLE "practice_areas" ADD COLUMN "statutePeriodDays" INTEGER;
ALTER TABLE "practice_areas" ADD COLUMN "statuteSourceCitation" TEXT;

-- CreateTable
CREATE TABLE "role_permissions" (
    "roleId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("roleId", "permission"),
    CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "matterId" TEXT NOT NULL,
    "leadId" TEXT,
    "loggedBy" TEXT,
    "date" DATETIME NOT NULL,
    "description" TEXT NOT NULL,
    "utbmsCode" TEXT,
    "category" TEXT NOT NULL DEFAULT 'other',
    "amount" DECIMAL NOT NULL,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "clientAdvanced" BOOLEAN NOT NULL DEFAULT false,
    "invoiceId" TEXT,
    "receiptDocumentId" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "expenses_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "matters" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "expenses_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "expenses_receiptDocumentId_fkey" FOREIGN KEY ("receiptDocumentId") REFERENCES "documents" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "invoice_payments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "date" DATETIME NOT NULL,
    "description" TEXT,
    "reference" TEXT,
    "trustTxnId" TEXT,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "invoice_payments_trustTxnId_fkey" FOREIGN KEY ("trustTxnId") REFERENCES "trust_transactions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "invoice_payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "matterId" TEXT,
    "readAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "notifications_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "matters" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_calendar_attendees" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "userId" TEXT,
    "contactId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    CONSTRAINT "calendar_attendees_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "calendar_events" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "calendar_attendees_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "calendar_attendees_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_calendar_attendees" ("email", "eventId", "id", "name", "status") SELECT "email", "eventId", "id", "name", "status" FROM "calendar_attendees";
DROP TABLE "calendar_attendees";
ALTER TABLE "new_calendar_attendees" RENAME TO "calendar_attendees";
CREATE INDEX "calendar_attendees_eventId_idx" ON "calendar_attendees"("eventId");
CREATE INDEX "calendar_attendees_userId_idx" ON "calendar_attendees"("userId");
CREATE INDEX "calendar_attendees_contactId_idx" ON "calendar_attendees"("contactId");
CREATE TABLE "new_calendar_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "matterId" TEXT,
    "createdById" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'default',
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'meeting',
    "startTime" DATETIME NOT NULL,
    "endTime" DATETIME NOT NULL,
    "location" TEXT,
    "description" TEXT,
    "isAllDay" BOOLEAN NOT NULL DEFAULT false,
    "zoomUrl" TEXT,
    "color" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "calendar_events_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "matters" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "calendar_events_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_calendar_events" ("color", "createdAt", "description", "endTime", "id", "isAllDay", "location", "matterId", "startTime", "title", "type", "updatedAt", "zoomUrl") SELECT "color", "createdAt", "description", "endTime", "id", "isAllDay", "location", "matterId", "startTime", "title", "type", "updatedAt", "zoomUrl" FROM "calendar_events";
DROP TABLE "calendar_events";
ALTER TABLE "new_calendar_events" RENAME TO "calendar_events";
CREATE INDEX "calendar_events_startTime_idx" ON "calendar_events"("startTime");
CREATE INDEX "calendar_events_matterId_idx" ON "calendar_events"("matterId");
CREATE INDEX "calendar_events_createdById_startTime_idx" ON "calendar_events"("createdById", "startTime");
CREATE TABLE "new_contacts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "firmId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "organization" TEXT,
    "type" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "notes" TEXT,
    "conflictStatus" TEXT NOT NULL DEFAULT 'clear',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "contacts_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_contacts" ("address", "city", "conflictStatus", "createdAt", "email", "id", "isActive", "name", "notes", "organization", "phone", "state", "type", "updatedAt", "zip") SELECT "address", "city", "conflictStatus", "createdAt", "email", "id", "isActive", "name", "notes", "organization", "phone", "state", "type", "updatedAt", "zip" FROM "contacts";
DROP TABLE "contacts";
ALTER TABLE "new_contacts" RENAME TO "contacts";
CREATE INDEX "contacts_type_idx" ON "contacts"("type");
CREATE INDEX "contacts_name_idx" ON "contacts"("name");
CREATE TABLE "new_firms" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "ein" TEXT,
    "website" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "country" TEXT NOT NULL DEFAULT 'US',
    "establishedAt" DATETIME,
    "logoUrl" TEXT,
    "autoAddTeamToNewEvents" BOOLEAN NOT NULL DEFAULT true,
    "autoAddTeamToUpcomingEvents" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_firms" ("addressLine1", "addressLine2", "city", "country", "createdAt", "ein", "email", "establishedAt", "id", "logoUrl", "name", "phone", "shortName", "state", "updatedAt", "website", "zip") SELECT "addressLine1", "addressLine2", "city", "country", "createdAt", "ein", "email", "establishedAt", "id", "logoUrl", "name", "phone", "shortName", "state", "updatedAt", "website", "zip" FROM "firms";
DROP TABLE "firms";
ALTER TABLE "new_firms" RENAME TO "firms";
CREATE TABLE "new_users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "emailVerified" DATETIME,
    "image" TEXT,
    "name" TEXT NOT NULL,
    "initials" TEXT NOT NULL,
    "jobTitle" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "phone" TEXT,
    "barNumber" TEXT,
    "timeZone" TEXT NOT NULL DEFAULT 'America/Denver',
    "defaultEventVisibility" TEXT NOT NULL DEFAULT 'default',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "firmId" TEXT,
    "dashboardPrefs" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "users_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_users" ("avatarUrl", "barNumber", "createdAt", "dashboardPrefs", "email", "emailVerified", "firmId", "id", "image", "initials", "isActive", "jobTitle", "name", "passwordHash", "phone", "updatedAt") SELECT "avatarUrl", "barNumber", "createdAt", "dashboardPrefs", "email", "emailVerified", "firmId", "id", "image", "initials", "isActive", "jobTitle", "name", "passwordHash", "phone", "updatedAt" FROM "users";
DROP TABLE "users";
ALTER TABLE "new_users" RENAME TO "users";
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE INDEX "users_firmId_idx" ON "users"("firmId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "role_permissions_permission_idx" ON "role_permissions"("permission");

-- CreateIndex
CREATE INDEX "expenses_matterId_idx" ON "expenses"("matterId");

-- CreateIndex
CREATE INDEX "expenses_invoiceId_idx" ON "expenses"("invoiceId");

-- CreateIndex
CREATE INDEX "expenses_date_idx" ON "expenses"("date");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_payments_trustTxnId_key" ON "invoice_payments"("trustTxnId");

-- CreateIndex
CREATE INDEX "invoice_payments_invoiceId_idx" ON "invoice_payments"("invoiceId");

-- CreateIndex
CREATE INDEX "invoice_payments_date_idx" ON "invoice_payments"("date");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_createdAt_idx" ON "notifications"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "matter_team_members_matterId_removedAt_idx" ON "matter_team_members"("matterId", "removedAt");
